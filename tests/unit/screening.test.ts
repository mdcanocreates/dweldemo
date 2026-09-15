import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbClient } from '../../src/db/pool.js';
import { assertMethodHierarchy } from '../../src/modules/screening/income.js';
import {
  createScreeningOrder,
  transitionOrderStatus,
} from '../../src/modules/screening/order.js';
import { recomputeBadge } from '../../src/modules/screening/badge.js';
import { evaluateRebateOnFunded } from '../../src/modules/screening/rebate.js';
import { ensureStandardPackage } from '../../src/modules/screening/config.js';
import { acceptPlacement, markLeaseSigned, markPlacementFunded } from '../../src/modules/matching/index.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import { seedWithApplication } from '../helpers/unit-seed.js';

async function insertCompleteReport(
  client: DbClient,
  partyId: string,
  orderId: string,
  kind: string,
): Promise<void> {
  await client.query(
    `insert into screening_report (
       id, screening_order_id, party_id, vendor, vendor_report_id,
       report_kind, status, cost_cents
     ) values ($1,$2,$3,'certn',$4,$5,'complete',0)`,
    [randomUUID(), orderId, partyId, `${kind}-${randomUUID()}`, kind],
  );
}

describe('screening unit', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('assertMethodHierarchy rejects unknown methods', () => {
    expect(() => assertMethodHierarchy(['plaid_bank', 'stated'])).not.toThrow();
    expect(() => assertMethodHierarchy(['telepathy'])).toThrow(/unknown income method/);
  });

  it('terminal order status rejects illegal transitions with typed error', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedWithApplication(c, db.kms);
      await ensureStandardPackage(c);
      const order = await createScreeningOrder(c, {
        partyId: seed.partyId,
        payerKind: 'applicant',
      });
      await transitionOrderStatus(c, order.orderId, 'complete');
      await expect(transitionOrderStatus(c, order.orderId, 'partial')).rejects.toMatchObject({
        code: 'order_invalid_transition',
      });
      const { rows } = await c.query<{ status: string }>(
        `select status from screening_order where id = $1`,
        [order.orderId],
      );
      expect(rows[0]!.status).toBe('complete');
    });
  });

  it('payer_kind branches charge identical package cents', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedWithApplication(c, db.kms);
      await ensureStandardPackage(c);
      const kinds = ['applicant', 'landlord', 'broker', 'rbit_promotional'] as const;
      const amounts: number[] = [];
      for (const k of kinds) {
        const o = await createScreeningOrder(c, {
          partyId: seed.partyId,
          payerKind: k,
        });
        amounts.push(o.amountChargedCents);
      }
      expect(new Set(amounts).size).toBe(1);
      expect(amounts[0]).toBe(2946);
    });
  });

  it('badge: unverified → prechecked → fully_screened', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedWithApplication(c, db.kms, {
        email: `badge-${Date.now()}@ex.com`,
      });
      await ensureStandardPackage(c);
      let b = await recomputeBadge(c, seed.partyId);
      expect(b).toBe('unverified');

      const order = await createScreeningOrder(c, {
        partyId: seed.partyId,
        payerKind: 'applicant',
      });
      await insertCompleteReport(c, seed.partyId, order.orderId, 'identity');
      await c.query(
        `insert into income_verification (
           id, party_id, method, confidence, monthly_income_cents, verified_at
         ) values ($1,$2,'stated',0.2,500000,now())`,
        [randomUUID(), seed.partyId],
      );
      b = await recomputeBadge(c, seed.partyId);
      expect(b).toBe('prechecked');

      for (const kind of ['credit', 'criminal', 'risk_insight']) {
        await insertCompleteReport(c, seed.partyId, order.orderId, kind);
      }
      b = await recomputeBadge(c, seed.partyId);
      expect(b).toBe('fully_screened');
    });
  });

  it('rebate not created unless placement funded', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedWithApplication(c, db.kms, {
        email: `rebate-${Date.now()}@ex.com`,
      });
      await ensureStandardPackage(c);
      const order = await createScreeningOrder(c, {
        partyId: seed.partyId,
        applicationId: seed.applicationId,
        payerKind: 'applicant',
      });
      await transitionOrderStatus(c, order.orderId, 'complete');
      const { placementId } = await acceptPlacement(c, {
        unitId: seed.unitId,
        listingId: seed.listingId,
        applicationId: seed.applicationId,
        partyId: seed.partyId,
        orgId: seed.orgId,
      });
      const before = await evaluateRebateOnFunded(c, placementId);
      expect(before.created).toBe(false);

      await markLeaseSigned(c, placementId);
      await markPlacementFunded(c, placementId);
      const after = await evaluateRebateOnFunded(c, placementId);
      expect(after.created).toBe(true);
    });
  });
});
