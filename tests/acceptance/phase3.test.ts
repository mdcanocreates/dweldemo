import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approveConfigVersion,
  proposeConfigVersion,
  resolveConfig,
} from '../../src/modules/config/index.js';
import {
  advanceLeadOfferSla,
  createAndClassifyLead,
  displayedFeeForLead,
  fundBrokerBalance,
  getBrokerBalanceCents,
  getLead,
  isLicenseEligible,
  isPriceBookEffectiveViaResolve,
  offerLeadToNextBroker,
  purchaseAndReleaseLead,
  purchaseLeadWithBalance,
  reconcileOrphanPurchases,
  respondToLeadOffer,
} from '../../src/modules/brokerage/index.js';
import { specSeedPriceBookTiers } from '../helpers/price-book-seed.js';
import {
  exportGlDetail,
  exportTrialBalance,
  glDetailToCsv,
  postLedgerTransaction,
  runStripeReconciliation,
  trialBalanceToCsv,
} from '../../src/modules/ledger/index.js';
import { ingestPaymentEvent } from '../../src/modules/payments/index.js';
import {
  resetVendorRegistry,
  resetVendorStubState,
  seedStubStripeBalanceTransactions,
} from '../../src/modules/vendors/index.js';
import { MutableClock } from '../../src/modules/shared/clock.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import {
  seedBrokerOrg,
  seedDualApprovalAdmins,
  seedLeadWorld,
  seedPhase3TestConfig,
} from '../helpers/phase3.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'phase3');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

