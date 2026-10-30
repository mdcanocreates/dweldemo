/**
 * Database and request checks for verification privacy and document quarantine.
 * Disposable Postgres. The application role is not a superuser.
 */
import http from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiRouter } from '../../src/http/router.js';
import { createTask, loadStaff } from '../../src/modules/authority/service.js';
import { totpCode } from '../../src/modules/authority/totp.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import { withTenantContext } from '../../src/db/tenant.js';
import type { DbPool } from '../../src/db/pool.js';

const scannerToken = 'test-scanner-token';
const emails = {
  owner: `sec-owner-${randomUUID().slice(0, 8)}@example.com`,
  worker: `sec-worker-${randomUUID().slice(0, 8)}@example.com`,
  coordinator: `sec-coord-${randomUUID().slice(0, 8)}@example.com`,
  outsider: `sec-out-${randomUUID().slice(0, 8)}@example.com`,
};

type ApiResult = { status: number; body: Record<string, unknown>; cookie: string | null };

function cookieFrom(headers: IncomingHttpHeaders): string | null {
  const raw = headers['set-cookie'];
  const lines = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const line of lines) {
    const match = /^rbit_session=([^;]+)/.exec(line);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

function request(
  port: number,
  method: string,
  path: string,
  opts?: { body?: Record<string, unknown>; cookie?: string | null; headers?: Record<string, string> },
): Promise<ApiResult> {
  return new Promise((resolve, reject) => {
    const payload = opts?.body ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = { ...(opts?.headers ?? {}) };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    if (opts?.cookie) headers.Cookie = `rbit_session=${encodeURIComponent(opts.cookie)}`;
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: Record<string, unknown> = {};
        if (raw) body = JSON.parse(raw) as Record<string, unknown>;
        resolve({ status: res.statusCode ?? 0, body, cookie: cookieFrom(res.headers) });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function signIn(port: number, email: string) {
  const issued = await request(port, 'POST', '/v1/auth/email-code', { body: { email, purpose: 'sign_in' } });
  const verified = await request(port, 'POST', '/v1/auth/email-code/verify', {
    body: { email, code: String(issued.body.debug_code), purpose: 'sign_in' },
  });
  return { cookie: verified.cookie!, partyId: String(verified.body.party_id) };
}

describe('authority security boundary', () => {
  let db: TestDb;
  let appPool: DbPool;
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'development';
    process.env.AUTH_RETURN_REDEEM_TOKEN = '1';
    process.env.AUTH_EMAIL_ALLOWLIST = Object.values(emails).join(',');
    process.env.EMAIL_PROVIDER = 'stub';
    process.env.DWEL_AUTHORITY_LITE = '1';
    process.env.DWEL_AUTHORITY_SANDBOX = '1';
    process.env.AUTHORITY_SCANNER_TOKEN = scannerToken;
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
    const hash = createHash('sha256').update(scannerToken).digest('hex');
    await withBypass(db.pool, (client) =>
      client.query(`insert into authority_scanner_credential (id, token_hash) values (1, $1)`, [hash]),
    );
    const router = createApiRouter({ pool: appPool });
    server = http.createServer(async (req, res) => {
      const handled = await router(req, res);
      if (!handled) {
        res.writeHead(404);
        res.end('{}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await appPool?.end();
    await db?.stop();
  });

  it('keeps verification and unclean documents away from the application role', async () => {
    const columns = await withBypass(db.pool, (client) =>
      client.query(
        `select column_name from information_schema.columns
         where table_name = 'authority_housing_case'
           and column_name in ('verification_source', 'program_type', 'assistance_indicator')`,
      ),
    );
    expect(columns.rows).toHaveLength(0);
    await expect(appPool.query(`select * from authority_private_verification`)).rejects.toMatchObject({
      code: '42501',
    });

    const owner = await signIn(port, emails.owner);
    const worker = await signIn(port, emails.worker);
    const coordinator = await signIn(port, emails.coordinator);
    const outsider = await signIn(port, emails.outsider);
    const agency = await request(port, 'POST', '/v1/authority/sandbox/agencies', {
      cookie: owner.cookie,
      body: { displayName: 'Security Agency' },
    });
    const agencyId = String(agency.body.agencyId);
    const other = await request(port, 'POST', '/v1/authority/sandbox/agencies', {
      cookie: outsider.cookie,
      body: { displayName: 'Second Agency' },
    });
    for (const [email, role, cookie] of [
      [emails.worker, 'caseworker', worker.cookie],
      [emails.coordinator, 'inspection_coordinator', coordinator.cookie],
    ] as const) {
      const invited = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/invitations`, {
        cookie: owner.cookie,
        body: { email, role },
      });
      await request(port, 'POST', '/v1/authority/invitations/accept', {
        cookie,
        body: { token: invited.body.acceptToken },
      });
    }

    const created = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases`, {
      cookie: worker.cookie,
      body: { displayReference: 'SEC-1', searchPreferences: { bedroomsMin: 1 }, assistanceIndicator: 'unknown' },
    });
    const caseId = String((created.body.case as { id: string }).id);
    const hidden = await withTenantContext(appPool, { partyId: coordinator.partyId }, (client) =>
      client.query(`select verification_source from authority_read_verification($1, $2)`, [agencyId, caseId]),
    );
    expect(hidden.rows).toHaveLength(0);

    const enrolled = await request(port, 'POST', '/v1/authority/mfa/enroll', { cookie: owner.cookie });
    await request(port, 'POST', '/v1/authority/mfa/confirm', {
      cookie: owner.cookie,
      body: { code: totpCode(String(enrolled.body.secret)) },
    });
    const verified = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases/${caseId}/assistance`, {
      cookie: owner.cookie,
      body: {
        indicator: 'agency_verified',
        programType: 'housing_choice',
        verificationSource: 'PHA desk 42',
        version: 1,
      },
    });
    expect(verified.status).toBe(200);
    const ownerRead = await withTenantContext(appPool, { partyId: owner.partyId }, (client) =>
      client.query<{ verification_source: string }>(
        `select verification_source from authority_read_verification($1, $2)`,
        [agencyId, caseId],
      ),
    );
    expect(ownerRead.rows[0]?.verification_source).toBe('PHA desk 42');
    const stillHidden = await withTenantContext(appPool, { partyId: coordinator.partyId }, (client) =>
      client.query(`select * from authority_read_verification($1, $2)`, [agencyId, caseId]),
    );
    expect(stillHidden.rows).toHaveLength(0);

    const upload = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases/${caseId}/documents/upload-intent`, {
      cookie: worker.cookie,
      body: { filename: 'proof.pdf', mimeType: 'application/pdf', byteSize: 12 },
    });
    const documentId = String(upload.body.documentId);
    const forged = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/documents/${documentId}/complete`, {
      cookie: worker.cookie,
      body: { bytesBase64: Buffer.from('housing-proof').toString('base64'), scan_status: 'clean' },
    });
    expect(forged.status).toBe(400);
    const stored = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/documents/${documentId}/complete`, {
      cookie: worker.cookie,
      body: { bytesBase64: Buffer.from('housing-proof').toString('base64') },
    });
    expect(stored.body.statusLabel).toBe('Scanning');
    await expect(
      withTenantContext(appPool, { partyId: worker.partyId }, (client) =>
        client.query(`update authority_document set scan_status = 'clean' where id = $1`, [documentId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const blocked = await request(port, 'GET', `/v1/authority/agencies/${agencyId}/documents/${documentId}/preview`, {
      cookie: owner.cookie,
    });
    expect(blocked.status).toBe(404);
    expect(blocked.body.message).toBe('This file is not available.');

    const wrong = await request(port, 'POST', '/v1/authority/internal/scans', {
      headers: { 'x-authority-scanner': 'nope' },
      body: { documentId, sha256: String(stored.body.sha256), verdict: 'clean', evidenceId: 'scan-1' },
    });
    expect(wrong.status).toBe(404);
    const scanned = await request(port, 'POST', '/v1/authority/internal/scans', {
      headers: { 'x-authority-scanner': scannerToken },
      body: { documentId, sha256: String(stored.body.sha256), verdict: 'clean', evidenceId: 'scan-1' },
    });
    expect(scanned.body.statusLabel).toBe('Ready');
    const preview = await request(port, 'GET', `/v1/authority/agencies/${agencyId}/documents/${documentId}/preview`, {
      cookie: owner.cookie,
    });
    expect(preview.status).toBe(200);
    expect(typeof preview.body.token).toBe('string');
    const foreign = await request(
      port,
      'GET',
      `/v1/authority/agencies/${String(other.body.agencyId)}/documents/${documentId}/preview`,
      { cookie: outsider.cookie },
    );
    expect(foreign.status).toBe(404);

    const visit = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases/${caseId}/appointments`, {
      cookie: coordinator.cookie,
      body: { windowStart: '2026-11-01T01:00:00.000Z' },
    });
    const moved = await request(
      port,
      'POST',
      `/v1/authority/agencies/${agencyId}/appointments/${String(visit.body.appointmentId)}/reschedule`,
      {
        cookie: coordinator.cookie,
        body: {
          startAt: '2026-11-01T01:30:00-05:00',
          endAt: '2026-11-01T02:00:00-05:00',
          reason: 'Agency asked for the earlier window',
          expectedVersion: visit.body.version,
          passed: true,
        },
      },
    );
    expect(moved.status).toBe(403);
    const rescheduled = await request(
      port,
      'POST',
      `/v1/authority/agencies/${agencyId}/appointments/${String(visit.body.appointmentId)}/reschedule`,
      {
        cookie: coordinator.cookie,
        body: {
          startAt: '2026-11-01T01:30:00-05:00',
          endAt: '2026-11-01T02:00:00-05:00',
          reason: 'Agency asked for the earlier window',
          expectedVersion: visit.body.version,
        },
      },
    );
    expect(rescheduled.body.startAtUtc).toBe('2026-11-01T06:30:00.000Z');
    expect(String(rescheduled.body.localLabel)).toMatch(/1:30/);
    expect(rescheduled.body.statusLabel).toBe('Rescheduled');

    const audit = await request(port, 'GET', `/v1/authority/agencies/${agencyId}/audit`, { cookie: owner.cookie });
    const auditText = JSON.stringify(audit.body);
    expect(auditText).not.toMatch(/storage_key|signed|voucher|PHA desk/i);
    const workerAudit = await request(port, 'GET', `/v1/authority/agencies/${agencyId}/audit`, {
      cookie: worker.cookie,
    });
    expect(workerAudit.status).toBe(403);

    const staff = await withBypass(db.pool, (client) => loadStaff(client, worker.partyId, agencyId));
    await expect(
      withTenantContext(appPool, { partyId: worker.partyId }, async (client) => {
        await createTask(client, staff, caseId, { title: 'Orphan task', dueAt: null, assigneePartyId: null }, 'rollback');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const leftover = await withBypass(db.pool, (client) =>
      client.query(`select id from authority_task where title = 'Orphan task'`),
    );
    expect(leftover.rows).toHaveLength(0);
  });
});
