import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALLOWED_RENTER_SEARCH_FILTERS,
  AllowlistViolationError,
  acceptPlacement,
  assertMinimalSerializer,
  lapseHoldAndPromote,
  searchDiscoverableRenters,
} from '../../src/modules/matching/index.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import { seedWithApplication } from '../helpers/unit-seed.js';

describe('matching unit', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('assertMinimalSerializer rejects identity leaks', () => {
    expect(() => assertMinimalSerializer({ email: 'x@y.com' })).toThrow(/identity field/);
    expect(() => assertMinimalSerializer({ badge_state: 'prechecked' })).not.toThrow();
  });

  it('allowlist rejects unknown filter keys', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedWithApplication(c, db.kms);
      await expect(
        searchDiscoverableRenters(c, {
          actorPartyId: seed.partyId,
          filters: { ssn: 'nope' },
        }),
      ).rejects.toBeInstanceOf(AllowlistViolationError);
    });
    expect(ALLOWED_RENTER_SEARCH_FILTERS).toContain('badge_state');
  });

  it('lapseHoldAndPromote rejects invalid from-status', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedWithApplication(c, db.kms);
      const { placementId } = await acceptPlacement(c, {
        unitId: seed.unitId,
        listingId: seed.listingId,
        applicationId: seed.applicationId,
        partyId: seed.partyId,
        orgId: seed.orgId,
      });
      await c.query(
        `update placement set status = 'lease_signed', lease_signed_at = now() where id = $1`,
        [placementId],
      );
      await expect(lapseHoldAndPromote(c, placementId)).rejects.toMatchObject({
        code: 'placement_invalid_state',
      });
    });
  });

  it('second accept on same unit is placement_conflict', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedWithApplication(c, db.kms, {
        email: `conflict-${Date.now()}@ex.com`,
      });
      await acceptPlacement(c, {
        unitId: seed.unitId,
        listingId: seed.listingId,
        applicationId: seed.applicationId,
        partyId: seed.partyId,
        orgId: seed.orgId,
      });
      const seed2 = await seedWithApplication(c, db.kms, {
        email: `conflict2-${Date.now()}@ex.com`,
      });
      await expect(
        acceptPlacement(c, {
          unitId: seed.unitId,
          listingId: seed.listingId,
          applicationId: seed2.applicationId,
          partyId: seed2.partyId,
          orgId: seed.orgId,
        }),
      ).rejects.toMatchObject({ code: 'placement_conflict' });
    });
  });

  it('hold → funded is rejected (must pass lease_signed)', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedWithApplication(c, db.kms, {
        email: `hold-fund-${Date.now()}@ex.com`,
      });
      const { placementId } = await acceptPlacement(c, {
        unitId: seed.unitId,
        listingId: seed.listingId,
        applicationId: seed.applicationId,
        partyId: seed.partyId,
        orgId: seed.orgId,
      });
      const { markPlacementFunded } = await import('../../src/modules/matching/index.js');
      await expect(markPlacementFunded(c, placementId)).rejects.toMatchObject({
        code: 'placement_invalid_state',
      });
    });
  });
});
