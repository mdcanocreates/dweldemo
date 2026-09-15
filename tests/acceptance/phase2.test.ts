import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOrg, createPartyWithIdentity } from '../../src/modules/identity/index.js';
import {
  acceptPlacement,
  markLeaseSigned,
  markPlacementFunded,
} from '../../src/modules/matching/index.js';
import {
  completeAllProductsViaWebhooks,
  createScreeningOrder,
  ensureStandardPackage,
  evaluateAdverseAction,
  evaluateRebateOnFunded,
  grantReportAccess,
  ingestAndProcessCertnWebhook,
  isRiskInsightAutoAdverseEnabled,
  listReviewQueue,
  queryCostByVendorAndDate,
  recomputeBadge,
  recordIncomeVerification,
  resolveReportPortabilityDays,
  STANDARD_PACKAGE,
} from '../../src/modules/screening/index.js';
import {
  resetVendorRegistry,
  resetVendorStubState,
  StubVaultTokenizer,
} from '../../src/modules/vendors/index.js';
import { MutableClock } from '../../src/modules/shared/clock.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import { runTestApplicationPipeline } from '../helpers/phase1-api.js';
import { seedListingPartyApp, seedPhase2TestConfig } from '../helpers/phase2.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'phase2');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

describe('Phase 2 acceptance (§17)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    resetVendorStubState();
    resetVendorRegistry({ tenantScreening: 'certn_stub' });
    await withBypass(db.pool, async (c) => {
      await seedPhase2TestConfig(c);
      await ensureStandardPackage(c);
    });
  });

  it('Full application pipeline E2E against vendor stubs, zero network', async () => {
    const clock = new MutableClock(new Date('2026-06-01T12:00:00Z'));
    const result = await withBypass(db.pool, async (c) => {
      const seed = await seedListingPartyApp(c, db.kms, { email: 'e2e@example.com' });
      const pipeline = await runTestApplicationPipeline(c, {
        partyId: seed.partyId,
        renterProfileId: seed.renterProfileId,
        orgId: seed.orgId,
        listingId: seed.listingId,
        unitId: seed.unitId,
        payerKind: 'applicant',
        listingRentCents: seed.rentCents,
        statedMonthlyIncomeCents: 600000,
        clock,
      });
      expect(pipeline.status).toBe('screening_running');
      await completeAllProductsViaWebhooks(c, pipeline.orderId, clock);
      const { rows: app } = await c.query<{ status: string }>(
        `select status from application where id = $1`,
        [pipeline.applicationId],
      );
      const { rows: order } = await c.query<{ status: string }>(
        `select status from screening_order where id = $1`,
        [pipeline.orderId],
      );
      const badge = await recomputeBadge(c, seed.partyId, clock);
      const { rows: archives } = await c.query<{ n: string }>(
        `select count(*)::text as n from vendor_request_archive`,
      );
      return {
        appStatus: app[0]!.status,
        orderStatus: order[0]!.status,
        badge,
        archiveCount: Number(archives[0]!.n),
        applicationId: pipeline.applicationId,
        orderId: pipeline.orderId,
      };
    });

    expect(result.appStatus).toBe('screened');
    expect(result.orderStatus).toBe('complete');
    expect(result.badge).toBe('fully_screened');
    expect(result.archiveCount).toBeGreaterThan(0);

    writeEvidence(
      'pipeline-e2e.txt',
      JSON.stringify({ ...result, network: 'none', stubs: true }, null, 2) + '\n',
    );
  });

  it('Vendor swap: two TenantScreening impls; config-only switch', async () => {
    const withCertn = await withBypass(db.pool, async (c) => {
      resetVendorRegistry({ tenantScreening: 'certn_stub' });
      const seed = await seedListingPartyApp(c, db.kms, { email: 'swap1@example.com' });
      const p = await runTestApplicationPipeline(c, {
        partyId: seed.partyId,
        renterProfileId: seed.renterProfileId,
        orgId: seed.orgId,
        listingId: seed.listingId,
        unitId: seed.unitId,
        payerKind: 'landlord',
        listingRentCents: seed.rentCents,
        statedMonthlyIncomeCents: 700000,
      });
      const { rows } = await c.query<{ vendor: string }>(
        `select vendor from screening_report where screening_order_id = $1 limit 1`,
        [p.orderId],
      );
      return rows[0]!.vendor;
    });

    const withAlt = await withBypass(db.pool, async (c) => {
      // Config-only switch — same pipeline call site
      resetVendorRegistry({ tenantScreening: 'alternate_screening' });
      const seed = await seedListingPartyApp(c, db.kms, { email: 'swap2@example.com' });
      const p = await runTestApplicationPipeline(c, {
        partyId: seed.partyId,
        renterProfileId: seed.renterProfileId,
        orgId: seed.orgId,
        listingId: seed.listingId,
        unitId: seed.unitId,
        payerKind: 'broker',
        listingRentCents: seed.rentCents,
        statedMonthlyIncomeCents: 700000,
      });
      const { rows } = await c.query<{ vendor: string }>(
        `select vendor from screening_report where screening_order_id = $1 limit 1`,
        [p.orderId],
      );
      return { vendor: rows[0]!.vendor, status: p.status };
    });

    expect(withCertn).toBe('certn_stub');
    expect(withAlt.vendor).toBe('alternate_screening');
    // Alternate completes immediately → may already be screened
    expect(['screening_running', 'screened']).toContain(withAlt.status);

    writeEvidence(
      'vendor-swap.txt',
      `certn_vendor=${withCertn}\nalternate_vendor=${withAlt.vendor}\ncall_site=runTestApplicationPipeline\n`,
    );
  });

  it('Schema scan: no SSN/government-ID column; none in archived payloads', async () => {
    const scan = await withBypass(db.pool, async (c) => {
      const seed = await seedListingPartyApp(c, db.kms, { email: 'ssnscan@example.com' });
      const vault = new StubVaultTokenizer();
      const alias = await vault.acceptAlias({ aliasToken: 'vault-alias-token-abc' });
      await c.query(
        `update party_identity set identity_fingerprint = $2 where party_id = $1`,
        [seed.partyId, alias.identityFingerprint],
      );

      await runTestApplicationPipeline(c, {
        partyId: seed.partyId,
        renterProfileId: seed.renterProfileId,
        orgId: seed.orgId,
        listingId: seed.listingId,
        unitId: seed.unitId,
        payerKind: 'applicant',
        listingRentCents: seed.rentCents,
        statedMonthlyIncomeCents: 550000,
        identityFingerprint: alias.identityFingerprint,
      });

      const { rows: cols } = await c.query<{ table_name: string; column_name: string }>(`
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and (
            column_name ilike '%ssn%'
            or column_name ilike '%social_security%'
            or column_name ilike '%government_id%'
            or column_name ilike '%gov_id%'
            or column_name ilike '%passport%'
            or column_name ilike '%drivers_license%'
          )
      `);

      const { rows: archives } = await c.query<{ request_payload: unknown; response_payload?: unknown }>(
        `select request_payload, null::jsonb as response_payload from vendor_request_archive
         union all
         select response_payload, null from vendor_response_archive`,
      );

      const forbidden = ['ssn', 'social_security', 'government_id', '123-45-6789'];
      const payloadHits: string[] = [];
      for (const row of archives) {
        const text = JSON.stringify(row);
        for (const f of forbidden) {
          if (text.toLowerCase().includes(f)) payloadHits.push(f);
        }
      }

      return { badColumns: cols, payloadHits, archiveRows: archives.length };
    });

    expect(scan.badColumns).toEqual([]);
    expect(scan.payloadHits).toEqual([]);
    writeEvidence(
      'schema-no-ssn.txt',
      `bad_columns=${JSON.stringify(scan.badColumns)}\npayload_hits=${JSON.stringify(scan.payloadHits)}\narchives=${scan.archiveRows}\n`,
    );
  });

  it('Idempotency: same Certn webhook 100× → one transition, one ledger effect', async () => {
    const clock = new MutableClock(new Date('2026-06-02T00:00:00Z'));
    const stats = await withBypass(db.pool, async (c) => {
      const seed = await seedListingPartyApp(c, db.kms, { email: 'idem@example.com' });
      const pipeline = await runTestApplicationPipeline(c, {
        partyId: seed.partyId,
        renterProfileId: seed.renterProfileId,
        orgId: seed.orgId,
        listingId: seed.listingId,
        unitId: seed.unitId,
        payerKind: 'applicant',
        listingRentCents: seed.rentCents,
        statedMonthlyIncomeCents: 600000,
        clock,
      });
      const { rows: reports } = await c.query<{
        vendor_report_id: string;
        report_kind: string;
        cost_cents: number;
        status: string;
      }>(
        `select vendor_report_id, report_kind, cost_cents, status
         from screening_report where screening_order_id = $1 and report_kind = 'credit'`,
        [pipeline.orderId],
      );
      const report = reports[0]!;
      const { rows: ord } = await c.query<{ vendor_order_ref: string }>(
        `select vendor_order_ref from screening_order where id = $1`,
        [pipeline.orderId],
      );

      const payload = {
        event_id: 'certn-evt-idem-credit-1',
        event_type: 'report.completed',
        vendor_order_ref: ord[0]!.vendor_order_ref,
        vendor_report_id: report.vendor_report_id,
        report_kind: 'credit',
        status: 'complete' as const,
        derived_summary: { score_band: 'B' },
        cost_cents: report.cost_cents,
      };

      let transitions = 0;
      let costs = 0;
      for (let i = 0; i < 100; i++) {
        const r = await ingestAndProcessCertnWebhook(c, payload, clock);
        if (r.transitioned) transitions++;
        if (r.costRecorded) costs++;
      }

      const { rows: rpt } = await c.query<{ id: string }>(
        `select id from screening_report where vendor_report_id = $1`,
        [report.vendor_report_id],
      );
      const { rows: statusEvents2 } = await c.query<{ n: string }>(
        `select count(*)::text as n from domain_event
         where aggregate_type = 'screening_report'
           and aggregate_id = $1::uuid
           and event_type = 'screening_report.status_changed'
           and payload->>'to' = 'complete'`,
        [rpt[0]!.id],
      );
      const { rows: costRows } = await c.query<{ n: string }>(
        `select count(*)::text as n from vendor_cost_entry
         where note = $1`,
        [rpt[0]!.id],
      );
      const { rows: webhookRows } = await c.query<{ n: string }>(
        `select count(*)::text as n from vendor_webhook_event
         where vendor_event_id = $1`,
        [payload.event_id],
      );

      return {
        transitions,
        costs,
        statusEventCount: Number(statusEvents2[0]!.n),
        costEntryCount: Number(costRows[0]!.n),
        webhookRows: Number(webhookRows[0]!.n),
      };
    });

    expect(stats.webhookRows).toBe(1);
    expect(stats.statusEventCount).toBe(1);
    expect(stats.costEntryCount).toBe(1);
    expect(stats.transitions).toBe(1);
    expect(stats.costs).toBe(1);

    writeEvidence(
      'webhook-idempotency.txt',
      JSON.stringify(stats, null, 2) + '\n',
    );
  });

  it('Out-of-order: terminal before intermediate → correct final state', async () => {
    const clock = new MutableClock(new Date('2026-06-03T00:00:00Z'));
    const final = await withBypass(db.pool, async (c) => {
      const seed = await seedListingPartyApp(c, db.kms, { email: 'ooo@example.com' });
      const pipeline = await runTestApplicationPipeline(c, {
        partyId: seed.partyId,
        renterProfileId: seed.renterProfileId,
        orgId: seed.orgId,
        listingId: seed.listingId,
        unitId: seed.unitId,
        payerKind: 'applicant',
        listingRentCents: seed.rentCents,
        statedMonthlyIncomeCents: 600000,
        clock,
      });
      const { rows: reports } = await c.query<{
        vendor_report_id: string;
        cost_cents: number;
      }>(
        `select vendor_report_id, cost_cents from screening_report
         where screening_order_id = $1 and report_kind = 'criminal'`,
        [pipeline.orderId],
      );
      const { rows: ord } = await c.query<{ vendor_order_ref: string }>(
        `select vendor_order_ref from screening_order where id = $1`,
        [pipeline.orderId],
      );
      const ref = reports[0]!;
      const orderRef = ord[0]!.vendor_order_ref;

      // Terminal first
      await ingestAndProcessCertnWebhook(
        c,
        {
          event_id: 'ooo-terminal-1',
          event_type: 'report.completed',
          vendor_order_ref: orderRef,
          vendor_report_id: ref.vendor_report_id,
          status: 'complete',
          derived_summary: { clear: true },
          cost_cents: ref.cost_cents,
        },
        clock,
      );
      // Intermediate after
      await ingestAndProcessCertnWebhook(
        c,
        {
          event_id: 'ooo-pending-1',
          event_type: 'report.updated',
          vendor_order_ref: orderRef,
          vendor_report_id: ref.vendor_report_id,
          status: 'pending',
          derived_summary: { progress: 50 },
        },
        clock,
      );

      const { rows } = await c.query<{ status: string; derived_summary: Record<string, unknown> }>(
        `select status, derived_summary from screening_report where vendor_report_id = $1`,
        [ref.vendor_report_id],
      );
      return rows[0]!;
    });

    expect(final.status).toBe('complete');
    expect(final.derived_summary).toMatchObject({ clear: true });
    writeEvidence(
      'out-of-order.txt',
      `final_status=${final.status}\nsummary=${JSON.stringify(final.derived_summary)}\n`,
    );
  });

  it('Partial completion: credit complete + criminal pending → NOT screened', async () => {
    const clock = new MutableClock(new Date('2026-06-04T00:00:00Z'));
    const state = await withBypass(db.pool, async (c) => {
      const seed = await seedListingPartyApp(c, db.kms, { email: 'partial@example.com' });
      const pipeline = await runTestApplicationPipeline(c, {
        partyId: seed.partyId,
        renterProfileId: seed.renterProfileId,
        orgId: seed.orgId,
        listingId: seed.listingId,
        unitId: seed.unitId,
        payerKind: 'applicant',
        listingRentCents: seed.rentCents,
        statedMonthlyIncomeCents: 600000,
        clock,
      });
      await completeAllProductsViaWebhooks(c, pipeline.orderId, clock, {
        skipKinds: ['criminal'],
      });
      const { rows: app } = await c.query<{ status: string }>(
        `select status from application where id = $1`,
        [pipeline.applicationId],
      );
      const { rows: order } = await c.query<{ status: string }>(
        `select status from screening_order where id = $1`,
        [pipeline.orderId],
      );
      const { rows: reports } = await c.query<{ report_kind: string; status: string }>(
        `select report_kind, status from screening_report where screening_order_id = $1`,
        [pipeline.orderId],
      );
      return { app: app[0]!.status, order: order[0]!.status, reports };
    });

    expect(state.app).toBe('screening_running');
    expect(state.order).toBe('partial');
    expect(state.reports.find((r) => r.report_kind === 'credit')?.status).toBe('complete');
    expect(state.reports.find((r) => r.report_kind === 'criminal')?.status).toBe('pending');
    writeEvidence('partial-completion.txt', JSON.stringify(state, null, 2) + '\n');
  });

  it('Badge: identity+income → prechecked; full package → fully_screened', async () => {
    const clock = new MutableClock(new Date('2026-06-05T00:00:00Z'));
    const badges = await withBypass(db.pool, async (c) => {
      const seed = await seedListingPartyApp(c, db.kms, { email: 'badge@example.com' });

      // Identity report alone via minimal order path
      await ensureStandardPackage(c);
      const { orderId } = await createScreeningOrder(c, {
        partyId: seed.partyId,
        payerKind: 'rbit_promotional',
        clock,
      });
      await c.query(
        `update screening_order set status = 'submitted', vendor_order_ref = $2 where id = $1`,
        [orderId, `badge-order-${orderId}`],
      );
      const idReport = randomUUID();
      await c.query(
        `insert into screening_report (
           id, screening_order_id, party_id, vendor, vendor_report_id,
           report_kind, status, issued_at, cost_cents
         ) values ($1,$2,$3,'certn_stub',$4,'identity','complete',$5,299)`,
        [idReport, orderId, seed.partyId, `id-${idReport}`, clock.now()],
      );
      await recordIncomeVerification(c, {
        partyId: seed.partyId,
        method: 'plaid_bank',
        monthlyIncomeCents: 500000,
        clock,
        useVendor: true,
      });
      const prechecked = await recomputeBadge(c, seed.partyId, clock);

      // Complete remaining package products
      for (const kind of ['credit', 'criminal', 'risk_insight'] as const) {
        const rid = randomUUID();
        await c.query(
          `insert into screening_report (
             id, screening_order_id, party_id, vendor, vendor_report_id,
             report_kind, status, issued_at, cost_cents
           ) values ($1,$2,$3,'certn_stub',$4,$5,'complete',$6,100)`,
          [rid, orderId, seed.partyId, `${kind}-${rid}`, kind, clock.now()],
        );
      }
      const full = await recomputeBadge(c, seed.partyId, clock);
      return { prechecked, full };
    });

    expect(badges.prechecked).toBe('prechecked');
    expect(badges.full).toBe('fully_screened');
    writeEvidence('badge-transitions.txt', JSON.stringify(badges, null, 2) + '\n');
  });

  it('Risk Insight gate: decline from RI → review queue while flag false', async () => {
    const result = await withBypass(db.pool, async (c) => {
      const flag = await isRiskInsightAutoAdverseEnabled(c);
      expect(flag).toBe(false);

      const seed = await seedListingPartyApp(c, db.kms, { email: 'ri@example.com' });
      const { rows: app } = await c.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, listing_id, unit_id, org_id,
           entry_point, status
         ) values ($1,$2,$3,$4,$5,'renter_initiated','screening_running')
         returning id`,
        [
          seed.partyId,
          seed.renterProfileId,
          seed.listingId,
          seed.unitId,
          seed.orgId,
        ],
      );
      const adverse = await evaluateAdverseAction(c, {
        applicationId: app[0]!.id,
        partyId: seed.partyId,
        primaryDriver: 'risk_insight',
        reasonCodes: ['eviction_match'],
      });
      const queue = await listReviewQueue(c);
      const { rows: appAfter } = await c.query<{ status: string }>(
        `select status from application where id = $1`,
        [app[0]!.id],
      );
      return { adverse, queueLen: queue.length, appStatus: appAfter[0]!.status, flag };
    });

    expect(result.adverse.action).toBe('review_queue');
    expect(result.appStatus).toBe('screening_running');
    expect(result.appStatus).not.toBe('closed');
    expect(result.queueLen).toBeGreaterThan(0);
    writeEvidence(
      'risk-insight-gate.txt',
      JSON.stringify(result, null, 2) + '\n',
    );
  });

  it('payer_kind all four values without pricing branching at call sites', async () => {
    const kinds = ['applicant', 'landlord', 'broker', 'rbit_promotional'] as const;
    const amounts = await withBypass(db.pool, async (c) => {
      await ensureStandardPackage(c);
      const out: Array<{ payer_kind: string; amount: number }> = [];
      for (const payerKind of kinds) {
        const party = await createPartyWithIdentity(c, db.kms, {
          identity: { email: `${payerKind}@example.com` },
        });
        const { amountChargedCents } = await createScreeningOrder(c, {
          partyId: party.partyId,
          payerKind,
        });
        out.push({ payer_kind: payerKind, amount: amountChargedCents });
      }
      return out;
    });

    expect(amounts).toHaveLength(4);
    expect(new Set(amounts.map((a) => a.amount)).size).toBe(1);
    expect(amounts[0]!.amount).toBe(2946); // screening_package.total_cost_cents (seed)
    writeEvidence(
      'payer-kind.txt',
      `amounts=${JSON.stringify(amounts)}\nsource=screening_package.total_cost_cents\nno_payer_branching=true\n`,
    );
  });

  it('Cost attribution queryable by vendor and date', async () => {
    const clock = new MutableClock(new Date('2026-06-10T15:00:00Z'));
    const costs = await withBypass(db.pool, async (c) => {
      const seed = await seedListingPartyApp(c, db.kms, { email: 'cost@example.com' });
      const pipeline = await runTestApplicationPipeline(c, {
        partyId: seed.partyId,
        renterProfileId: seed.renterProfileId,
        orgId: seed.orgId,
        listingId: seed.listingId,
        unitId: seed.unitId,
        payerKind: 'applicant',
        listingRentCents: seed.rentCents,
        statedMonthlyIncomeCents: 600000,
        clock,
      });
      await completeAllProductsViaWebhooks(c, pipeline.orderId, clock);
      return queryCostByVendorAndDate(c, {
        from: new Date('2026-06-10T00:00:00Z'),
        to: new Date('2026-06-11T00:00:00Z'),
        applicationId: pipeline.applicationId,
      });
    });

    expect(costs.length).toBeGreaterThan(0);
    expect(costs.every((c) => typeof c.vendor === 'string' && c.total_cents > 0)).toBe(true);
    writeEvidence('cost-attribution.txt', JSON.stringify(costs, null, 2) + '\n');
  });

  it('Report portability: three orgs in-window; fourth post-expiry triggers re-pull', async () => {
    const clock = new MutableClock(new Date('2026-07-01T00:00:00Z'));
    const result = await withBypass(db.pool, async (c) => {
      // TEST_ONLY portability window = 30 days from seeded config
      const days = await resolveReportPortabilityDays(c, clock);
      expect(days).toBe(30);

      const seed = await seedListingPartyApp(c, db.kms, { email: 'port@example.com' });
      const pipeline = await runTestApplicationPipeline(c, {
        partyId: seed.partyId,
        renterProfileId: seed.renterProfileId,
        orgId: seed.orgId,
        listingId: seed.listingId,
        unitId: seed.unitId,
        payerKind: 'applicant',
        listingRentCents: seed.rentCents,
        statedMonthlyIncomeCents: 600000,
        clock,
      });
      await completeAllProductsViaWebhooks(c, pipeline.orderId, clock);
      const { rows: reports } = await c.query<{ id: string; expires_at: Date }>(
        `select id, expires_at from screening_report
         where screening_order_id = $1 and report_kind = 'credit'`,
        [pipeline.orderId],
      );
      const reportId = reports[0]!.id;

      const orgs = [];
      for (let i = 0; i < 4; i++) {
        orgs.push(
          await createOrg(c, {
            kind: 'landlord',
            legalName: `Port Org ${i}`,
            displayName: `Port${i}`,
          }),
        );
      }

      const grants = [];
      for (let i = 0; i < 3; i++) {
        grants.push(
          await grantReportAccess(c, {
            reportId,
            grantedToOrgId: orgs[i]!.id,
            actorPartyId: seed.partyId,
            clock,
          }),
        );
      }
      expect(grants.every((g) => g.granted && g.repull === false)).toBe(true);

      // Advance past expiry
      clock.advanceDays(31);
      await c.query(`update screening_report set status = 'expired' where id = $1`, [reportId]);

      let repullCalled = false;
      const fourth = await grantReportAccess(c, {
        reportId,
        grantedToOrgId: orgs[3]!.id,
        actorPartyId: seed.partyId,
        clock,
        repullFn: async (oldId) => {
          repullCalled = true;
          const newId = randomUUID();
          const { rows: old } = await c.query<{ party_id: string; screening_order_id: string }>(
            `select party_id, screening_order_id from screening_report where id = $1`,
            [oldId],
          );
          await c.query(
            `insert into screening_report (
               id, screening_order_id, party_id, vendor, vendor_report_id,
               report_kind, status, issued_at, expires_at, cost_cents
             ) values ($1,$2,$3,'certn_stub',$4,'credit','complete',$5,$6,799)`,
            [
              newId,
              old[0]!.screening_order_id,
              old[0]!.party_id,
              `repull-${newId}`,
              clock.now(),
              new Date(clock.now().getTime() + days * 86400000),
            ],
          );
          return newId;
        },
      });

      const { rows: accessCount } = await c.query<{ n: string }>(
        `select count(*)::text as n from screening_report_access where report_id = $1`,
        [reportId],
      );

      return {
        days,
        inWindowGrants: grants.length,
        fourth,
        repullCalled,
        accessOnOriginal: Number(accessCount[0]!.n),
      };
    });

    expect(result.inWindowGrants).toBe(3);
    expect(result.repullCalled).toBe(true);
    expect(result.fourth.granted).toBe(true);
    if (result.fourth.granted) expect(result.fourth.repull).toBe(true);
    expect(result.accessOnOriginal).toBe(3);
    writeEvidence('report-portability.txt', JSON.stringify(result, null, 2) + '\n');
  });

  it('Rebate: fires on placement.funded not lease_signed; second app same order → no second rebate', async () => {
    const clock = new MutableClock(new Date('2026-08-01T00:00:00Z'));
    const result = await withBypass(db.pool, async (c) => {
      const seed = await seedListingPartyApp(c, db.kms, { email: 'rebate@example.com' });
      const pipeline = await runTestApplicationPipeline(c, {
        partyId: seed.partyId,
        renterProfileId: seed.renterProfileId,
        orgId: seed.orgId,
        listingId: seed.listingId,
        unitId: seed.unitId,
        payerKind: 'applicant',
        listingRentCents: seed.rentCents,
        statedMonthlyIncomeCents: 600000,
        clock,
      });
      await completeAllProductsViaWebhooks(c, pipeline.orderId, clock);

      const { placementId } = await acceptPlacement(c, {
        unitId: seed.unitId,
        listingId: seed.listingId,
        applicationId: pipeline.applicationId,
        partyId: seed.partyId,
        orgId: seed.orgId,
        clock,
      });

      await markLeaseSigned(c, placementId, clock);
      const afterLease = await evaluateRebateOnFunded(c, placementId, clock);
      expect(afterLease.created).toBe(false);

      await markPlacementFunded(c, placementId, clock);
      const afterFunded = await evaluateRebateOnFunded(c, placementId, clock);
      expect(afterFunded.created).toBe(true);

      // Second application on same screening order
      const seed2 = await seedListingPartyApp(c, db.kms, {
        email: 'rebate2@example.com',
        externalId: `rebate2-${randomUUID().slice(0, 6)}`,
      });
      // Reuse same party + order: create second app for same party
      const { rows: app2 } = await c.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, listing_id, unit_id, org_id,
           entry_point, status
         ) values ($1,$2,$3,$4,$5,'renter_initiated','screened') returning id`,
        [
          seed.partyId,
          seed.renterProfileId,
          seed2.listingId,
          seed2.unitId,
          seed2.orgId,
        ],
      );
      await c.query(
        `update screening_order set application_id = $2 where id = $1`,
        [pipeline.orderId, app2[0]!.id],
      );

      // Need a second funded placement — lapse uniqueness: first placement is funded (not holding unit uniquely for hold states)
      // one_active_placement_per_unit only for hold/broker_assigned/lease_signed — funded is OK for new unit
      const { placementId: p2 } = await acceptPlacement(c, {
        unitId: seed2.unitId,
        listingId: seed2.listingId,
        applicationId: app2[0]!.id,
        partyId: seed.partyId,
        orgId: seed2.orgId,
        clock,
      });
      await markLeaseSigned(c, p2, clock);
      await markPlacementFunded(c, p2, clock);
      const second = await evaluateRebateOnFunded(c, p2, clock);

      const { rows: rebates } = await c.query<{ n: string }>(
        `select count(*)::text as n from screening_rebate where screening_order_id = $1`,
        [pipeline.orderId],
      );

      return {
        afterLease,
        afterFunded,
        second,
        rebateCount: Number(rebates[0]!.n),
      };
    });

    expect(result.afterFunded.created).toBe(true);
    expect(result.second.created).toBe(false);
    expect(result.rebateCount).toBe(1);
    writeEvidence('rebate.txt', JSON.stringify(result, null, 2) + '\n');
  });
});
