/**
 * Sprint 1: tenant GUC isolation — sequential, concurrent, rollback, reuse,
 * and unauthorized cross-tenant reads.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearTenantContext, setTenantContext } from '../../src/db/session.js';
import { withTenantContext } from '../../src/db/tenant.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import { seedListingPartyApp } from '../helpers/phase2.js';

describe('tenant isolation session (Sprint 1)', () => {
  let db: TestDb;
  let org1: string;
  let org2: string;
  let app1: string;
  let app2: string;

  beforeAll(async () => {
    db = await startTestDb();
    await withBypass(db.pool, async (c) => {
      const a = await seedListingPartyApp(c, db.kms, {
        email: 'iso1@ex.com',
        externalId: 'iso-ext-1',
      });
      const b = await seedListingPartyApp(c, db.kms, {
        email: 'iso2@ex.com',
        externalId: 'iso-ext-2',
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

  function appPool(max = 2) {
    const appUrl = new URL(db.connectionString);
    appUrl.username = 'rbit_app_user';
    appUrl.password = 'rbit_app_user';
    return new pg.Pool({ connectionString: appUrl.toString(), max });
  }

  it('sequential requests from different tenants do not leak rows', async () => {
    const pool = appPool(1);
    try {
      const seen1 = await withTenantContext(pool, { orgId: org1 }, async (c) => {
        const { rows } = await c.query<{ id: string }>(`select id from application`);
        return rows.map((r) => r.id);
      });
      expect(seen1).toContain(app1);
      expect(seen1).not.toContain(app2);

      const seen2 = await withTenantContext(pool, { orgId: org2 }, async (c) => {
        const { rows } = await c.query<{ id: string }>(`select id from application`);
        return rows.map((r) => r.id);
      });
      expect(seen2).toContain(app2);
      expect(seen2).not.toContain(app1);
    } finally {
      await pool.end();
    }
  });

  it('concurrent requests from different tenants stay isolated', async () => {
    const pool = appPool(4);
    try {
      const [a, b] = await Promise.all([
        withTenantContext(pool, { orgId: org1 }, async (c) => {
          const { rows } = await c.query<{ id: string }>(`select id from application`);
          return rows.map((r) => r.id);
        }),
        withTenantContext(pool, { orgId: org2 }, async (c) => {
          const { rows } = await c.query<{ id: string }>(`select id from application`);
          return rows.map((r) => r.id);
        }),
      ]);
      expect(a).toContain(app1);
      expect(a).not.toContain(app2);
      expect(b).toContain(app2);
      expect(b).not.toContain(app1);
    } finally {
      await pool.end();
    }
  });

  it('transaction rollback clears local GUCs on connection reuse', async () => {
    const pool = appPool(1);
    try {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await setTenantContext(client, { orgId: org1 });
        const { rows: mid } = await client.query<{ id: string }>(`select id from application`);
        expect(mid.map((r) => r.id)).toContain(app1);
        await client.query('rollback');
        // After rollback, local GUCs are gone — next txn must set context again.
        await client.query('begin');
        const { rows: after } = await client.query<{ id: string }>(`select id from application`);
        expect(after.length).toBe(0);
        await client.query('rollback');
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  });

  it('connection reuse after withTenantContext does not retain org', async () => {
    const pool = appPool(1);
    try {
      await withTenantContext(pool, { orgId: org1 }, async (c) => {
        const { rows } = await c.query(`select id from application where id = $1`, [app1]);
        expect(rows.length).toBe(1);
      });
      const client = await pool.connect();
      try {
        await client.query('begin');
        const { rows } = await client.query(`select id from application`);
        expect(rows.length).toBe(0);
        await client.query('rollback');
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  });

  it('unauthorized cross-tenant read returns zero rows', async () => {
    const pool = appPool(2);
    try {
      await withTenantContext(pool, { orgId: org1 }, async (c) => {
        const { rows } = await c.query(`select id from application where id = $1`, [app2]);
        expect(rows.length).toBe(0);
      });
    } finally {
      await pool.end();
    }
  });

  it('unauthorized cross-tenant update affects zero rows', async () => {
    const pool = appPool(2);
    try {
      await withTenantContext(pool, { orgId: org1 }, async (c) => {
        const { rowCount } = await c.query(
          `update application set status = 'withdrawn' where id = $1`,
          [app2],
        );
        expect(rowCount).toBe(0);
      });
      await withBypass(db.pool, async (c) => {
        const { rows } = await c.query<{ status: string }>(
          `select status from application where id = $1`,
          [app2],
        );
        expect(rows[0]!.status).toBe('draft');
      });
    } finally {
      await pool.end();
    }
  });

  it('clearTenantContext removes identity mid-transaction', async () => {
    const pool = appPool(1);
    try {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await setTenantContext(client, { orgId: org1 });
        expect(
          (await client.query(`select id from application`)).rows.length,
        ).toBeGreaterThan(0);
        await clearTenantContext(client);
        expect((await client.query(`select id from application`)).rows.length).toBe(0);
        await client.query('rollback');
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  });
});
