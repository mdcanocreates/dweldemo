/**
 * F-2 — invalid-transition tests for every product state machine.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptPlacement,
  lapseHoldAndPromote,
  markLeaseSigned,
  markPlacementFunded,
} from '../../src/modules/matching/index.js';
import {
  createAndClassifyLead,
  offerLeadToNextBroker,
  purchaseLeadWithBalance,
  respondToLeadOffer,
} from '../../src/modules/brokerage/index.js';
import {
  createScreeningOrder,
  ensureStandardPackage,
  forceApplicationTransition,
  transitionOrderStatus,
} from '../../src/modules/screening/index.js';
import { confirmListing } from '../../src/modules/supply/index.js';
import {
  approveOrgClaim,
  createUnclaimedIngestionOrg,
  submitOrgClaim,
} from '../../src/modules/ingestion/org-claim.js';
import { cancelSolarDeal, markSolarDealInstalled } from '../../src/modules/solar/index.js';
import { createPartyWithIdentity, grantRole } from '../../src/modules/identity/index.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import { seedWithApplication } from '../helpers/unit-seed.js';
import { seedBrokerOrg, seedLeadWorld, seedPhase3TestConfig } from '../helpers/phase3.js';

describe('state machines — invalid transitions', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('placement: hold → funded is rejected', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedWithApplication(c, db.kms, {
        email: `sm-place-${Date.now()}@ex.com`,
      });
      const { placementId } = await acceptPlacement(c, {
        unitId: seed.unitId,
        listingId: seed.listingId,
        applicationId: seed.applicationId,
        partyId: seed.partyId,
        orgId: seed.orgId,
      });
      await expect(markPlacementFunded(c, placementId)).rejects.toMatchObject({
        code: 'placement_invalid_state',
      });
      await markLeaseSigned(c, placementId);
      await markPlacementFunded(c, placementId);
    });
  });

  it('placement: lapse from lease_signed is rejected', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedWithApplication(c, db.kms, {
        email: `sm-lapse-${Date.now()}@ex.com`,
      });
      const { placementId } = await acceptPlacement(c, {
        unitId: seed.unitId,
        listingId: seed.listingId,
        applicationId: seed.applicationId,
        partyId: seed.partyId,
        orgId: seed.orgId,
      });
      await markLeaseSigned(c, placementId);
      await expect(lapseHoldAndPromote(c, placementId)).rejects.toMatchObject({
        code: 'placement_invalid_state',
      });
    });
  });

  it('screening_order: complete → partial rejected', async () => {
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
    });
  });

  it('application: closed → screening_running rejected', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedWithApplication(c, db.kms, {
        email: `sm-app-${Date.now()}@ex.com`,
      });
      await c.query(`update application set status = 'closed', closed_at = now() where id = $1`, [
        seed.applicationId,
      ]);
      await expect(
        forceApplicationTransition(c, seed.applicationId, 'closed', 'screening_running'),
      ).rejects.toMatchObject({ code: 'application_invalid_transition' });
    });
  });

  it('listing: rented → confirm rejected', async () => {
    await withBypass(db.pool, async (c) => {
      const seed = await seedWithApplication(c, db.kms, {
        email: `sm-list-${Date.now()}@ex.com`,
      });
      await c.query(`update listing set status = 'rented', rented_at = now() where id = $1`, [
        seed.listingId,
      ]);
      await expect(confirmListing(c, seed.listingId)).rejects.toMatchObject({
        code: 'listing_invalid_transition',
      });
    });
  });

  it('lead: released → purchased rejected', async () => {
    await withBypass(db.pool, async (c) => {
      await seedPhase3TestConfig(c);
      const world = await seedLeadWorld(c, db.kms, {
        email: `sm-lead-${Date.now()}@ex.com`,
        rentCents: 200000,
      });
      const broker = await seedBrokerOrg(c, { submarketId: world.submarketId });
      const lead = await createAndClassifyLead(c, {
        applicationId: world.applicationId,
        listingId: world.listingId,
        partyId: world.partyId,
      });
      await offerLeadToNextBroker(c, { leadId: lead.id });
      const { rows: offers } = await c.query<{ id: string }>(
        `select id from lead_offer where lead_id = $1`,
        [lead.id],
      );
      await respondToLeadOffer(c, { offerId: offers[0]!.id, response: 'accepted' });
      await c.query(`update lead set status = 'released' where id = $1`, [lead.id]);
      await expect(
        purchaseLeadWithBalance(c, {
          leadId: lead.id,
          brokerOrgId: broker.orgId,
        }),
      ).rejects.toMatchObject({ code: 'LEAD_INVALID_STATUS' });
    });
  });

  it('lead_offer: double respond → OFFER_CLOSED', async () => {
    await withBypass(db.pool, async (c) => {
      await seedPhase3TestConfig(c);
      const world = await seedLeadWorld(c, db.kms, {
        email: `sm-offer-${Date.now()}@ex.com`,
        rentCents: 200000,
      });
      await seedBrokerOrg(c, { submarketId: world.submarketId });
      const lead = await createAndClassifyLead(c, {
        applicationId: world.applicationId,
        listingId: world.listingId,
        partyId: world.partyId,
      });
      await offerLeadToNextBroker(c, { leadId: lead.id });
      const { rows: offers } = await c.query<{ id: string }>(
        `select id from lead_offer where lead_id = $1`,
        [lead.id],
      );
      await respondToLeadOffer(c, { offerId: offers[0]!.id, response: 'accepted' });
      await expect(
        respondToLeadOffer(c, { offerId: offers[0]!.id, response: 'declined' }),
      ).rejects.toMatchObject({ code: 'OFFER_CLOSED' });
    });
  });

  it('solar_deal: declined → installed rejected', async () => {
    await withBypass(db.pool, async (c) => {
      const partner = await c.query<{ id: string }>(
        `insert into org (id, kind, legal_name, display_name)
         values ($1, 'solar_partner', 'Solar SM', 'Solar SM') returning id`,
        [randomUUID()],
      );
      const homeowner = await createPartyWithIdentity(c, db.kms, {
        identity: { email: `sm-solar-${Date.now()}@ex.com` },
      });
      const { rows } = await c.query<{ id: string }>(
        `insert into solar_deal (
           id, partner_org_id, homeowner_party_id, status,
           system_size_kw, gross_project_cost_cents, sale_price_cents
         ) values ($1,$2,$3,'declined',5,100000,120000)
         returning id`,
        [randomUUID(), partner.rows[0]!.id, homeowner.partyId],
      );
      const dealId = rows[0]!.id;
      await expect(markSolarDealInstalled(c, dealId)).rejects.toMatchObject({
        code: 'solar_invalid_transition',
      });
      await expect(cancelSolarDeal(c, dealId)).rejects.toMatchObject({
        code: 'solar_invalid_transition',
      });
    });
  });

  it('org_claim: approve twice → claim_not_pending', async () => {
    await withBypass(db.pool, async (c) => {
      const { orgId } = await createUnclaimedIngestionOrg(c, {
        legalName: `Claim ${randomUUID().slice(0, 6)}`,
        displayName: 'Claim',
      });
      const claimant = await createPartyWithIdentity(c, db.kms, {
        identity: { email: `sm-claim-${Date.now()}@ex.com` },
      });
      const claim = await submitOrgClaim(c, {
        orgId,
        claimantPartyId: claimant.partyId,
        method: 'admin_manual',
        evidence: { note: 'test' },
      });
      const approver = await createPartyWithIdentity(c, db.kms, {
        identity: { email: `sm-appr-${Date.now()}@ex.com` },
      });
      await grantRole(c, { partyId: approver.partyId, role: 'rbit_admin' });
      await approveOrgClaim(c, {
        claimId: claim.claimId,
        reviewedByPartyId: approver.partyId,
      });
      await expect(
        approveOrgClaim(c, {
          claimId: claim.claimId,
          reviewedByPartyId: approver.partyId,
        }),
      ).rejects.toMatchObject({ code: 'claim_not_pending' });
    });
  });
});