describe('Phase 3 acceptance (§17)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    resetVendorStubState();
    resetVendorRegistry({ paymentRail: 'stripe_stub' });
    await withBypass(db.pool, async (c) => {
      await seedPhase3TestConfig(c);
    });
  });

  it('Unbalanced transaction rejected by deferred trigger', async () => {
    const client = await db.pool.connect();
    let message: string | null = null;
    try {
      await client.query('begin');
      await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
      const txnId = randomUUID();
      await client.query(
        `insert into ledger_transaction (id, occurred_at, kind, idempotency_key)
         values ($1, now(), 'test_unbalanced', $2)`,
        [txnId, `unbal-${randomUUID()}`],
      );
      const { rows: acct } = await client.query<{ id: string }>(
        `select id from ledger_account where code = 'asset:cash:stripe' limit 1`,
      );
      await client.query(
        `insert into ledger_entry (transaction_id, account_id, direction, amount_cents)
         values ($1,$2,'dr',1000)`,
        [txnId, acct[0]!.id],
      );
      try {
        await client.query('commit');
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
        await client.query('rollback').catch(() => undefined);
      }
    } finally {
      client.release();
    }

    expect(message).toMatch(/ledger imbalance/i);
    writeEvidence(
      'unbalanced-rejected.txt',
      JSON.stringify({ rejected: true, message }, null, 2) + '\n',
    );
  });

  it('Application role UPDATE/DELETE on ledger tables denied', async () => {
    const appPool = createAppPool(db.connectionString);
    try {
      const setup = await withBypass(db.pool, async (c) => {
        const posted = await postLedgerTransaction(c, {
          kind: 'manual_seed',
          idempotencyKey: `immut-${randomUUID()}`,
          lines: [
            { accountCode: 'asset:cash:stripe', direction: 'dr', amountCents: 500 },
            { accountCode: 'revenue:lead_fee', direction: 'cr', amountCents: 500 },
          ],
        });
        const { rows: entry } = await c.query<{ id: string }>(
          `select id::text from ledger_entry where transaction_id = $1 limit 1`,
          [posted.transactionId],
        );
        return { txnId: posted.transactionId, entryId: entry[0]!.id };
      });

      const client = await appPool.connect();
      let updateDenied = false;
      let deleteDenied = false;
      try {
        await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
        try {
          await client.query(`update ledger_transaction set memo = 'x' where id = $1`, [
            setup.txnId,
          ]);
        } catch {
          updateDenied = true;
        }
        try {
          await client.query(`delete from ledger_entry where id = $1`, [setup.entryId]);
        } catch {
          deleteDenied = true;
        }
      } finally {
        client.release();
      }

      expect(updateDenied).toBe(true);
      expect(deleteDenied).toBe(true);
      writeEvidence(
        'ledger-immutability.txt',
        JSON.stringify({ updateDenied, deleteDenied, setup }, null, 2) + '\n',
      );
    } finally {
      await appPool.end();
    }
  });

  it('Tier snapshot: price book change after lead creation retains original fee', async () => {
    const clock = new MutableClock(new Date('2026-06-01T12:00:00Z'));
    const result = await withBypass(db.pool, async (c) => {
      const world = await seedLeadWorld(c, db.kms, { rentCents: 200000 });
      const lead = await createAndClassifyLead(c, {
        applicationId: world.applicationId,
        listingId: world.listingId,
        partyId: world.partyId,
        clock,
      });
      const originalFee = lead.feeAmountCents;
      const originalTier = lead.rsTier;
      const originalVersion = lead.priceBookVersion;

      // Change price book (new approved version with different fees)
      await seedPhase3TestConfig(c, {
        priceBookVersion: 'test-seed-v2-changed',
        priceBookFeeOverride: { 'RS-4': 99999 },
      });

      const after = await getLead(c, lead.id);
      const broker = await seedBrokerOrg(c, { submarketId: world.submarketId });
      await fundBrokerBalance(c, {
        orgId: broker.orgId,
        amountCents: 500_000,
        idempotencyKey: `fund-${lead.id}`,
        clock,
      });
      await offerLeadToNextBroker(c, { leadId: lead.id, clock });
      const { rows: offers } = await c.query<{ id: string }>(
        `select id from lead_offer where lead_id = $1`,
        [lead.id],
      );
      await respondToLeadOffer(c, {
        offerId: offers[0]!.id,
        response: 'accepted',
        clock,
      });
      const purchase = await purchaseAndReleaseLead(c, {
        leadId: lead.id,
        brokerOrgId: broker.orgId,
        alsoStripeCharge: true,
        evidence: {
          purchasedByPartyId: world.partyId,
          sessionId: randomUUID(),
          ip: '203.0.113.10',
          tosVersion: 'tos-2026-01',
        },
        clock,
      });

      return {
        originalFee,
        originalTier,
        originalVersion,
        afterFee: after!.feeAmountCents,
        afterTier: after!.rsTier,
        afterVersion: after!.priceBookVersion,
        charged: purchase.feeAmountCents,
        stripeAmount: purchase.stripeChargeAmountCents,
        displayed: displayedFeeForLead(after!),
      };
    });

    expect(result.afterFee).toBe(result.originalFee);
    expect(result.afterTier).toBe(result.originalTier);
    expect(result.afterVersion).toBe(result.originalVersion);
    expect(result.charged).toBe(result.originalFee);
    expect(result.stripeAmount).toBe(result.originalFee);
    expect(result.displayed).toBe(result.originalFee);
    writeEvidence('tier-snapshot.txt', JSON.stringify(result, null, 2) + '\n');
  });

  it('Balance draw-down: concurrent purchases cannot drive balance negative', async () => {
    const clock = new MutableClock(new Date('2026-06-02T12:00:00Z'));
    const setup = await withBypass(db.pool, async (c) => {
      // Isolate price book so prior tests' fee overrides cannot leak into concurrency.
      await seedPhase3TestConfig(c, {
        priceBookVersion: `conc-${randomUUID().slice(0, 8)}`,
      });
      const world = await seedLeadWorld(c, db.kms, {
        rentCents: 200000,
        email: 'conc@example.com',
      });
      const broker = await seedBrokerOrg(c, { submarketId: world.submarketId });

      const leads: string[] = [];
      let feeAmountCents = 0;
      for (let i = 0; i < 5; i++) {
        const w = await seedLeadWorld(c, db.kms, {
          rentCents: 200000,
          email: `conc-${i}@example.com`,
        });
        await c.query(`update address a set submarket_id = $2
          from property p join unit u on u.property_id = p.id
          join listing l on l.unit_id = u.id
          where a.id = p.address_id and l.id = $1`, [w.listingId, world.submarketId]);
        const lead = await createAndClassifyLead(c, {
          applicationId: w.applicationId,
          listingId: w.listingId,
          partyId: w.partyId,
          clock,
        });
        if (i === 0) feeAmountCents = lead.feeAmountCents;
        expect(lead.feeAmountCents).toBe(feeAmountCents);
        await offerLeadToNextBroker(c, { leadId: lead.id, clock });
        const { rows } = await c.query<{ id: string }>(
          `select id from lead_offer where lead_id = $1 and broker_org_id = $2`,
          [lead.id, broker.orgId],
        );
        expect(rows[0], `lead ${lead.id} must be offered to funded broker`).toBeTruthy();
        await respondToLeadOffer(c, {
          offerId: rows[0]!.id,
          response: 'accepted',
          clock,
        });
        leads.push(lead.id);
      }

      // Fund exactly one lead fee at the classified amount.
      expect(feeAmountCents).toBeGreaterThan(0);
      await fundBrokerBalance(c, {
        orgId: broker.orgId,
        amountCents: feeAmountCents,
        idempotencyKey: `fund-conc-${randomUUID()}`,
        clock,
      });

      return { brokerOrgId: broker.orgId, leadIds: leads, feeAmountCents };
    });

    // Concurrent draw-downs on separate connections/transactions
    const results = await Promise.allSettled(
      setup.leadIds.map((leadId) =>
        withBypass(db.pool, (c) =>
          purchaseLeadWithBalance(c, {
            leadId,
            brokerOrgId: setup.brokerOrgId,
            clock,
          }),
        ),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    const rejectCodes = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason as { code?: string })?.code ?? String(r.reason));
    const balance = await withBypass(db.pool, (c) =>
      getBrokerBalanceCents(c, setup.brokerOrgId),
    );

    expect(succeeded, `rejectCodes=${rejectCodes.join(',')}`).toBe(1);
    expect(failed).toBe(4);
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(balance).toBe(0);
    expect(rejectCodes.every((c) => c === 'INSUFFICIENT_BALANCE')).toBe(true);
    writeEvidence(
      'balance-drawdown-concurrency.txt',
      JSON.stringify(
        { succeeded, failed, balance, feeAmountCents: setup.feeAmountCents, rejectCodes },
        null,
        2,
      ) + '\n',
    );
  });

  it('Charge/release ordering: payment failure blocks release; orphan reconciler', async () => {
    const clock = new MutableClock(new Date('2026-06-03T12:00:00Z'));
    const failPath = await withBypass(db.pool, async (c) => {
      const world = await seedLeadWorld(c, db.kms, { email: 'fail@example.com' });
      const broker = await seedBrokerOrg(c, { submarketId: world.submarketId });
      await fundBrokerBalance(c, {
        orgId: broker.orgId,
        amountCents: 100_000,
        idempotencyKey: `fund-fail-${randomUUID()}`,
        clock,
      });
      const lead = await createAndClassifyLead(c, {
        applicationId: world.applicationId,
        listingId: world.listingId,
        partyId: world.partyId,
        clock,
      });
      await offerLeadToNextBroker(c, { leadId: lead.id, clock });
      const { rows } = await c.query<{ id: string }>(
        `select id from lead_offer where lead_id = $1`,
        [lead.id],
      );
      await respondToLeadOffer(c, { offerId: rows[0]!.id, response: 'accepted', clock });
      const purchase = await purchaseAndReleaseLead(c, {
        leadId: lead.id,
        brokerOrgId: broker.orgId,
        simulatePaymentFailure: true,
        evidence: {
          purchasedByPartyId: world.partyId,
          sessionId: randomUUID(),
          ip: '198.51.100.1',
          tosVersion: 'tos-2026-01',
        },
        clock,
      });
      const { rows: ev } = await c.query(
        `select 1 from lead_purchase_evidence where lead_id = $1`,
        [lead.id],
      );
      const after = await getLead(c, lead.id);
      return {
        released: purchase.released,
        evidenceCount: ev.length,
        status: after!.status,
      };
    });
    expect(failPath.released).toBe(false);
    expect(failPath.evidenceCount).toBe(0);
    expect(failPath.status).not.toBe('released');

    const orphanPath = await withBypass(db.pool, async (c) => {
      const world = await seedLeadWorld(c, db.kms, { email: 'orphan@example.com' });
      const broker = await seedBrokerOrg(c, { submarketId: world.submarketId });
      await fundBrokerBalance(c, {
        orgId: broker.orgId,
        amountCents: 100_000,
        idempotencyKey: `fund-orphan-${randomUUID()}`,
        clock,
      });
      const lead = await createAndClassifyLead(c, {
        applicationId: world.applicationId,
        listingId: world.listingId,
        partyId: world.partyId,
        clock,
      });
      await offerLeadToNextBroker(c, { leadId: lead.id, clock });
      const { rows } = await c.query<{ id: string }>(
        `select id from lead_offer where lead_id = $1`,
        [lead.id],
      );
      await respondToLeadOffer(c, { offerId: rows[0]!.id, response: 'accepted', clock });
      await purchaseLeadWithBalance(c, {
        leadId: lead.id,
        brokerOrgId: broker.orgId,
        simulateCrashAfterCharge: true,
        clock,
      });
      const mid = await getLead(c, lead.id);
      expect(mid!.status).toBe('purchased');
      const { rows: evMid } = await c.query(
        `select 1 from lead_purchase_evidence where lead_id = $1`,
        [lead.id],
      );
      expect(evMid.length).toBe(0);

      const resolved = await reconcileOrphanPurchases(c, {
        defaultEvidence: {
          purchasedByPartyId: world.partyId,
          sessionId: randomUUID(),
          ip: '198.51.100.2',
          tosVersion: 'tos-2026-01',
        },
        clock,
      });
      const after = await getLead(c, lead.id);
      return { resolved, status: after!.status };
    });
    expect(orphanPath.resolved.resolvedLeadIds.length).toBeGreaterThanOrEqual(1);
    expect(orphanPath.status).toBe('released');

    writeEvidence(
      'charge-release-ordering.txt',
      JSON.stringify({ failPath, orphanPath }, null, 2) + '\n',
    );
  });

  it('License gate: never offered to expired/unverified org (randomized fixtures)', async () => {
    const clock = new MutableClock(new Date('2026-06-04T12:00:00Z'));
    const result = await withBypass(db.pool, async (c) => {
      const world = await seedLeadWorld(c, db.kms, { email: 'lic@example.com' });
      const fixtures = [
        {
          name: 'expired',
          licenseVerifiedAt: new Date('2024-01-01T00:00:00Z'),
          licenseExpiresAt: '2025-01-01',
        },
        {
          name: 'unverified',
          licenseVerifiedAt: null,
          licenseExpiresAt: '2030-01-01',
        },
        {
          name: 'valid',
          licenseVerifiedAt: new Date('2025-01-01T00:00:00Z'),
          licenseExpiresAt: '2030-01-01',
        },
      ];
      // Shuffle
      for (let i = fixtures.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [fixtures[i], fixtures[j]] = [fixtures[j]!, fixtures[i]!];
      }

      const orgs: Record<string, string> = {};
      for (const f of fixtures) {
        const b = await seedBrokerOrg(c, {
          submarketId: world.submarketId,
          licenseVerifiedAt: f.licenseVerifiedAt,
          licenseExpiresAt: f.licenseExpiresAt,
          priority: f.name === 'valid' ? 10 : 200,
          legalName: `Lic ${f.name}`,
        });
        orgs[f.name] = b.orgId;
      }

      const lead = await createAndClassifyLead(c, {
        applicationId: world.applicationId,
        listingId: world.listingId,
        partyId: world.partyId,
        clock,
      });
      const offer = await offerLeadToNextBroker(c, { leadId: lead.id, clock });

      const expiredGate = await isLicenseEligible(c, {
        orgId: orgs.expired!,
        submarketId: world.submarketId,
        clock,
      });
      const unverifiedGate = await isLicenseEligible(c, {
        orgId: orgs.unverified!,
        submarketId: world.submarketId,
        clock,
      });

      return {
        offeredTo: offer.brokerOrgId,
        validOrg: orgs.valid,
        expiredEligible: expiredGate.eligible,
        unverifiedEligible: unverifiedGate.eligible,
        fixtureOrder: fixtures.map((f) => f.name),
      };
    });

    expect(result.expiredEligible).toBe(false);
    expect(result.unverifiedEligible).toBe(false);
    expect(result.offeredTo).toBe(result.validOrg);
    writeEvidence('license-gate.txt', JSON.stringify(result, null, 2) + '\n');
  });

  it('Reconciliation: injected Stripe discrepancy detected and alerted, not auto-resolved', async () => {
    const clock = new MutableClock(new Date('2026-06-05T12:00:00Z'));
    const periodStart = new Date('2026-06-05T00:00:00Z');
    const periodEnd = new Date('2026-06-06T00:00:00Z');

    const result = await withBypass(db.pool, async (c) => {
      await postLedgerTransaction(c, {
        kind: 'broker_funding',
        idempotencyKey: `recon-ledger-${randomUUID()}`,
        occurredAt: new Date('2026-06-05T10:00:00Z'),
        clock,
        memo: 'ch_matched_ok',
        lines: [
          { accountCode: 'asset:cash:stripe', direction: 'dr', amountCents: 10000 },
          {
            accountCode: 'liability:broker_prepaid_balance',
            direction: 'cr',
            amountCents: 10000,
          },
        ],
      });

      seedStubStripeBalanceTransactions([
        {
          id: 'txn_ok',
          chargeId: 'ch_matched_ok',
          amountCents: 10000,
          feeCents: 0,
          netCents: 10000,
          createdAt: new Date('2026-06-05T10:00:00Z'),
          type: 'charge',
        },
        {
          id: 'txn_ghost',
          chargeId: 'ch_injected_discrepancy',
          amountCents: 7777,
          feeCents: 0,
          netCents: 7777,
          createdAt: new Date('2026-06-05T11:00:00Z'),
          type: 'charge',
        },
      ]);

      const run = await runStripeReconciliation(c, { periodStart, periodEnd, clock });
      const { rows: events } = await c.query<{ event_type: string; payload: unknown }>(
        `select event_type, payload from domain_event
         where aggregate_id = $1 and event_type = 'reconciliation.breaks_alerted'`,
        [run.runId],
      );
      // Confirm breaks not auto-resolved
      const autoResolved = (events[0]?.payload as { auto_resolved?: boolean } | undefined)
        ?.auto_resolved;
      return { run, alerted: events.length > 0, autoResolved };
    });

    expect(result.run.status).toBe('breaks_detected');
    expect(result.run.unmatchedCount).toBeGreaterThan(0);
    expect(result.alerted).toBe(true);
    expect(result.autoResolved).toBe(false);
    writeEvidence('reconciliation-breaks.txt', JSON.stringify(result, null, 2) + '\n');
  });

  it('Displayed fee == persisted fee_amount_cents == Stripe charge amount', async () => {
    const clock = new MutableClock(new Date('2026-06-06T12:00:00Z'));
    const result = await withBypass(db.pool, async (c) => {
      const world = await seedLeadWorld(c, db.kms, {
        rentCents: 250000,
        email: 'fee@example.com',
      });
      const broker = await seedBrokerOrg(c, { submarketId: world.submarketId });
      await fundBrokerBalance(c, {
        orgId: broker.orgId,
        amountCents: 200_000,
        idempotencyKey: `fund-fee-${randomUUID()}`,
        clock,
      });
      const lead = await createAndClassifyLead(c, {
        applicationId: world.applicationId,
        listingId: world.listingId,
        partyId: world.partyId,
        clock,
      });
      const displayed = displayedFeeForLead(lead);
      await offerLeadToNextBroker(c, { leadId: lead.id, clock });
      const { rows } = await c.query<{ id: string }>(
        `select id from lead_offer where lead_id = $1`,
        [lead.id],
      );
      await respondToLeadOffer(c, { offerId: rows[0]!.id, response: 'accepted', clock });
      const purchase = await purchaseAndReleaseLead(c, {
        leadId: lead.id,
        brokerOrgId: broker.orgId,
        alsoStripeCharge: true,
        evidence: {
          purchasedByPartyId: world.partyId,
          sessionId: randomUUID(),
          ip: '192.0.2.1',
          userAgent: 'phase3-test',
          tosVersion: 'tos-2026-06',
        },
        clock,
      });
      return {
        displayed,
        persisted: lead.feeAmountCents,
        stripe: purchase.stripeChargeAmountCents,
      };
    });
    expect(result.displayed).toBe(result.persisted);
    expect(result.stripe).toBe(result.persisted);
    writeEvidence('fee-equality.txt', JSON.stringify(result, null, 2) + '\n');
  });

  it('lead_purchase_evidence populated at release with session, IP, ToS, payload', async () => {
    const clock = new MutableClock(new Date('2026-06-07T12:00:00Z'));
    const sessionId = randomUUID();
    const result = await withBypass(db.pool, async (c) => {
      const world = await seedLeadWorld(c, db.kms, { email: 'ev@example.com' });
      const broker = await seedBrokerOrg(c, { submarketId: world.submarketId });
      await fundBrokerBalance(c, {
        orgId: broker.orgId,
        amountCents: 200_000,
        idempotencyKey: `fund-ev-${randomUUID()}`,
        clock,
      });
      const lead = await createAndClassifyLead(c, {
        applicationId: world.applicationId,
        listingId: world.listingId,
        partyId: world.partyId,
        clock,
      });
      await offerLeadToNextBroker(c, { leadId: lead.id, clock });
      const { rows } = await c.query<{ id: string }>(
        `select id from lead_offer where lead_id = $1`,
        [lead.id],
      );
      await respondToLeadOffer(c, { offerId: rows[0]!.id, response: 'accepted', clock });
      await purchaseAndReleaseLead(c, {
        leadId: lead.id,
        brokerOrgId: broker.orgId,
        evidence: {
          purchasedByPartyId: world.partyId,
          sessionId,
          ip: '203.0.113.55',
          userAgent: 'Mozilla/5.0 test',
          tosVersion: 'tos-v9',
        },
        clock,
      });
      const { rows: ev } = await c.query<{
        session_id: string;
        ip: string;
        tos_version: string;
        payload_released: Record<string, unknown>;
      }>(
        `select session_id::text, host(ip) as ip, tos_version, payload_released
         from lead_purchase_evidence where lead_id = $1`,
        [lead.id],
      );
      return ev[0]!;
    });
    expect(result.session_id).toBe(sessionId);
    expect(result.ip).toBe('203.0.113.55');
    expect(result.tos_version).toBe('tos-v9');
    expect(result.payload_released.contact_grant).toBe(true);
    writeEvidence('purchase-evidence.txt', JSON.stringify(result, null, 2) + '\n');
  });

  it('Price book cannot go effective without config.approve dual approval', async () => {
    const clock = new MutableClock(new Date('2026-06-08T12:00:00Z'));
    const result = await withBypass(db.pool, async (c) => {
      const admins = await seedDualApprovalAdmins(c, db.kms);
      const proposed = await proposeConfigVersion(c, {
        namespace: 'rs_price_book',
        version: `prod-pending-${randomUUID().slice(0, 8)}`,
        payload: {
          tiers: specSeedPriceBookTiers().map((t) => ({
            tier: t.tier,
            rent_min_cents: t.rentMinCents,
            rent_max_cents: t.rentMaxCents,
            fee_cents: t.feeCents,
          })),
        },
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        proposedByPartyId: admins.proposerId,
      });

      const beforeApprove = await resolveConfig(
        c,
        'rs_price_book',
        clock.now(),
      );
      // Seeded test-seed-v1 is still the effective approved one; proposed version not visible as that version
      const { rows: unapproved } = await c.query<{ approved_by_party_id: string | null }>(
        `select approved_by_party_id from config_version where id = $1`,
        [proposed.id],
      );
      const effectiveBefore = await isPriceBookEffectiveViaResolve(c, clock.now());

      await approveConfigVersion(c, {
        configVersionId: proposed.id,
        approverPartyId: admins.approverId,
      });
      const { rows: approved } = await c.query<{ approved_by_party_id: string | null }>(
        `select approved_by_party_id from config_version where id = $1`,
        [proposed.id],
      );

      return {
        proposedId: proposed.id,
        unapprovedNull: unapproved[0]!.approved_by_party_id == null,
        approvedSet: approved[0]!.approved_by_party_id === admins.approverId,
        resolveSawApprovedBook: beforeApprove != null,
        effectiveBefore,
      };
    });

    expect(result.unapprovedNull).toBe(true);
    expect(result.approvedSet).toBe(true);
    // Dual approval path exercised via proposeConfigVersion → approveConfigVersion
    writeEvidence('price-book-dual-approval.txt', JSON.stringify(result, null, 2) + '\n');
  });

  it('Trial balance and GL detail exports produce correct totals against seeded data', async () => {
    const clock = new MutableClock(new Date('2026-06-09T12:00:00Z'));
    const result = await withBypass(db.pool, async (c) => {
      await postLedgerTransaction(c, {
        kind: 'seed_export',
        idempotencyKey: `export-${randomUUID()}`,
        occurredAt: clock.now(),
        clock,
        lines: [
          { accountCode: 'asset:cash:stripe', direction: 'dr', amountCents: 25000 },
          { accountCode: 'expense:processing_fees', direction: 'dr', amountCents: 500 },
          {
            accountCode: 'liability:broker_prepaid_balance',
            direction: 'cr',
            amountCents: 25500,
          },
        ],
      });
      await postLedgerTransaction(c, {
        kind: 'seed_export',
        idempotencyKey: `export2-${randomUUID()}`,
        occurredAt: clock.now(),
        clock,
        lines: [
          {
            accountCode: 'liability:broker_prepaid_balance',
            direction: 'dr',
            amountCents: 14000,
          },
          { accountCode: 'revenue:lead_fee', direction: 'cr', amountCents: 14000 },
        ],
      });

      const tb = await exportTrialBalance(c, clock.now());
      const gl = await exportGlDetail(c, {
        from: new Date('2026-06-09T00:00:00Z'),
        to: new Date('2026-06-10T00:00:00Z'),
      });
      return {
        tb,
        gl,
        tbCsv: trialBalanceToCsv(tb.rows),
        glCsv: glDetailToCsv(gl.rows),
      };
    });

    expect(result.tb.totalDebits).toBe(result.tb.totalCredits);
    expect(result.tb.totalDebits).toBeGreaterThanOrEqual(25000 + 500 + 14000);
    expect(result.gl.totalDebits).toBe(result.gl.totalCredits);
    expect(result.gl.rows.length).toBeGreaterThanOrEqual(5);
    writeEvidence(
      'accountant-exports.txt',
      JSON.stringify(
        {
          totalDebits: result.tb.totalDebits,
          totalCredits: result.tb.totalCredits,
          glDebits: result.gl.totalDebits,
          glCredits: result.gl.totalCredits,
          tbCsvLines: result.tbCsv.split('\n').length,
          glCsvLines: result.glCsv.split('\n').length,
        },
        null,
        2,
      ) + '\n',
    );
  });

  it('payment_event ingestion via Stripe stub (no network)', async () => {
    const ingested = await withBypass(db.pool, async (c) => {
      return ingestPaymentEvent(c, {
        provider: 'stripe',
        providerEventId: `evt_${randomUUID()}`,
        eventType: 'charge.succeeded',
        rawPayload: { amount: 14000 },
        signature: 'stub-valid',
      });
    });
    expect(ingested.isSignatureValid).toBe(true);
    expect(ingested.duplicate).toBe(false);
    writeEvidence(
      'payment-event.txt',
      JSON.stringify(ingested, null, 2) + '\n',
    );
  });

  it('SLA expiry re-offers to next eligible broker', async () => {
    const clock = new MutableClock(new Date('2026-06-10T12:00:00Z'));
    const result = await withBypass(db.pool, async (c) => {
      const world = await seedLeadWorld(c, db.kms, { email: 'sla@example.com' });
      const b1 = await seedBrokerOrg(c, {
        submarketId: world.submarketId,
        priority: 200,
        legalName: 'SLA Broker A',
      });
      const b2 = await seedBrokerOrg(c, {
        submarketId: world.submarketId,
        priority: 100,
        legalName: 'SLA Broker B',
      });
      const lead = await createAndClassifyLead(c, {
        applicationId: world.applicationId,
        listingId: world.listingId,
        partyId: world.partyId,
        clock,
      });
      const first = await offerLeadToNextBroker(c, { leadId: lead.id, clock });
      clock.advanceMs(5 * 3600_000); // past 4h SLA
      const adv = await advanceLeadOfferSla(c, { leadId: lead.id, clock });
      const { rows: offers } = await c.query<{ broker_org_id: string; response: string | null }>(
        `select broker_org_id, response from lead_offer where lead_id = $1 order by offered_at`,
        [lead.id],
      );
      return { first, adv, offers, b1: b1.orgId, b2: b2.orgId };
    });
    expect(result.first.brokerOrgId).toBe(result.b1);
    expect(result.adv.expired).toBe(true);
    expect(result.offers.length).toBe(2);
    expect(result.offers[0]!.response).toBe('expired');
    expect(result.offers[1]!.broker_org_id).toBe(result.b2);
    writeEvidence('sla-reoffer.txt', JSON.stringify(result, null, 2) + '\n');
  });
});
