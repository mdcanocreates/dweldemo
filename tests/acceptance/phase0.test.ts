import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setTenantContext } from '../../src/db/session.js';
import {
  containsAnyPlaintext,
  redactValue,
} from '../../src/infra/logging/redact.js';
import { createLogCapture, createLogger } from '../../src/infra/logging/logger.js';
import {
  appendAdminAction,
  verifyAdminActionChain,
  verifyHashChain,
  computeRowHash,
} from '../../src/modules/audit/index.js';
import {
  approveDualApproval,
  createOrg,
  createPartyWithIdentity,
  cryptoShredParty,
  DualApprovalError,
  grantRole,
  readPartyIdentity,
  requestDualApproval,
} from '../../src/modules/identity/index.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'phase0');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

describe('Phase 0 acceptance (§17)', () => {
  let db: TestDb;
  let appPool: DbPool;

  beforeAll(async () => {
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
  }, 180_000);

  afterAll(async () => {
    await appPool?.end();
    await db?.stop();
  });

  it('RLS enabled and policy present on every non-allowlisted table', async () => {
    const client = await db.pool.connect();
    try {
      const { rows } = await client.query<{
        table_name: string;
        rls: boolean;
        policy_count: string;
      }>(`
        select t.tablename as table_name,
               c.relrowsecurity as rls,
               coalesce(p.cnt, 0)::text as policy_count
        from pg_tables t
        join pg_class c on c.relname = t.tablename
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        left join lateral (
          select count(*)::int as cnt from pg_policies
          where schemaname = 'public' and tablename = t.tablename
        ) p on true
        where t.schemaname = 'public'
        order by t.tablename
      `);

      const allowlist = JSON.parse(
        await (await import('node:fs/promises')).readFile(
          path.join(ROOT, 'GLOBAL_TABLES.json'),
          'utf8',
        ),
      ) as { tables: string[] };
      const allowed = new Set(allowlist.tables);

      const report = rows
        .map((r) => {
          const scoped = !allowed.has(r.table_name);
          return `${r.table_name}\trls=${r.rls}\tpolicies=${r.policy_count}\tscoped=${scoped}`;
        })
        .join('\n');

      writeEvidence('rls-psql.txt', report + '\n');

      for (const r of rows) {
        if (allowed.has(r.table_name)) continue;
        expect(r.rls, r.table_name).toBe(true);
        expect(Number(r.policy_count), r.table_name).toBeGreaterThan(0);
      }

      // Behavioral check: org_claim isolation
      const orgA = await withBypass(db.pool, (c) =>
        createOrg(c, { kind: 'landlord', legalName: 'A LLC', displayName: 'A' }),
      );
      const orgB = await withBypass(db.pool, (c) =>
        createOrg(c, { kind: 'landlord', legalName: 'B LLC', displayName: 'B' }),
      );
      const party = await withBypass(db.pool, (c) =>
        createPartyWithIdentity(c, db.kms, {
          identity: { email: 'claimant@example.com', givenName: 'Pat' },
        }),
      );

      await withBypass(db.pool, async (c) => {
        await c.query(
          `insert into org_claim (org_id, claimant_party_id, method, evidence, status)
           values ($1,$2,'email_domain','{}','pending')`,
          [orgA.id, party.partyId],
        );
        await c.query(
          `insert into org_claim (org_id, claimant_party_id, method, evidence, status)
           values ($1,$2,'email_domain','{}','pending')`,
          [orgB.id, party.partyId],
        );
      });

      // Superusers bypass RLS; use the non-superuser app role.
      const tenantClient = await appPool.connect();
      try {
        await tenantClient.query('begin');
        await setTenantContext(tenantClient, { orgId: orgA.id, bypassRls: false });
        const { rows: visible } = await tenantClient.query(
          `select org_id from org_claim`,
        );
        await tenantClient.query('commit');
        expect(visible).toHaveLength(1);
        expect(visible[0]!.org_id).toBe(orgA.id);
      } finally {
        tenantClient.release();
      }
    } finally {
      client.release();
    }
  });

  it('tenancy CI gate fails on deliberate unscoped table, then passes', () => {
    const failEnv = {
      ...process.env,
      DATABASE_URL: db.connectionString,
      TENANCY_INJECT_VIOLATION: '1',
    };
    let failed = false;
    let failOut = '';
    try {
      failOut = execFileSync('npm', ['run', 'ci:tenancy'], {
        cwd: ROOT,
        env: failEnv,
        encoding: 'utf8',
        shell: true,
      });
    } catch (err) {
      failed = true;
      const e = err as { stdout?: string; stderr?: string; message?: string };
      failOut = `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`;
    }
    expect(failed).toBe(true);
    expect(failOut).toMatch(/deliberate_unscoped/);

    const passOut = execFileSync('npm', ['run', 'ci:tenancy'], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: db.connectionString },
      encoding: 'utf8',
      shell: true,
    });
    expect(passOut).toMatch(/tenancy-gate: PASS/);

    writeEvidence(
      'tenancy-gate.txt',
      `=== FAIL (injected) ===\n${failOut}\n\n=== PASS ===\n${passOut}\n`,
    );
  });

  it('synthetic PII request produces log output containing zero PII values', () => {
    const capture = createLogCapture();
    const log = createLogger({ destination: capture.stream, requestId: randomUUID() });

    const payload = {
      ssn: '123-45-6789',
      email: 'alice@example.com',
      phone: '312-555-0199',
      dob: '1990-04-12',
      given_name: 'Alice',
      family_name: 'Example',
      government_id: 'D1234567',
      card_number: '4111111111111111',
      note: 'applicant SSN 123-45-6789 email alice@example.com',
    };

    log.info(payload, `intake for ${payload.email} ssn=${payload.ssn}`);
    // force sync flush
    const joined = capture.lines.join('\n') + JSON.stringify(redactValue(payload));

    const needles = [
      '123-45-6789',
      'alice@example.com',
      '312-555-0199',
      '1990-04-12',
      'Alice',
      'Example',
      'D1234567',
      '4111111111111111',
    ];
    const found = containsAnyPlaintext(joined, needles);
    writeEvidence(
      'pii-redaction.txt',
      `log_lines:\n${joined}\n\nneedles_found: ${JSON.stringify(found)}\n`,
    );
    expect(found).toEqual([]);
  });

  it('crypto-shred: identity unreadable, party_features intact, FKs valid', async () => {
    const kms = db.kms;
    const created = await withBypass(db.pool, (c) =>
      createPartyWithIdentity(c, kms, {
        identity: {
          email: 'shred@example.com',
          givenName: 'Sam',
          familyName: 'Shred',
          dob: '1988-01-02',
          phone: '415-555-0100',
        },
      }),
    );

    const before = await withBypass(db.pool, (c) =>
      readPartyIdentity(c, kms, created.partyId),
    );
    expect(before.email).toBe('shred@example.com');

    const admin = await withBypass(db.pool, async (c) => {
      const a = await createPartyWithIdentity(c, kms, {
        identity: { email: 'admin@rbit.example' },
      });
      await grantRole(c, { partyId: a.partyId, role: 'rbit_admin' });
      return a;
    });

    await withBypass(db.pool, (c) =>
      cryptoShredParty(c, kms, created.partyId, admin.partyId),
    );

    await expect(
      withBypass(db.pool, (c) => readPartyIdentity(c, kms, created.partyId)),
    ).rejects.toThrow(/unreadable|destroyed|crypto-shredded/i);

    const features = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query(
        `select party_id, application_count from party_features where party_id = $1`,
        [created.partyId],
      );
      return rows[0];
    });
    expect(features?.party_id).toBe(created.partyId);

    const party = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query(
        `select id, purged_at from party where id = $1`,
        [created.partyId],
      );
      return rows[0];
    });
    expect(party?.purged_at).toBeTruthy();

    // Audit FK still valid
    const events = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query(
        `select event_type from domain_event where aggregate_id = $1 order by seq`,
        [created.partyId],
      );
      return rows.map((r) => r.event_type);
    });
    expect(events).toContain('party.crypto_shredded');

    writeEvidence(
      'crypto-shred.txt',
      JSON.stringify(
        {
          partyId: created.partyId,
          beforeEmail: before.email,
          featuresIntact: Boolean(features),
          purgedAt: party?.purged_at,
          events,
        },
        null,
        2,
      ),
    );
  });

  it('hash-chain verifier passes on 1000 rows, fails on one tampered row', async () => {
    const actor = await withBypass(db.pool, (c) =>
      createPartyWithIdentity(c, db.kms, {
        identity: { email: 'hash-actor@example.com' },
      }),
    );

    await withBypass(db.pool, async (c) => {
      await c.query('truncate admin_action_log restart identity');
      for (let i = 0; i < 1000; i++) {
        await appendAdminAction(c, {
          actorPartyId: actor.partyId,
          action: 'test.seed',
          targetType: 'fixture',
          targetId: randomUUID(),
          afterState: { i },
        });
      }
    });

    const ok = await withBypass(db.pool, (c) => verifyAdminActionChain(c));
    expect(ok).toEqual({ ok: true });

    // Tamper one row's after_state without updating row_hash
    await withBypass(db.pool, async (c) => {
      await c.query(
        `update admin_action_log
         set after_state = '{"tampered":true}'::jsonb
         where seq = (select seq from admin_action_log order by seq asc offset 500 limit 1)`,
      );
    });

    const bad = await withBypass(db.pool, (c) => verifyAdminActionChain(c));
    expect(bad.ok).toBe(false);

    writeEvidence(
      'hash-chain.txt',
      JSON.stringify({ verifyClean: ok, verifyTampered: bad }, null, 2),
    );

    // Restore integrity for subsequent tests by truncating and reseeding tip is hard;
    // leave tampered chain — later tests append and would fail. Rebuild from empty:
    await withBypass(db.pool, async (c) => {
      await c.query('truncate admin_action_log restart identity');
    });
  });

  it('dual approval: requester cannot approve own; super admin bypasses', async () => {
    const requester = await withBypass(db.pool, async (c) => {
      const p = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'req@example.com' },
      });
      await grantRole(c, { partyId: p.partyId, role: 'rbit_admin' });
      return p;
    });
    const otherAdmin = await withBypass(db.pool, async (c) => {
      const p = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'other@example.com' },
      });
      await grantRole(c, { partyId: p.partyId, role: 'rbit_admin' });
      return p;
    });
    const superAdmin = await withBypass(db.pool, async (c) => {
      const p = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'super@example.com' },
      });
      await grantRole(c, { partyId: p.partyId, role: 'rbit_super_admin' });
      return p;
    });

    const req = await withBypass(db.pool, (c) =>
      requestDualApproval(c, {
        permissionKey: 'ledger.refund',
        requestedByPartyId: requester.partyId,
        payload: { amount_cents: 100 },
        expiresAt: new Date(Date.now() + 3600_000),
      }),
    );

    await expect(
      withBypass(db.pool, (c) =>
        approveDualApproval(c, {
          requestId: req.id,
          approverPartyId: requester.partyId,
        }),
      ),
    ).rejects.toBeInstanceOf(DualApprovalError);

    const approved = await withBypass(db.pool, (c) =>
      approveDualApproval(c, {
        requestId: req.id,
        approverPartyId: otherAdmin.partyId,
      }),
    );
    expect(approved.status).toBe('approved');
    expect(approved.bypassed).toBe(false);

    const bypassReq = await withBypass(db.pool, (c) =>
      requestDualApproval(c, {
        permissionKey: 'party.purge_immediate',
        requestedByPartyId: superAdmin.partyId,
        payload: {},
        expiresAt: new Date(Date.now() + 3600_000),
      }),
    );
    const bypassed = await withBypass(db.pool, (c) =>
      approveDualApproval(c, {
        requestId: bypassReq.id,
        approverPartyId: superAdmin.partyId,
      }),
    );
    expect(bypassed.bypassed).toBe(true);

    writeEvidence(
      'dual-approval.txt',
      JSON.stringify(
        {
          selfApprovalRejected: true,
          secondAdminApproved: approved,
          superAdminBypass: bypassed,
        },
        null,
        2,
      ),
    );
  });

  it('domain_event emitted for every state transition in seeded fixture run', async () => {
    const expectedTransitions = [
      'org.created',
      'party.created',
      'party.identity_written',
      'party_role.granted',
      'dual_approval.requested',
      'dual_approval.approved',
    ];

    const events = await withBypass(db.pool, async (c) => {
      const org = await createOrg(c, {
        kind: 'rbit',
        legalName: 'RBIT Inc',
        displayName: 'RBIT',
      });
      const party = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'fixture@example.com', givenName: 'Fix' },
      });
      await grantRole(c, {
        partyId: party.partyId,
        orgId: org.id,
        role: 'rbit_admin',
      });
      const dual = await requestDualApproval(c, {
        permissionKey: 'config.approve',
        requestedByPartyId: party.partyId,
        payload: { fixture: true },
        expiresAt: new Date(Date.now() + 3600_000),
      });
      const other = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'fixture2@example.com' },
      });
      await grantRole(c, { partyId: other.partyId, role: 'rbit_admin' });
      await approveDualApproval(c, {
        requestId: dual.id,
        approverPartyId: other.partyId,
      });

      const { rows } = await c.query<{ event_type: string }>(
        `select event_type from domain_event order by seq`,
      );
      return rows.map((r) => r.event_type);
    });

    for (const t of expectedTransitions) {
      expect(events, `missing ${t}`).toContain(t);
    }

    writeEvidence(
      'domain-events.txt',
      JSON.stringify({ expectedTransitions, observed: events }, null, 2),
    );
  });

  it('unit: hash chain pure function sanity', () => {
    const row = {
      id: randomUUID(),
      seq: '1',
      actor_party_id: randomUUID(),
      impersonation_session_id: null,
      dual_approval_request_id: null,
      action: 'test',
      target_type: null,
      target_id: null,
      before_state: null,
      after_state: { a: 1 },
      reason_code: null,
      request_id: null,
      ip: null,
      user_agent: null,
      occurred_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    const h1 = computeRowHash(null, row);
    const h2 = computeRowHash(null, row);
    expect(h1.equals(h2)).toBe(true);
    expect(createHash('sha256').update('x').digest().equals(h1)).toBe(false);
    const chain = verifyHashChain([
      { ...row, prev_hash: null, row_hash: h1 },
    ]);
    expect(chain).toEqual({ ok: true });
  });
});
