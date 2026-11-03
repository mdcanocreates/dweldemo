import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listPublicListings, getPublicListingById } from '../../src/modules/listings/public.js';
import { createRenterInterest } from '../../src/modules/renter/interest.js';
import {
  activateProviderListingAccessFromWebhook,
  createPropertyListingClaim,
  getActiveProviderAccessPlan,
  orgHasListingLeadAccess,
  verifyPropertyListingClaim,
} from '../../src/modules/provider/listing-access.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';
import { AppError } from '../../src/modules/shared/errors.js';

describe('demo hide, inquiry mock, and provider access seams', () => {
  let db: TestDb;
  let appPool: DbPool;
  let liveId = '';
  let demoId = '';
  let orgId = '';
  let partyId = '';

  beforeAll(async () => {
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
    const seeded = await withBypass(db.pool, async (client) => {
      const org = await client.query<{ id: string }>(
        `insert into org (kind, legal_name, display_name, status, claim_status)
         values ('landlord', 'Next Phase Homes', 'Next Phase', 'active', 'claimed') returning id`,
      );
      const party = await client.query<{ id: string }>(
        `insert into party (kind) values ('person') returning id`,
      );
      async function home(line1: string, demo: boolean, offer?: string) {
        const address = await client.query<{ id: string }>(
          `insert into address (
             raw_input, line1, city, state, postal_code, normalized_hash,
             normalizer_vendor, normalizer_version
           ) values ($1,$1,'Austin','TX','78701',$2,$3,'1') returning id`,
          [line1, `np-${randomUUID()}`, demo ? 'preview_prod_seed' : 'test'],
        );
        const property = await client.query<{ id: string }>(
          `insert into property (address_id, property_type) values ($1, 'residential') returning id`,
          [address.rows[0]!.id],
        );
        const unit = await client.query<{ id: string }>(
          `insert into unit (property_id, unit_label_normalized, bedrooms) values ($1,'1',2) returning id`,
          [property.rows[0]!.id],
        );
        const listing = await client.query<{ id: string }>(
          `insert into listing (
             org_id, unit_id, origin, rent_amount_cents, status, available_on, published_at,
             is_demo, inventory_kind, application_fee_cents, reusable_application_eligible
           ) values ($1,$2,'manual',180000,'active','2026-12-01',now(),$3,$4,$5,$6)
           returning id`,
          [
            org.rows[0]!.id,
            unit.rows[0]!.id,
            demo,
            demo ? 'demo' : 'partner',
            demo ? null : 7500,
            !demo,
          ],
        );
        if (offer) {
          await client.query(
            `insert into listing_offer (
               listing_id, org_id, display_text, offer_type, qualifier_text, offer_status, validated_at
             ) values ($1,$2,$3,'weeks_free','Offer advertised by property; terms apply.','verified', now())`,
            [listing.rows[0]!.id, org.rows[0]!.id, offer],
          );
        }
        return listing.rows[0]!.id;
      }
      const live = await home('410 Catalog Lane', false, '8 weeks free');
      const demoListing = await home('9 Imaginary Way', true);
      return {
        orgId: org.rows[0]!.id,
        partyId: party.rows[0]!.id,
        liveId: live,
        demoId: demoListing,
      };
    });
    orgId = seeded.orgId;
    partyId = seeded.partyId;
    liveId = seeded.liveId;
    demoId = seeded.demoId;
  }, 180_000);

  afterAll(async () => {
    await appPool?.end();
    await db?.stop();
  });

  it('hides demo inventory from public search while preserving the row', async () => {
    await withBypass(db.pool, async (client) => {
      const page = await listPublicListings(client, { limit: 20 });
      const ids = page.listings.map((row) => String(row.id));
      expect(ids).toContain(liveId);
      expect(ids).not.toContain(demoId);
      const live = await getPublicListingById(client, liveId);
      expect(live.offers).toEqual([
        expect.objectContaining({ display_text: '8 weeks free', offer_type: 'weeks_free' }),
      ]);
      expect(live.cashback_cents).toBeNull();
      await expect(getPublicListingById(client, demoId)).rejects.toBeInstanceOf(AppError);
      const stillThere = await client.query<{ count: string }>(
        `select count(*)::text as count from listing where id = $1`,
        [demoId],
      );
      expect(Number(stillThere.rows[0]!.count)).toBe(1);
    });
  });

  it('records a consented inquiry with mock transport and blocks live entitlement without config', async () => {
    await withBypass(db.pool, async (client) => {
      const inquiry = await createRenterInterest(client, {
        partyId,
        listingId: liveId,
        requestedAction: 'request_information',
        consentVersion: 'listing_inquiry_v1',
        contactShareScope: ['email'],
        idempotencyKey: 'inq-1',
      });
      expect(inquiry.notification.transport).toBe('mock');
      expect(inquiry.notification.status).toBe('sent_mock');

      expect(await getActiveProviderAccessPlan(client)).toBeNull();
      const claim = await createPropertyListingClaim(client, {
        listingId: liveId,
        partyId,
        orgId,
        evidenceSummary: 'Management agreement on file for review',
      });
      await verifyPropertyListingClaim(client, {
        claimToken: claim.claim_token,
        listingId: liveId,
      });

      await client.query(
        `insert into provider_access_plan (plan_key, billing_model, amount_cents, currency, active)
         values ('per_listing_lead_access_v1', 'per_listing', 5000, 'usd', true)
         on conflict (plan_key) do update set amount_cents = 5000, active = true`,
      );
      const plan = await getActiveProviderAccessPlan(client);
      expect(plan?.amount_cents).toBe(5000);
      const access = await activateProviderListingAccessFromWebhook(client, {
        orgId,
        listingId: liveId,
        planId: plan!.id,
        billingModel: 'per_listing',
        paymentIntentId: 'pi_test_123',
        stripeMode: 'test',
      });
      expect(access.entitlement_status).toBe('active');
      expect(await orgHasListingLeadAccess(client, { orgId, listingId: liveId })).toBe(true);

      await expect(
        activateProviderListingAccessFromWebhook(client, {
          orgId,
          listingId: liveId,
          planId: plan!.id,
          billingModel: 'per_listing',
          paymentIntentId: 'pi_live_blocked',
          stripeMode: 'live',
        }),
      ).rejects.toMatchObject({ code: 'live_charge_blocked' });
    });
  });
});
