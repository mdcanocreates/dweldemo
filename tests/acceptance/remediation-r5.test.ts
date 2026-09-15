import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearTenantContext, setTenantContext } from '../../src/db/session.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import { seedListingPartyApp } from '../helpers/phase2.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'remediation', 'R-5');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

/**
 * R-5: prove transaction-local tenant GUCs (set_config is_local=true) do not bleed
 * across pooled connections after COMMIT.
 *
 * Uses `application` (org-scoped, no public-read policy). `listing` now has
 * listing_public_active_read for anonymous browse — that intentional product
 * policy would make "zero rows without org" false for listings and is the wrong
 * probe for tenant-bleed.
 */
describe('R-5 remediation — pooled tenant bleed', () => {
  let db: TestDb;
  let org1: string;
  let org2: string;
  let app1: string;
  let app2: string;

  beforeAll(async () => {
    db = await startTestDb();
    await withBypass(db.pool, async (c) => {
      const a = await seedListingPartyApp(c, db.kms, {
        email: 'bleed1@ex.com',
        externalId: 'bleed-ext-1',
      });
      const b = await seedListingPartyApp(c, db.kms, {
        email: 'bleed2@ex.com',
        externalId: 'bleed-ext-2',
      });
      org1 = a.orgId;
      org2 = b.orgId;

      const { rows: aApp } = await c.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, listing_id, unit_id, org_id, entry_point, status
         ) values ($1,$2,$3,$4,$5,'renter_initiated','draft') returning id`,
        [a.partyId, a.renterProfileId, a.listingId, a.unitId, a.orgId],
      );
      const { rows: bApp } = await c.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, listing_id, unit_id, org_id, entry_point, status
         ) values ($1,$2,$3,$4,$5,'renter_initiated','draft') returning id`,
        [b.partyId, b.renterProfileId, b.listingId, b.unitId, b.orgId],
      );
      app1 = aApp[0]!.id;
      app2 = bApp[0]!.id;
    });
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('max:1 pool — txn B without org sees zero application rows after txn A (org1) commits', async () => {
    const appUrl = new URL(db.connectionString);
    appUrl.username = 'rbit_app_user';
    appUrl.password = 'rbit_app_user';
    const pool = new pg.Pool({ connectionString: appUrl.toString(), max: 1 });

    try {
      {
        const client = await pool.connect();
        try {
          await client.query('begin');
          await setTenantContext(client, { orgId: org1 });
          const { rows } = await client.query<{ id: string }>(
            `select id from application where id = $1`,
            [app1],
          );
          expect(rows.length).toBe(1);
          await client.query('commit');
        } catch (e) {
          await client.query('rollback');
          throw e;
        } finally {
          client.release();
        }
      }

      {
        const client = await pool.connect();
        try {
          await client.query('begin');
          await clearTenantContext(client);
          const { rows } = await client.query<{ id: string }>(`select id from application`);
          expect(rows.length).toBe(0);
          writeEvidence(
            'pooled-bleed-pass.txt',
            [
              `probe_table=application`,
              `txnA org1 commit → txnB no org → application rows=${rows.length}`,
              `setTenantContext uses set_config(..., is_local=true)`,
              `listing_public_active_read exists but does not apply to application`,
              '',
            ].join('\n'),
          );
          await client.query('commit');
        } catch (e) {
          await client.query('rollback');
          throw e;
        } finally {
          client.release();
        }
      }

      {
        const client = await pool.connect();
        try {
          await client.query('begin');
          await setTenantContext(client, { orgId: org2 });
          const { rows } = await client.query<{ id: string; org_id: string }>(
            `select id, org_id::text from application`,
          );
          expect(rows.length).toBe(1);
          expect(rows[0]!.org_id).toBe(org2);
          expect(rows[0]!.id).toBe(app2);
          await client.query('commit');
          writeEvidence(
            'pooled-org2-only.txt',
            `txnB org2 → application rows=${rows.length} org=${rows[0]!.org_id}\n`,
          );
        } catch (e) {
          await client.query('rollback');
          throw e;
        } finally {
          client.release();
        }
      }
    } finally {
      await pool.end();
    }
  });

  it('teeth: set_config(..., false) leaks org1 into next txn; production path uses true', async () => {
    const appUrl = new URL(db.connectionString);
    appUrl.username = 'rbit_app_user';
    appUrl.password = 'rbit_app_user';
    const pool = new pg.Pool({ connectionString: appUrl.toString(), max: 1 });
    try {
      {
        const client = await pool.connect();
        try {
          await client.query('begin');
          // Intentional anti-pattern — session-scoped GUC (is_local=false).
          await client.query(`select set_config('rbit.current_org_id', $1, false)`, [org1]);
          await client.query(`select set_config('rbit.bypass_rls', 'off', false)`);
          const { rows } = await client.query(`select id from application`);
          expect(rows.length).toBeGreaterThanOrEqual(1);
          await client.query('commit');
        } finally {
          client.release();
        }
      }
      {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const { rows } = await client.query<{ org_id: string }>(
            `select org_id::text from application`,
          );
          const leaked = rows.length > 0 && rows.every((r) => r.org_id === org1);
          writeEvidence(
            'teeth-set-config-false-bleed.txt',
            [
              `After set_config(..., false) + commit, next txn without context saw application rows=${rows.length} leakedOrg1=${leaked}`,
              `Production setTenantContext/withTenantContext use is_local=true only (grep src: zero set_config false).`,
              `This test documents the failure mode that session.ts must not reintroduce.`,
              '',
            ].join('\n'),
          );
          expect(leaked).toBe(true);
          await client.query('commit');
        } finally {
          await client.query(`select set_config('rbit.current_org_id', '', false)`);
          client.release();
        }
      }

      // Contrast: transaction-local path must NOT leak on the same max:1 pool.
      {
        const client = await pool.connect();
        try {
          await client.query('begin');
          await setTenantContext(client, { orgId: org1 });
          expect(
            (await client.query(`select id from application where id = $1`, [app1])).rows.length,
          ).toBe(1);
          await client.query('commit');
        } finally {
          client.release();
        }
      }
      {
        const client = await pool.connect();
        try {
          await client.query('begin');
          await clearTenantContext(client);
          const { rows } = await client.query(`select id from application`);
          expect(rows.length).toBe(0);
          writeEvidence(
            'production-path-no-bleed.txt',
            `setTenantContext is_local=true → after commit, next txn application rows=${rows.length}\n`,
          );
          await client.query('commit');
        } finally {
          client.release();
        }
      }
    } finally {
      await pool.end();
    }
  });
});
