import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  classifyLeadFee,
  createAndClassifyLead,
  getLead,
  resolvePriceBook,
} from '../../src/modules/brokerage/index.js';
import {
  proposeConfigVersion,
  resolveConfig,
} from '../../src/modules/config/index.js';
import { MutableClock } from '../../src/modules/shared/clock.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import {
  seedDualApprovalAdmins,
  seedLeadWorld,
  seedPhase3TestConfig,
} from '../helpers/phase3.js';
import { specSeedPriceBookTiers, tiersAsConfigPayload } from '../helpers/price-book-seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'remediation', 'R-3');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

describe('R-3 remediation — config_version pricing/TTLs', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('seed-v1 rs_price_book has all twelve §10.3 tiers and is not effective until approved', async () => {
    const result = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query<{
        version: string;
        approved_by_party_id: string | null;
        payload: { tiers: Array<{ tier: string; fee_cents: number; rent_min_cents: number; rent_max_cents: number | null }> };
      }>(
        `select version, approved_by_party_id, payload
         from config_version
         where namespace = 'rs_price_book' and version = 'seed-v1'`,
      );
      const seed = rows[0]!;
      const expected = specSeedPriceBookTiers();
      const mismatches: string[] = [];
      for (const e of expected) {
        const t = seed.payload.tiers.find((x) => x.tier === e.tier);
        if (!t) {
          mismatches.push(`missing ${e.tier}`);
          continue;
        }
        if (t.fee_cents !== e.feeCents) mismatches.push(`${e.tier} fee`);
        if (t.rent_min_cents !== e.rentMinCents) mismatches.push(`${e.tier} min`);
        if ((t.rent_max_cents ?? null) !== e.rentMaxCents) mismatches.push(`${e.tier} max`);
      }
      const asOf = new Date('2026-01-01T00:00:00Z');
      const effective = await resolvePriceBook(c, asOf);
      const viaResolve = await resolveConfig(c, 'rs_price_book', asOf);
      return {
        tierCount: seed.payload.tiers.length,
        approvedNull: seed.approved_by_party_id == null,
        mismatches,
        resolvePriceBookNull: effective == null,
        resolveConfigNull: viaResolve == null,
      };
    });
    expect(result.tierCount).toBe(12);
    expect(result.approvedNull).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.resolvePriceBookNull).toBe(true);
    expect(result.resolveConfigNull).toBe(true);
    writeEvidence('twelve-tiers-unapproved.txt', JSON.stringify(result, null, 2) + '\n');
  });

  it('production-like: unapproved rs_price_book cannot classify / go effective', async () => {
    const clock = new MutableClock(new Date('2026-08-01T12:00:00Z'));
    const result = await withBypass(db.pool, async (c) => {
      const admins = await seedDualApprovalAdmins(c, db.kms);
      // Clear any prior approved test books in this txn world by inserting a fresh unapproved-only path:
      // propose without approve — classify must fail if no other approved book exists.
      // Use a dedicated asOf after ending prior books.
      await c.query(
        `update config_version
         set effective_to = $1
         where namespace = 'rs_price_book' and approved_by_party_id is not null
           and (effective_to is null or effective_to > $1)`,
        [clock.now()],
      );
      const proposed = await proposeConfigVersion(c, {
        namespace: 'rs_price_book',
        version: `unapproved-${Date.now()}`,
        payload: { tiers: tiersAsConfigPayload() },
        effectiveFrom: clock.now(),
        proposedByPartyId: admins.proposerId,
      });
      let classifyError = '';
      try {
        await classifyLeadFee(c, 180000, { clock });
      } catch (err) {
        classifyError = (err as Error).message;
      }
      const resolved = await resolveConfig(c, 'rs_price_book', clock.now());
      return {
        proposedId: proposed.id,
        classifyError,
        resolvedNull: resolved == null,
      };
    });
    expect(result.resolvedNull).toBe(true);
    expect(result.classifyError).toMatch(/dual approval required|PRICE_BOOK_NOT_EFFECTIVE|no approved/);
    writeEvidence('prod-like-unapproved-rejected.txt', JSON.stringify(result, null, 2) + '\n');
  });

  it('lead retains original tier/version/fee after price book change', async () => {
    const clock = new MutableClock(new Date('2026-06-01T12:00:00Z'));
    const result = await withBypass(db.pool, async (c) => {
      await seedPhase3TestConfig(c, { priceBookVersion: 'r3-book-a' });
      const world = await seedLeadWorld(c, db.kms, { rentCents: 180000 });
      const lead = await createAndClassifyLead(c, {
        applicationId: world.applicationId,
        partyId: world.partyId,
        listingId: world.listingId,
        rentAmountCents: 180000,
        clock,
      });
      const before = await getLead(c, lead.id);
      await seedPhase3TestConfig(c, {
        priceBookVersion: 'r3-book-b',
        priceBookFeeOverride: { 'RS-3': 99999 },
      });
      const after = await getLead(c, lead.id);
      return { before, after };
    });
    expect(result.before!.priceBookVersion).toBe('r3-book-a');
    expect(result.after!.priceBookVersion).toBe('r3-book-a');
    expect(result.after!.feeAmountCents).toBe(result.before!.feeAmountCents);
    expect(result.after!.rsTier).toBe(result.before!.rsTier);
    writeEvidence('tier-snapshot.txt', JSON.stringify({
      price_book_version: result.after!.priceBookVersion,
      fee_amount_cents: result.after!.feeAmountCents,
      rs_tier: result.after!.rsTier,
    }, null, 2) + '\n');
  });

  it('hold_durations and sla are resolved from config_version; screening cost from package row', async () => {
    const result = await withBypass(db.pool, async (c) => {
      const hold = await resolveConfig(c, 'hold_durations', new Date());
      const sla = await resolveConfig(c, 'sla', new Date());
      const { rows: pkg } = await c.query<{ total_cost_cents: number }>(
        `select total_cost_cents from screening_package
         where package_key = 'standard' and version = '1'`,
      );
      return {
        hold_ttl_ms: hold?.hold_ttl_ms,
        magic_token_ttl_ms: sla?.magic_token_ttl_ms,
        session_ttl_ms: sla?.session_ttl_ms,
        elevation_ttl_ms: sla?.elevation_ttl_ms,
        total_cost_cents: pkg[0]?.total_cost_cents,
      };
    });
    expect(result.hold_ttl_ms).toBe(172800000);
    expect(result.magic_token_ttl_ms).toBe(900000);
    expect(result.session_ttl_ms).toBe(2592000000);
    expect(result.elevation_ttl_ms).toBe(900000);
    expect(result.total_cost_cents).toBe(2946);
    writeEvidence('resolved-ttl-and-cost.txt', JSON.stringify(result, null, 2) + '\n');
  });
});
