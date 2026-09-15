import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  confirmSearchAlert,
  createSearchAlert,
  getUnmetDemand,
  resetSearchAlertRateLimit,
  runSearchAlertMatchingJob,
  unsubscribeSearchAlert,
} from '../../src/modules/search/index.js';
import { markListingRented, getAdminLeakage } from '../../src/modules/supply/index.js';
import {
  generateSolarRemittanceStatement,
  matchRemittanceToStatement,
  quickQuoteSolar,
  submitSolarDeal,
  markSolarDealInstalled,
} from '../../src/modules/solar/index.js';
import {
  processSequenceWorkerPoll,
  startSequenceForParty,
} from '../../src/modules/notifications/index.js';
import { AppError } from '../../src/modules/shared/errors.js';
import {
  createOrg,
  createPartyWithIdentity,
  grantRole,
} from '../../src/modules/identity/index.js';
import { emitDomainEvent } from '../../src/modules/audit/index.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import { seedPhase6SolarConfig, seedSolarParties } from '../helpers/phase6.js';
import { ensureBrokerPerformance } from '../../src/modules/brokerage/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'part-b');

function writeEvidence(feature: string, name: string, body: string): void {
  const dir = path.join(EVIDENCE, feature);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), body, 'utf8');
}

describe('Part B — B-5 through B-9', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    resetSearchAlertRateLimit();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('B-5 search alerts: auth link, unauth hmac, job, unsub, unmet, rate limit', async () => {
    await withBypass(db.pool, async (c) => {
      const party = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'b5-renter@example.com' },
      });
      const auth = await createSearchAlert(c, {
        partyId: party.partyId,
        submarketId: null,
        rentMaxCents: 200000,
        bedroomsMin: 2,
      });
      expect(auth.confirmationRequired).toBe(false);

      const { rows: linked } = await c.query<{ party_id: string }>(
        `select party_id::text from search_alert where id = $1`,
        [auth.alertId],
      );
      expect(linked[0]!.party_id).toBe(party.partyId);

      const unauth = await createSearchAlert(c, {
        email: 'b5-anon@example.com',
        rentMaxCents: 150000,
      });
      expect(unauth.confirmationRequired).toBe(true);
      expect(unauth.confirmationEmailQueued).toBe(true);
      const { rows: anon } = await c.query<{
        party_id: string | null;
        email_hmac: Buffer | null;
        confirm_token: string | null;
        unsubscribe_token: string;
      }>(
        `select party_id, email_hmac, confirm_token, unsubscribe_token
         from search_alert where id = $1`,
        [unauth.alertId],
      );
      expect(anon[0]!.party_id).toBeNull();
      expect(anon[0]!.email_hmac).toBeTruthy();

      await confirmSearchAlert(c, anon[0]!.confirm_token!);

      // Seed listing published after last_notified
      const org = await createOrg(c, {
        kind: 'landlord',
        legalName: 'B5 LL',
        displayName: 'B5',
      });
      const { rows: addr } = await c.query<{ id: string }>(
        `insert into address (raw_input, normalized_hash, normalizer_vendor, normalizer_version)
         values ('1 B5','b5h','t','1') returning id`,
      );
      const { rows: prop } = await c.query<{ id: string }>(
        `insert into property (address_id, property_type) values ($1,'sfr') returning id`,
        [addr[0]!.id],
      );
      const { rows: unit } = await c.query<{ id: string }>(
        `insert into unit (property_id, unit_label_normalized, bedrooms) values ($1,'',2) returning id`,
        [prop[0]!.id],
      );
      await c.query(
        `insert into listing (org_id, unit_id, origin, rent_amount_cents, status, published_at)
         values ($1,$2,'manual',180000,'active', now())`,
        [org.id, unit[0]!.id],
      );

      const job = await runSearchAlertMatchingJob(c);
      expect(job.notified).toBeGreaterThanOrEqual(1);

      await unsubscribeSearchAlert(c, anon[0]!.unsubscribe_token);
      const { rows: unsubbed } = await c.query<{ is_active: boolean }>(
        `select is_active from search_alert where id = $1`,
        [unauth.alertId],
      );
      expect(unsubbed[0]!.is_active).toBe(false);

      const unmet = await getUnmetDemand(c);
      expect(Array.isArray(unmet)).toBe(true);

      resetSearchAlertRateLimit();
      await createSearchAlert(c, { email: 'rate@example.com' });
      await createSearchAlert(c, { email: 'rate@example.com' });
      await createSearchAlert(c, { email: 'rate@example.com' });
      let status = 0;
      try {
        await createSearchAlert(c, { email: 'rate@example.com' });
      } catch (err) {
        status = (err as AppError).status;
      }
      expect(status).toBe(429);

      writeEvidence('B-5', 'REPORT.md', '# B-5 PASS\n');
    });
  });

  it('B-6 mark-rented leakage', async () => {
    await withBypass(db.pool, async (c) => {
      const org = await createOrg(c, {
        kind: 'landlord',
        legalName: 'B6 LL',
        displayName: 'B6',
      });
      const broker = await createOrg(c, {
        kind: 'brokerage',
        legalName: 'B6 Broker',
        displayName: 'Br',
      });
      await ensureBrokerPerformance(c, broker.id);
      const reporter = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'b6-ll@example.com' },
      });
      const { rows: addr } = await c.query<{ id: string }>(
        `insert into address (raw_input, normalized_hash, normalizer_vendor, normalizer_version)
         values ('1 B6','b6h','t','1') returning id`,
      );
      const { rows: prop } = await c.query<{ id: string }>(
        `insert into property (address_id, property_type) values ($1,'sfr') returning id`,
        [addr[0]!.id],
      );
      const { rows: unit } = await c.query<{ id: string }>(
        `insert into unit (property_id, unit_label_normalized) values ($1,'') returning id`,
        [prop[0]!.id],
      );
      const { rows: listing } = await c.query<{ id: string }>(
        `insert into listing (org_id, unit_id, origin, rent_amount_cents, status)
         values ($1,$2,'manual',200000,'active') returning id`,
        [org.id, unit[0]!.id],
      );

      let bad = 0;
      try {
        await markListingRented(c, {
          listingId: listing[0]!.id,
          rentedVia: '' as never,
          reportedByPartyId: reporter.partyId,
        });
      } catch (err) {
        bad = (err as AppError).status;
      }
      expect(bad).toBe(400);

      try {
        await markListingRented(c, {
          listingId: listing[0]!.id,
          rentedVia: 'rbit_placement',
          reportedByPartyId: reporter.partyId,
        });
      } catch (err) {
        bad = (err as AppError).status;
      }
      expect(bad).toBe(400);

      const { leakageEventId } = await markListingRented(c, {
        listingId: listing[0]!.id,
        rentedVia: 'rbit_broker_offplatform',
        brokerOrgId: broker.id,
        reportedByPartyId: reporter.partyId,
      });
      expect(leakageEventId).toBeTruthy();

      const { rows: events } = await c.query(
        `select 1 from domain_event where event_type = 'listing_rented_off_platform'
         and aggregate_id = $1`,
        [listing[0]!.id],
      );
      expect(events.length).toBeGreaterThanOrEqual(1);

      const { rows: bp } = await c.query<{ leakage_rate: string }>(
        `select leakage_rate::text from broker_performance where org_id = $1`,
        [broker.id],
      );
      expect(Number(bp[0]!.leakage_rate)).toBeGreaterThan(0);

      const admin = await getAdminLeakage(c);
      expect(admin.some((r) => r.rented_via === 'rbit_broker_offplatform')).toBe(true);
      writeEvidence('B-6', 'REPORT.md', '# B-6 PASS\n');
    });
  });

  it('B-7 solar remittance statements', async () => {
    await withBypass(db.pool, async (c) => {
      const cfg = await seedPhase6SolarConfig(c);
      const parties = await seedSolarParties(c, db.kms);
      await c.query(
        `insert into config_version (
           id, namespace, version, payload, effective_from,
           proposed_by_party_id, approved_by_party_id, approved_at
         ) values ($1,'solar_remittance','b7',$2::jsonb, now(), $3, $3, now())`,
        [
          randomUUID(),
          JSON.stringify({ variance_threshold_cents: 1000 }),
          cfg.proposerId,
        ],
      );

      const deal = await submitSolarDeal(c, {
        homeownerPartyId: parties.homeownerPartyId,
        partnerOrgId: parties.partnerOrgId,
        systemSizeKw: 8,
        grossProjectCostCents: 2_000_000,
        salePriceCents: 2_200_000,
        repPartyId: parties.repPartyId,
      });
      expect(deal.decision.decision).toBe('approved');
      await markSolarDealInstalled(c, deal.dealId);

      const periodStart = '2026-07-01';
      const periodEnd = '2026-07-31';
      await c.query(
        `update solar_deal set installed_at = '2026-07-15T12:00:00Z' where id = $1`,
        [deal.dealId],
      );

      const stmt = await generateSolarRemittanceStatement(c, {
        partnerOrgId: parties.partnerOrgId,
        periodStart,
        periodEnd,
      });
      expect(stmt.dealCount).toBe(1);
      expect(stmt.expectedTotalCents).toBe(deal.decision.net_to_rbit_cents);

      const { rows: lines } = await c.query<{ expected_remittance_cents: string }>(
        `select expected_remittance_cents::text from solar_remittance_statement_line
         where statement_id = $1`,
        [stmt.statementId],
      );
      expect(Number(lines[0]!.expected_remittance_cents)).toBe(
        deal.decision.net_to_rbit_cents,
      );

      const { rows: docs } = await c.query<{ org_id: string }>(
        `select org_id::text from document where id = $1`,
        [stmt.documentId],
      );
      expect(docs[0]!.org_id).toBe(parties.partnerOrgId);

      const matched = await matchRemittanceToStatement(c, {
        statementId: stmt.statementId,
        receivedAmountCents: stmt.expectedTotalCents,
      });
      expect(matched.status).toBe('matched');

      const variance = await matchRemittanceToStatement(c, {
        statementId: stmt.statementId,
        receivedAmountCents: stmt.expectedTotalCents + 5000,
      });
      expect(variance.status).toBe('variance');
      writeEvidence('B-7', 'REPORT.md', '# B-7 PASS\n');
    });
  });

  it('B-8 quick-quote <500ms, no DB row, token reuse, expired rerun, role gate', async () => {
    await withBypass(db.pool, async (c) => {
      const cfg = await seedPhase6SolarConfig(c, {
        underwritingVersion: 'b8-uw',
        tiersVersion: 'b8-tiers',
      });
      const parties = await seedSolarParties(c, db.kms);
      await c.query(
        `insert into config_version (
           id, namespace, version, payload, effective_from,
           proposed_by_party_id, approved_by_party_id, approved_at
         ) values ($1,'solar_explanation_templates','b8',$2::jsonb, now(), $3, $3, now())
         on conflict (namespace, version) do nothing`,
        [
          randomUUID(),
          JSON.stringify({
            plain_language:
              'Your customer qualifies for up to {cashback_display} cash back, paid after installation is complete.',
          }),
          cfg.proposerId,
        ],
      );

      const beforeDeals = await c.query<{ n: string }>(
        `select count(*)::text as n from solar_deal`,
      );

      const t0 = Date.now();
      const quote = await quickQuoteSolar(c, {
        actorPartyId: parties.repPartyId,
        salePriceCents: 2_200_000,
        systemSizeKw: 8,
        zipCode: '78701',
      });
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(500);
      expect(quote.plain_language).toMatch(/cash back/i);
      expect(JSON.stringify(quote)).not.toMatch(/net_to_rbit_floor|floor_cents/);

      const afterDeals = await c.query<{ n: string }>(
        `select count(*)::text as n from solar_deal`,
      );
      expect(afterDeals.rows[0]!.n).toBe(beforeDeals.rows[0]!.n);

      const created = await submitSolarDeal(c, {
        homeownerPartyId: parties.homeownerPartyId,
        partnerOrgId: parties.partnerOrgId,
        systemSizeKw: 8,
        grossProjectCostCents: 2_000_000,
        salePriceCents: 2_200_000,
        repPartyId: parties.repPartyId,
        quoteToken: quote.quote_token,
      });
      expect(created.decision.approved_cashback_cents).toBe(
        quote.approved_cashback_cents,
      );

      const expiredClock = { now: () => new Date(Date.now() + 16 * 60_000) };
      const homeowner2 = await createPartyWithIdentity(c, db.kms, {
        identity: { email: `b8-h2-${randomUUID()}@ex.com` },
      });
      await submitSolarDeal(c, {
        homeownerPartyId: homeowner2.partyId,
        partnerOrgId: parties.partnerOrgId,
        systemSizeKw: 8,
        grossProjectCostCents: 2_000_000,
        salePriceCents: 2_200_000,
        repPartyId: parties.repPartyId,
        quoteToken: quote.quote_token,
        clock: expiredClock,
      });
      const { rows: rerun } = await c.query(
        `select 1 from domain_event where event_type = 'solar_quote.expired_rerun'`,
      );
      expect(rerun.length).toBeGreaterThanOrEqual(1);

      let forbidden = 0;
      try {
        await quickQuoteSolar(c, {
          actorPartyId: parties.homeownerPartyId,
          salePriceCents: 2_200_000,
          systemSizeKw: 8,
          zipCode: '78701',
        });
      } catch (err) {
        forbidden = (err as AppError).status;
      }
      expect(forbidden).toBe(403);
      writeEvidence('B-8', 'REPORT.md', `# B-8 PASS\nelapsed_ms=${elapsed}\n`);
    });
  });

  it('B-9 sequences: start, cancel skips step2, delays, seed, batch 100', async () => {
    await withBypass(db.pool, async (c) => {
      const { rows: seeds } = await c.query<{ sequence_key: string }>(
        `select sequence_key from notification_sequence order by sequence_key`,
      );
      expect(seeds.map((s) => s.sequence_key)).toEqual(
        expect.arrayContaining([
          'renter_application_abandoned',
          'landlord_viewed_no_action',
          'broker_lead_inactive',
        ]),
      );

      const party = await createPartyWithIdentity(c, db.kms, {
        identity: { email: `b9-${randomUUID()}@ex.com` },
      });
      const { rows: rp } = await c.query<{ id: string }>(
        `insert into renter_profile (party_id) values ($1) returning id`,
        [party.partyId],
      );
      const org = await createOrg(c, {
        kind: 'landlord',
        legalName: 'B9',
        displayName: 'B9',
      });
      const appId = randomUUID();
      await c.query(
        `insert into application (
           id, party_id, renter_profile_id, org_id, entry_point, status, submitted_at
         ) values ($1,$2,$3,$4,'renter_initiated','submitted', now())`,
        [appId, party.partyId, rp[0]!.id, org.id],
      );

      const base = new Date('2026-08-01T00:00:00Z');
      const { instanceId } = await startSequenceForParty(c, {
        sequenceKey: 'renter_application_abandoned',
        partyId: party.partyId,
        context: { application_id: appId },
        clock: { now: () => base },
      });

      // Step 1 due after 24h
      await processSequenceWorkerPoll(c, {
        clock: { now: () => new Date(base.getTime() + 24 * 3_600_000) },
      });
      const { rows: n1 } = await c.query<{ n: string }>(
        `select count(*)::text as n from notification
         where recipient_party_id = $1 and template_key = 'renter_app_waiting'`,
        [party.partyId],
      );
      expect(Number(n1[0]!.n)).toBe(1);

      // Cancel before step 2
      await emitDomainEvent(c, {
        aggregateType: 'application',
        aggregateId: appId,
        eventType: 'application.status_changed',
        payload: { from: 'submitted', to: 'screening_authorized', party_id: party.partyId },
        actorKind: 'system',
        occurredAt: new Date(base.getTime() + 30 * 3_600_000),
      });
      await c.query(
        `update application set status = 'screening_authorized' where id = $1`,
        [appId],
      );

      await processSequenceWorkerPoll(c, {
        clock: { now: () => new Date(base.getTime() + 24 * 3_600_000 + 72 * 3_600_000) },
      });
      const { rows: inst } = await c.query<{ status: string }>(
        `select status from notification_sequence_instance where id = $1`,
        [instanceId],
      );
      expect(inst[0]!.status).toBe('cancelled');
      const { rows: n2 } = await c.query<{ n: string }>(
        `select count(*)::text as n from notification
         where recipient_party_id = $1 and template_key = 'renter_badge_almost'`,
        [party.partyId],
      );
      expect(Number(n2[0]!.n)).toBe(0);

      // Batch 100
      const parties: string[] = [];
      for (let i = 0; i < 100; i++) {
        const p = await createPartyWithIdentity(c, db.kms, {
          identity: { email: `b9-batch-${i}-${randomUUID()}@ex.com` },
        });
        parties.push(p.partyId);
        await startSequenceForParty(c, {
          sequenceKey: 'broker_lead_inactive',
          partyId: p.partyId,
          clock: { now: () => base },
        });
      }
      const batch = await processSequenceWorkerPoll(c, {
        clock: { now: () => new Date(base.getTime() + 168 * 3_600_000) },
        batchSize: 100,
      });
      expect(batch.processed).toBe(100);
      writeEvidence(
        'B-9',
        'REPORT.md',
        `# B-9 PASS\nbatch_processed=${batch.processed}\n`,
      );
    });
  }, 300_000);
});
