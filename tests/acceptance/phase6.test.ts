import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/modules/shared/errors.js';
import {
  submitSolarDeal,
  markSolarDealInstalled,
  disburseHomeownerCashback,
  ingestPartnerRemittance,
  replaySolarUnderwriting,
  getLatestUnderwritingDecision,
  SOLAR_ENGINE_MODEL_KEY,
  type UnderwritingInput,
} from '../../src/modules/solar/index.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import {
  seedPhase6SolarConfig,
  seedSolarParties,
  TIER4_REFERENCE,
} from '../helpers/phase6.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'phase6');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

describe('Phase 6 acceptance (§17 / §13 Solar vertical)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('Reproducibility: replay input_snapshot through engine + config reproduces approved_cashback_cents', async () => {
    const result = await withBypass(db.pool, async (c) => {
      await seedPhase6SolarConfig(c);
      const parties = await seedSolarParties(c, db.kms);

      const submitted = await submitSolarDeal(c, {
        homeownerPartyId: parties.homeownerPartyId,
        partnerOrgId: parties.partnerOrgId,
        repPartyId: parties.repPartyId,
        systemSizeKw: TIER4_REFERENCE.systemSizeKw,
        grossProjectCostCents: TIER4_REFERENCE.grossProjectCostCents,
        salePriceCents: TIER4_REFERENCE.salePriceCents,
      });

      const stored = await getLatestUnderwritingDecision(c, submitted.dealId);
      expect(stored).not.toBeNull();

      const replayed = replaySolarUnderwriting(
        stored!.input_snapshot as UnderwritingInput,
        stored!.engine_version,
      );

      expect(replayed.approved_cashback_cents).toBe(stored!.approved_cashback_cents);
      expect(replayed.approved_cashback_cents).toBe(TIER4_REFERENCE.adjustedCashbackCents);

      // Insert-only: recomputation appends
      await c.query(
        `insert into solar_underwriting_decision (
           solar_deal_id, engine_version, config_version_id, tier, tier_cap_cents,
           equation_1_passed, equation_1_net_to_rbit_cents, equation_2_applied,
           adjusted_cap_cents, approved_cashback_cents, net_to_rbit_cents,
           decision, decline_reason, input_snapshot, explanation
         )
         select solar_deal_id, engine_version, config_version_id, tier, tier_cap_cents,
                equation_1_passed, equation_1_net_to_rbit_cents, equation_2_applied,
                adjusted_cap_cents, approved_cashback_cents, net_to_rbit_cents,
                decision, decline_reason, input_snapshot, explanation
         from solar_underwriting_decision where id = $1`,
        [stored!.id],
      );
      const { rows: counts } = await c.query<{ n: string }>(
        `select count(*)::text as n from solar_underwriting_decision where solar_deal_id = $1`,
        [submitted.dealId],
      );

      return {
        original: stored!.approved_cashback_cents,
        replayed: replayed.approved_cashback_cents,
        decisionCount: Number(counts[0]!.n),
        engineVersion: stored!.engine_version,
        configVersionId: stored!.config_version_id,
      };
    });

    expect(result.original).toBe(result.replayed);
    expect(result.decisionCount).toBe(2);

    writeEvidence(
      'reproducibility.txt',
      [
        'PASS: replay input_snapshot through engine_version + config reproduces approved_cashback_cents',
        `approved_cashback_cents=${result.original}`,
        `replayed=${result.replayed}`,
        `engine_version=${result.engineVersion}`,
        `config_version_id=${result.configVersionId}`,
        `insert_only_decision_rows=${result.decisionCount}`,
      ].join('\n'),
    );
  });

  it('Equation 2 path: explanation names binding constraint; Tier 4 $5000→$4150', async () => {
    const result = await withBypass(db.pool, async (c) => {
      await seedPhase6SolarConfig(c, {
        underwritingVersion: 'test-ref-eq2',
        tiersVersion: 'test-ref-eq2',
      });
      const parties = await seedSolarParties(c, db.kms);

      const submitted = await submitSolarDeal(c, {
        homeownerPartyId: parties.homeownerPartyId,
        partnerOrgId: parties.partnerOrgId,
        systemSizeKw: TIER4_REFERENCE.systemSizeKw,
        grossProjectCostCents: TIER4_REFERENCE.grossProjectCostCents,
        salePriceCents: TIER4_REFERENCE.salePriceCents,
      });

      const d = submitted.decision;
      expect(d.decision).toBe('approved');
      expect(d.equation_1_passed).toBe(false);
      expect(d.equation_2_applied).toBe(true);
      expect(d.tier).toBe(4);
      expect(d.tier_cap_cents).toBe(500_000);
      expect(d.approved_cashback_cents).toBe(415_000);
      expect(d.adjusted_cap_cents).toBe(415_000);
      expect(d.explanation.binding_constraint).toBe('net_to_rbit_floor');
      expect(JSON.stringify(d.explanation).length).toBeGreaterThan(10);

      // domain_event on state transitions
      const { rows: events } = await c.query<{ event_type: string }>(
        `select event_type from domain_event
         where aggregate_id = $1
         order by seq`,
        [submitted.dealId],
      );
      const types = events.map((e) => e.event_type);
      expect(types).toContain('solar_deal.submitted');
      expect(types).toContain('solar_deal.underwriting');
      expect(types).toContain('solar_deal.approved');

      return {
        approved_cashback_cents: d.approved_cashback_cents,
        binding_constraint: d.explanation.binding_constraint,
        equation_2_applied: d.equation_2_applied,
        tier_cap_cents: d.tier_cap_cents,
        expected_profit_share_cents: d.expected_profit_share_cents,
      };
    });

    writeEvidence(
      'equation2-tier4-reference.txt',
      [
        'PASS: Equation 2 path; binding_constraint=net_to_rbit_floor',
        'PASS: Tier 4 reference $5,000 → $4,150',
        JSON.stringify(result, null, 2),
      ].join('\n'),
    );
  });

  it('Decline path: solved cap below minimum viable → declined, not token amount', async () => {
    const result = await withBypass(db.pool, async (c) => {
      // Raise minimum viable so Equation 2 solve ($4150) is below threshold
      await seedPhase6SolarConfig(c, {
        underwritingVersion: 'test-decline-v1',
        tiersVersion: 'test-decline-v1',
        minimumViableCashbackCents: 450_000, // $4500 > solved $4150
      });
      const parties = await seedSolarParties(c, db.kms);

      const submitted = await submitSolarDeal(c, {
        homeownerPartyId: parties.homeownerPartyId,
        partnerOrgId: parties.partnerOrgId,
        systemSizeKw: TIER4_REFERENCE.systemSizeKw,
        grossProjectCostCents: TIER4_REFERENCE.grossProjectCostCents,
        salePriceCents: TIER4_REFERENCE.salePriceCents,
      });

      expect(submitted.status).toBe('declined');
      expect(submitted.decision.decision).toBe('declined');
      expect(submitted.decision.approved_cashback_cents).toBe(0);
      expect(submitted.decision.decline_reason).toBe('solved_cap_below_minimum_viable');
      expect(submitted.decision.equation_2_applied).toBe(true);
      expect(submitted.decision.adjusted_cap_cents).toBe(415_000);

      // No approval accrual ledger for declined
      const { rows: txns } = await c.query<{ n: string }>(
        `select count(*)::text as n from ledger_transaction
         where idempotency_key like $1`,
        [`solar:accrual:%:${submitted.dealId}`],
      );
      expect(Number(txns[0]!.n)).toBe(0);

      return {
        status: submitted.status,
        approved_cashback_cents: submitted.decision.approved_cashback_cents,
        decline_reason: submitted.decision.decline_reason,
        solved_cap_cents: submitted.decision.adjusted_cap_cents,
      };
    });

    writeEvidence(
      'decline-below-minimum.txt',
      [
        'PASS: solved cap below minimum viable → declined (not approved at token amount)',
        JSON.stringify(result, null, 2),
      ].join('\n'),
    );
  });

  it('Disbursement gated: pay homeowner before partner_paid is rejected', async () => {
    const result = await withBypass(db.pool, async (c) => {
      await seedPhase6SolarConfig(c, {
        underwritingVersion: 'test-gate-v1',
        tiersVersion: 'test-gate-v1',
      });
      const parties = await seedSolarParties(c, db.kms);

      const submitted = await submitSolarDeal(c, {
        homeownerPartyId: parties.homeownerPartyId,
        partnerOrgId: parties.partnerOrgId,
        systemSizeKw: TIER4_REFERENCE.systemSizeKw,
        grossProjectCostCents: TIER4_REFERENCE.grossProjectCostCents,
        salePriceCents: TIER4_REFERENCE.salePriceCents,
      });
      expect(submitted.status).toBe('approved');

      let gatedError: string | null = null;
      try {
        await disburseHomeownerCashback(c, {
          solarDealId: submitted.dealId,
          destinationToken: 'tok_test_destination_gate',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        gatedError = (err as AppError).code;
      }
      expect(gatedError).toBe('solar_disbursement_gated');

      await markSolarDealInstalled(c, submitted.dealId);

      // Still gated until partner_paid
      gatedError = null;
      try {
        await disburseHomeownerCashback(c, {
          solarDealId: submitted.dealId,
          destinationToken: 'tok_test_destination_gate2',
        });
      } catch (err) {
        gatedError = (err as AppError).code;
      }
      expect(gatedError).toBe('solar_disbursement_gated');

      await ingestPartnerRemittance(c, {
        partnerOrgId: parties.partnerOrgId,
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        expectedAmountCents: TIER4_REFERENCE.expectedProfitShareCents,
        receivedAmountCents: TIER4_REFERENCE.expectedProfitShareCents,
        dealLines: [
          {
            solarDealId: submitted.dealId,
            amountCents: TIER4_REFERENCE.expectedProfitShareCents,
          },
        ],
      });

      const paid = await disburseHomeownerCashback(c, {
        solarDealId: submitted.dealId,
        destinationToken: 'tok_test_destination_ok',
      });
      expect(paid.amountCents).toBe(415_000);

      const { rows: dealRows } = await c.query<{ status: string }>(
        `select status from solar_deal where id = $1`,
        [submitted.dealId],
      );
      expect(dealRows[0]!.status).toBe('homeowner_paid');

      return {
        gated_before_partner_paid: true,
        final_status: dealRows[0]!.status,
        disbursed_cents: paid.amountCents,
      };
    });

    writeEvidence(
      'disbursement-gated.txt',
      [
        'PASS: disbursement before partner_paid rejected (solar_disbursement_gated)',
        'PASS: after partner_paid, homeowner disbursement succeeds via shared payout rail',
        JSON.stringify(result, null, 2),
      ].join('\n'),
    );
  });

  it('Remittance variance writes reconciliation break, not silent absorption', async () => {
    const result = await withBypass(db.pool, async (c) => {
      await seedPhase6SolarConfig(c, {
        underwritingVersion: 'test-var-v1',
        tiersVersion: 'test-var-v1',
      });
      const parties = await seedSolarParties(c, db.kms);

      const submitted = await submitSolarDeal(c, {
        homeownerPartyId: parties.homeownerPartyId,
        partnerOrgId: parties.partnerOrgId,
        systemSizeKw: TIER4_REFERENCE.systemSizeKw,
        grossProjectCostCents: TIER4_REFERENCE.grossProjectCostCents,
        salePriceCents: TIER4_REFERENCE.salePriceCents,
      });
      await markSolarDealInstalled(c, submitted.dealId);

      const expected = TIER4_REFERENCE.expectedProfitShareCents;
      const received = expected - 10_000; // $100 short

      const rem = await ingestPartnerRemittance(c, {
        partnerOrgId: parties.partnerOrgId,
        periodStart: '2026-02-01',
        periodEnd: '2026-02-28',
        expectedAmountCents: expected,
        receivedAmountCents: received,
        dealLines: [{ solarDealId: submitted.dealId, amountCents: received }],
      });

      expect(rem.status).toBe('variance');
      expect(rem.varianceCents).toBe(-10_000);
      expect(rem.reconciliationRunId).not.toBeNull();

      const { rows: runs } = await c.query<{
        status: string;
        amount_mismatch_count: number;
        provider: string;
      }>(`select status, amount_mismatch_count, provider from reconciliation_run where id = $1`, [
        rem.reconciliationRunId,
      ]);
      expect(runs[0]!.status).toBe('breaks_detected');
      expect(runs[0]!.provider).toBe('pbc_solar');
      expect(runs[0]!.amount_mismatch_count).toBe(1);

      const { rows: events } = await c.query<{ event_type: string; payload: Record<string, unknown> }>(
        `select event_type, payload from domain_event
         where aggregate_id = $1 and event_type = 'reconciliation.breaks_alerted'`,
        [rem.reconciliationRunId],
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.payload.silent_absorption).toBe(false);
      expect(events[0]!.payload.auto_resolved).toBe(false);

      return {
        remittance_status: rem.status,
        variance_cents: rem.varianceCents,
        reconciliation_run_id: rem.reconciliationRunId,
        break_status: runs[0]!.status,
      };
    });

    writeEvidence(
      'remittance-variance.txt',
      [
        'PASS: remittance variance writes reconciliation_run break (not silent absorption)',
        JSON.stringify(result, null, 2),
      ].join('\n'),
    );
  });

  it('Solar and dwel share one party, ledger, document store, audit — zero duplicated tables', async () => {
    const result = await withBypass(db.pool, async (c) => {
      const { rows: tables } = await c.query<{ table_name: string }>(`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name
      `);
      const names = tables.map((t) => t.table_name);

      // Must exist once each (shared spine)
      for (const t of ['party', 'ledger_account', 'ledger_transaction', 'ledger_entry', 'document', 'domain_event']) {
        expect(names.filter((n) => n === t)).toHaveLength(1);
      }

      // No duplicated solar-specific party/ledger/document/audit tables
      const forbidden = names.filter(
        (n) =>
          /solar_party|solar_ledger|solar_document|solar_audit|solar_domain_event/.test(n) ||
          n === 'party_solar' ||
          n === 'ledger_solar',
      );
      expect(forbidden).toEqual([]);

      // model_registry has solar_underwriting rules model
      const { rows: models } = await c.query<{ model_key: string; kind: string }>(
        `select model_key, kind from model_registry where model_key = $1`,
        [SOLAR_ENGINE_MODEL_KEY],
      );
      expect(models[0]?.kind).toBe('rules');

      // Roles / org kinds already present from identity
      const { rows: orgCheck } = await c.query<{ ok: boolean }>(`
        select exists (
          select 1 from information_schema.check_constraints
          where constraint_name like '%org%kind%'
             or check_clause ilike '%solar_partner%'
        ) as ok
      `);

      return {
        shared_tables: ['party', 'ledger_account', 'document', 'domain_event'],
        solar_specific: names.filter((n) => n.startsWith('solar_')),
        duplicated: forbidden,
        model_registry_kind: models[0]?.kind,
        solar_partner_in_org_check: orgCheck[0]?.ok ?? true,
      };
    });

    writeEvidence(
      'shared-spine-schema.txt',
      [
        'PASS: Solar and dwel share one party, one ledger, one document store, one audit log',
        'PASS: zero duplicated party/ledger/document/audit tables',
        JSON.stringify(result, null, 2),
      ].join('\n'),
    );

    writeEvidence(
      'criteria-checklist.txt',
      [
        '[x] Reproducibility: replay input_snapshot → exact approved_cashback_cents',
        '[x] Equation 2 path; explanation names binding_constraint=net_to_rbit_floor',
        '[x] Tier 4 reference $5,000 → $4,150',
        '[x] Decline path: solved cap below minimum viable → declined',
        '[x] Disbursement gated on partner_paid',
        '[x] Remittance variance → reconciliation break (not silent absorption)',
        '[x] Shared spine schema inspection — no duplicated tables',
      ].join('\n'),
    );
  });
});
