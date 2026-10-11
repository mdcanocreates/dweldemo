import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decideOnApplicant } from '../../src/modules/landlord/portal.js';
import { AppError } from '../../src/modules/shared/errors.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import { seedListingPartyApp } from '../helpers/phase2.js';

describe('decideOnApplicant transition enforcement', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('rejects approve from awaiting_landlord_interest with 409', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedListingPartyApp(c, db.kms, {
        email: `tr-${Date.now()}@ex.com`,
      });
      const applicationId = randomUUID();
      await c.query(
        `insert into application (
           id, party_id, renter_profile_id, listing_id, unit_id, org_id,
           entry_point, status, submitted_at
         ) values ($1,$2,$3,$4,$5,$6,'renter_initiated','awaiting_landlord_interest', now())`,
        [
          applicationId,
          seed.partyId,
          seed.renterProfileId,
          seed.listingId,
          seed.unitId,
          seed.orgId,
        ],
      );

      try {
        await decideOnApplicant(c, {
          listingId: seed.listingId,
          applicationId,
          orgId: seed.orgId,
          actorPartyId: seed.partyId,
          decision: 'approve',
        });
        expect.fail('expected 409');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).status).toBe(409);
      }
    });
  });

  it('rejects second conflicting decision after decline', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedListingPartyApp(c, db.kms, {
        email: `tr2-${Date.now()}@ex.com`,
      });
      const applicationId = randomUUID();
      await c.query(
        `insert into application (
           id, party_id, renter_profile_id, listing_id, unit_id, org_id,
           entry_point, status, submitted_at
         ) values ($1,$2,$3,$4,$5,$6,'renter_initiated','awaiting_landlord_interest', now())`,
        [
          applicationId,
          seed.partyId,
          seed.renterProfileId,
          seed.listingId,
          seed.unitId,
          seed.orgId,
        ],
      );

      await decideOnApplicant(c, {
        listingId: seed.listingId,
        applicationId,
        orgId: seed.orgId,
        actorPartyId: seed.partyId,
        decision: 'decline',
      });

      try {
        await decideOnApplicant(c, {
          listingId: seed.listingId,
          applicationId,
          orgId: seed.orgId,
          actorPartyId: seed.partyId,
          decision: 'pass',
          reason_codes: ['income_below'],
        });
        expect.fail('expected 409');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).status).toBe(409);
        expect((err as AppError).code).toBe('invalid_transition');
      }
    });
  });

  it('allows move_forward then is idempotent on awaiting_consent', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedListingPartyApp(c, db.kms, {
        email: `tr3-${Date.now()}@ex.com`,
      });
      const applicationId = randomUUID();
      await c.query(
        `insert into application (
           id, party_id, renter_profile_id, listing_id, unit_id, org_id,
           entry_point, status, submitted_at
         ) values ($1,$2,$3,$4,$5,$6,'renter_initiated','awaiting_landlord_interest', now())`,
        [
          applicationId,
          seed.partyId,
          seed.renterProfileId,
          seed.listingId,
          seed.unitId,
          seed.orgId,
        ],
      );

      const first = await decideOnApplicant(c, {
        listingId: seed.listingId,
        applicationId,
        orgId: seed.orgId,
        actorPartyId: seed.partyId,
        decision: 'move_forward',
      });
      expect(first.status).toBe('awaiting_consent');

      const second = await decideOnApplicant(c, {
        listingId: seed.listingId,
        applicationId,
        orgId: seed.orgId,
        actorPartyId: seed.partyId,
        decision: 'request_screening',
      });
      expect(second.status).toBe('awaiting_consent');
    });
  });
});
