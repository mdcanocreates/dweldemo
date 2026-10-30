/**
 * Authority Lite on disposable Postgres. No production agency data.
 */
import http from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiRouter } from '../../src/http/router.js';
import { createHousingCase, loadStaff } from '../../src/modules/authority/service.js';
import { totpCode } from '../../src/modules/authority/totp.js';
import { seedPhase5Listing } from '../helpers/phase5.js';
import { withTenantContext } from '../../src/db/tenant.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

const emails = {
  owner: `auth-owner-${randomUUID().slice(0, 8)}@example.com`,
  worker: `auth-worker-${randomUUID().slice(0, 8)}@example.com`,
  participant: `auth-participant-${randomUUID().slice(0, 8)}@example.com`,
  provider: `auth-provider-${randomUUID().slice(0, 8)}@example.com`,
  outsider: `auth-outsider-${randomUUID().slice(0, 8)}@example.com`,
  coordinator: `auth-coord-${randomUUID().slice(0, 8)}@example.com`,
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
        if (raw) {
          try {
            body = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            body = { raw };
          }
        }
        resolve({ status: res.statusCode ?? 0, body, cookie: cookieFrom(res.headers) });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function signIn(port: number, email: string) {
  const issued = await request(port, 'POST', '/v1/auth/email-code', {
    body: { email, purpose: 'sign_in' },
  });
  expect(issued.status).toBe(200);
  const verified = await request(port, 'POST', '/v1/auth/email-code/verify', {
    body: { email, code: String(issued.body.debug_code), purpose: 'sign_in' },
  });
  expect(verified.status).toBe(200);
  return { cookie: verified.cookie!, partyId: String(verified.body.party_id) };
}

describe('authority lite', () => {
  let db: TestDb;
  let appPool: DbPool;
  let server: http.Server;
  let port = 0;
  let listingId = '';
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'development';
    process.env.AUTH_RETURN_REDEEM_TOKEN = '1';
    process.env.AUTH_EMAIL_ALLOWLIST = Object.values(emails).join(',');
    process.env.EMAIL_PROVIDER = 'stub';
    process.env.DWEL_AUTHORITY_LITE = '1';
    process.env.DWEL_AUTHORITY_SANDBOX = '1';
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
    const seeded = await withBypass(db.pool, async (client) => {
      const listing = await seedPhase5Listing(client, db.kms, { rentCents: 150000 });
      await client.query(`update listing set status = 'active' where id = $1`, [listing.listingId]);
      return listing.listingId;
    });
    listingId = seeded;
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
    process.env = saved;
  });

  it('coordinates a case without making an official housing decision', async () => {
    const owner = await signIn(port, emails.owner);
    const worker = await signIn(port, emails.worker);
    const participant = await signIn(port, emails.participant);
    const provider = await signIn(port, emails.provider);
    const outsider = await signIn(port, emails.outsider);
    const coordinator = await signIn(port, emails.coordinator);

    const agency = await request(port, 'POST', '/v1/authority/sandbox/agencies', {
      cookie: owner.cookie,
      body: { displayName: 'Pilot Agency' },
    });
    expect(agency.status).toBe(201);
    const agencyId = String(agency.body.agencyId);
    const other = await request(port, 'POST', '/v1/authority/sandbox/agencies', {
      cookie: outsider.cookie,
      body: { displayName: 'Other Agency' },
    });
    const otherId = String(other.body.agencyId);

    const invited = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/invitations`, {
      cookie: owner.cookie,
      body: { email: emails.worker, role: 'caseworker' },
    });
    expect(invited.status).toBe(201);
    const joined = await request(port, 'POST', '/v1/authority/invitations/accept', {
      cookie: worker.cookie,
      body: { token: invited.body.acceptToken },
    });
    expect(joined.status).toBe(200);

    const coordInvite = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/invitations`, {
      cookie: owner.cookie,
      body: { email: emails.coordinator, role: 'inspection_coordinator' },
    });
    await request(port, 'POST', '/v1/authority/invitations/accept', {
      cookie: coordinator.cookie,
      body: { token: coordInvite.body.acceptToken },
    });

    const caseBody = {
      displayReference: 'CASE-100',
      searchPreferences: { bedroomsMin: 2, maxMonthlyGrossRentCents: 180000 },
      assistanceIndicator: 'unknown',
      dwelPartyId: participant.partyId,
    };
    const created = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases`, {
      cookie: worker.cookie,
      headers: { 'Idempotency-Key': 'case-100' },
      body: caseBody,
    });
    expect(created.status).toBe(201);
    const caseId = String((created.body.case as { id: string }).id);
    const replay = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases`, {
      cookie: worker.cookie,
      headers: { 'Idempotency-Key': 'case-100' },
      body: caseBody,
    });
    expect(String((replay.body.case as { id: string }).id)).toBe(caseId);
    const conflict = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases`, {
      cookie: worker.cookie,
      headers: { 'Idempotency-Key': 'case-100' },
      body: { ...caseBody, displayReference: 'CASE-999' },
    });
    expect(conflict.status).toBe(409);

    const sameRef = await request(port, 'POST', `/v1/authority/agencies/${otherId}/cases`, {
      cookie: outsider.cookie,
      body: { ...caseBody, dwelPartyId: outsider.partyId },
    });
    expect(sameRef.status).toBe(201);
    const hidden = await request(port, 'GET', `/v1/authority/agencies/${agencyId}/cases/${caseId}`, {
      cookie: outsider.cookie,
    });
    expect(hidden.status).toBe(404);

    const forged = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases/${caseId}/assistance`, {
      cookie: participant.cookie,
      body: {
        indicator: 'agency_verified',
        programType: 'hcv',
        verificationSource: 'forged',
        version: 1,
      },
    });
    expect(forged.status).toBe(404);

    const share = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases/${caseId}/share`, {
      cookie: worker.cookie,
      body: { granteePartyId: participant.partyId, purpose: 'housing search', days: 14 },
    });
    expect(share.status).toBe(201);
    const before = await request(port, 'GET', '/v1/authority/participant/cases', { cookie: participant.cookie });
    expect((before.body.cases as unknown[]).length).toBe(0);
    const accepted = await request(port, 'POST', '/v1/authority/shares/accept', {
      cookie: participant.cookie,
      body: { shareId: share.body.shareId },
    });
    expect(accepted.status).toBe(200);
    const mine = await request(port, 'GET', '/v1/authority/participant/cases', { cookie: participant.cookie });
    expect((mine.body.cases as Array<{ reference: string }>)[0]?.reference).toBe('CASE-100');
    await request(port, 'POST', '/v1/authority/shares/revoke', {
      cookie: participant.cookie,
      body: { shareId: share.body.shareId },
    });
    const afterRevoke = await request(port, 'GET', '/v1/authority/participant/cases', {
      cookie: participant.cookie,
    });
    expect((afterRevoke.body.cases as unknown[]).length).toBe(0);
    const reshare = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases/${caseId}/share`, {
      cookie: worker.cookie,
      body: { granteePartyId: participant.partyId, purpose: 'housing search', days: 14 },
    });
    await request(port, 'POST', '/v1/authority/shares/accept', {
      cookie: participant.cookie,
      body: { shareId: reshare.body.shareId },
    });

    const lead = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases/${caseId}/leads`, {
      cookie: worker.cookie,
      body: { listingId, providerPartyId: provider.partyId },
    });
    expect(lead.status).toBe(201);
    const leadId = String((lead.body.lead as { id: string }).id);
    const outreach = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/leads/${leadId}/outreach`, {
      cookie: worker.cookie,
      headers: { 'Idempotency-Key': 'hello-1' },
      body: { body: 'Is this home available?' },
    });
    expect(outreach.status).toBe(201);
    const providerView = await request(port, 'GET', '/v1/authority/provider/leads', { cookie: provider.cookie });
    expect((providerView.body.leads as Array<{ id: string }>)[0]?.id).toBe(leadId);
    expect(JSON.stringify(providerView.body)).not.toMatch(/assistance|verification/i);

    const packet = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases/${caseId}/packets`, {
      cookie: worker.cookie,
      body: { leadId },
    });
    const packetId = String(packet.body.packetId);
    const approved = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/packets/${packetId}/submit`, {
      cookie: worker.cookie,
      body: { status: 'agency_approved' },
    });
    expect(approved.status).toBe(403);
    await request(port, 'PATCH', `/v1/authority/agencies/${agencyId}/packets/${packetId}/participant`, {
      cookie: participant.cookie,
      body: { contact_name: 'Ada Participant' },
    });
    await request(port, 'PATCH', `/v1/authority/agencies/${agencyId}/packets/${packetId}/provider`, {
      cookie: provider.cookie,
      body: { proposed_rent_cents: 150000, owner_name: 'Owner' },
    });
    const sent = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/packets/${packetId}/submit`, {
      cookie: worker.cookie,
      body: {},
    });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('sent_to_agency');
    expect(sent.body.statusLabel).toBe('Sent to the agency');
    const workerAck = await request(
      port,
      'POST',
      `/v1/authority/agencies/${agencyId}/packets/${packetId}/acknowledge`,
      { cookie: worker.cookie, body: { reference: 'PHA-1' } },
    );
    expect(workerAck.status).toBe(403);
    const lowAssurance = await request(
      port,
      'POST',
      `/v1/authority/agencies/${agencyId}/packets/${packetId}/acknowledge`,
      { cookie: owner.cookie, body: { reference: 'PHA-1' } },
    );
    expect(lowAssurance.status).toBe(403);
    expect(lowAssurance.body.error).toBe('mfa_required');
    const enrolled = await request(port, 'POST', '/v1/authority/mfa/enroll', { cookie: owner.cookie });
    expect(enrolled.status).toBe(200);
    const confirmed = await request(port, 'POST', '/v1/authority/mfa/confirm', {
      cookie: owner.cookie,
      body: { code: totpCode(String(enrolled.body.secret)) },
    });
    expect(confirmed.status).toBe(200);
    const acked = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/packets/${packetId}/acknowledge`, {
      cookie: owner.cookie,
      body: { reference: 'PHA-1' },
    });
    expect(acked.body.statusLabel).toBe('Agency received the packet');

    const visit = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases/${caseId}/appointments`, {
      cookie: coordinator.cookie,
      body: { windowStart: new Date().toISOString() },
    });
    expect(visit.status).toBe(201);
    const appointmentId = String(visit.body.appointmentId);
    const passed = await request(
      port,
      'POST',
      `/v1/authority/agencies/${agencyId}/appointments/${appointmentId}/result`,
      { cookie: coordinator.cookie, body: { source: 'PHA inspection desk', observation: 'received', passed: true } },
    );
    expect(passed.status).toBe(403);
    const recorded = await request(
      port,
      'POST',
      `/v1/authority/agencies/${agencyId}/appointments/${appointmentId}/result`,
      { cookie: coordinator.cookie, body: { source: 'PHA inspection desk', observation: 'Result received from the agency' } },
    );
    expect(recorded.body.statusLabel).toBe('Agency result recorded');

    const upload = await request(
      port,
      'POST',
      `/v1/authority/agencies/${agencyId}/cases/${caseId}/documents/upload-intent`,
      { cookie: worker.cookie, body: { filename: 'id.pdf', mimeType: 'application/pdf', byteSize: 1200 } },
    );
    expect(upload.status).toBe(201);
    await withBypass(db.pool, (client) =>
      client.query(`update authority_document set storage_key = 'missing/file' where id = $1`, [
        upload.body.documentId,
      ]),
    );
    const missing = await request(
      port,
      'GET',
      `/v1/authority/agencies/${agencyId}/documents/${String(upload.body.documentId)}/preview`,
      { cookie: worker.cookie },
    );
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('This file is not available.');

    const report = await request(port, 'GET', `/v1/authority/agencies/${agencyId}/reports/leaseup`, {
      cookie: owner.cookie,
    });
    expect(report.body.suppressed).toBe(true);
    const lease = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/cases/${caseId}/leaseup`, {
      cookie: owner.cookie,
      body: { source: 'PHA lease-up desk' },
    });
    expect(lease.body.statusLabel).toBe('Lease-up confirmed');

    const preview = await request(port, 'POST', `/v1/authority/agencies/${agencyId}/integrations/imports/preview`, {
      cookie: owner.cookie,
      body: { csv: 'reference\nAB\nCASE-1\nCASE-1\n' },
    });
    expect(preview.body.applied).toBe(false);
    expect(preview.body.mode).toBe('preview');

    const staff = await withBypass(db.pool, (client) => loadStaff(client, worker.partyId, agencyId));
    await expect(
      withTenantContext(appPool, { partyId: worker.partyId }, async (client) => {
        await createHousingCase(
          client,
          staff,
          {
            displayReference: 'ROLLBACK-1',
            searchPreferences: { bedroomsMin: 1, areaIds: [], requiredAmenities: [], accessibilityPreferences: [] },
            assistanceIndicator: 'unknown',
          },
          null,
          'rollback',
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const leftover = await withBypass(db.pool, (client) =>
      client.query(`select id from authority_housing_case where display_reference = 'ROLLBACK-1'`),
    );
    expect(leftover.rows).toHaveLength(0);

    process.env.DWEL_AUTHORITY_LITE = '0';
    const disabled = await request(port, 'GET', '/v1/authority/me', { cookie: owner.cookie });
    expect(disabled.status).toBe(404);
    process.env.DWEL_AUTHORITY_LITE = '1';
  });
});
