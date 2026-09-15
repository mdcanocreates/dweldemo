import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertMinimalSerializer,
  assertWeightsSumToOne,
  computeMatchScore,
  DEFAULT_SCORING_WEIGHTS,
  expressLandlordInterest,
  MATCH_MODEL_VERSION,
  scoreBadgeTier,
  scoreBedroomMatch,
  scoreMoveInWindow,
  scoreRentAffordability,
  scoreSubmarketMatch,
  searchDiscoverableRenters,
  type ScoringWeights,
} from '../../src/modules/matching/index.js';
import { createOrg, createPartyWithIdentity } from '../../src/modules/identity/index.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import { attachListingSubmarket } from '../helpers/phase3.js';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'part-b', 'B-2');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

async function upsertWeights(
  client: import('../../src/db/pool.js').DbClient,
  proposerId: string,
  weights: ScoringWeights,
  version: string,
): Promise<void> {
  const id = randomUUID();
  await client.query(
    `insert into config_version (
       id, namespace, version, payload, effective_from,
       proposed_by_party_id, approved_by_party_id, approved_at
     ) values ($1,'scoring_weights',$2,$3::jsonb, now() - interval '1 minute', $4, $4, now())
     on conflict (namespace, version) do update
       set payload = excluded.payload,
           approved_at = now(),
           effective_from = excluded.effective_from`,
    [id, version, JSON.stringify(weights), proposerId],
  );
}

describe('B-2 — Match score on landlord discovery', () => {
  let db: TestDb;
  let landlordPartyId: string;
  let orgId: string;
  let listingId: string;
  let submarketId: string;
  let profilePerfectId: string;
  let profileWeakId: string;
  let proposerId: string;

  beforeAll(async () => {
    db = await startTestDb();
    await withBypass(db.pool, async (c) => {
      const org = await createOrg(c, {
        kind: 'landlord',
        legalName: 'B2 LL',
        displayName: 'B2',
      });
      orgId = org.id;
      const ll = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'b2-ll@example.com' },
      });
      landlordPartyId = ll.partyId;
      proposerId = ll.partyId;

      await upsertWeights(c, proposerId, DEFAULT_SCORING_WEIGHTS, 'b2-default');

      submarketId = randomUUID();
      await c.query(
        `insert into submarket (id, name, metro_code, boundary, version, is_active)
         values (
           $1, 'B2 Market', 'TEST',
           ST_GeogFromText('POLYGON((-97.8 30.2,-97.7 30.2,-97.7 30.3,-97.8 30.3,-97.8 30.2))'),
           'v1', true
         )`,
        [submarketId],
      );

      const { rows: addr } = await c.query<{ id: string }>(
        `insert into address (raw_input, normalized_hash, normalizer_vendor, normalizer_version, submarket_id)
         values ('1 B2 St','b2-h','t','1',$1) returning id`,
        [submarketId],
      );
      const { rows: prop } = await c.query<{ id: string }>(
        `insert into property (address_id, property_type) values ($1,'sfr') returning id`,
        [addr[0]!.id],
      );
      const { rows: unit } = await c.query<{ id: string }>(
        `insert into unit (property_id, unit_label_normalized, bedrooms)
         values ($1,'',2) returning id`,
        [prop[0]!.id],
      );
      const { rows: listing } = await c.query<{ id: string }>(
        `insert into listing (org_id, unit_id, origin, rent_amount_cents, available_on, status)
         values ($1,$2,'manual',200000,'2026-09-01','active') returning id`,
        [orgId, unit[0]!.id],
      );
      listingId = listing[0]!.id;
      await attachListingSubmarket(c, listingId, submarketId);

      const p1 = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'b2-r1@example.com' },
      });
      const p2 = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'b2-r2@example.com' },
      });

      const { rows: rp1 } = await c.query<{ id: string }>(
        `insert into renter_profile (
           party_id, rent_max_cents, bedrooms_min, move_in_earliest, move_in_latest,
           badge_state, target_submarket_ids, is_discoverable, discoverability_level
         ) values ($1,250000,2,'2026-08-15','2026-09-15','fully_screened',array[$2]::uuid[],true,'minimal')
         returning id`,
        [p1.partyId, submarketId],
      );
      profilePerfectId = rp1[0]!.id;
      await c.query(
        `insert into party_features (party_id, first_seen_at, updated_at)
         values ($1, now(), now()) on conflict do nothing`,
        [p1.partyId],
      );

      const { rows: rp2 } = await c.query<{ id: string }>(
        `insert into renter_profile (
           party_id, rent_max_cents, bedrooms_min, move_in_earliest, move_in_latest,
           badge_state, target_submarket_ids, is_discoverable, discoverability_level
         ) values ($1,100000,3,'2027-01-01','2027-02-01','unverified','{}',true,'minimal')
         returning id`,
        [p2.partyId],
      );
      profileWeakId = rp2[0]!.id;
      await c.query(
        `insert into party_features (party_id, first_seen_at, updated_at)
         values ($1, now(), now()) on conflict do nothing`,
        [p2.partyId],
      );
    });
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('dimension edge fixtures + weights sum to 1.0', () => {
    assertWeightsSumToOne(DEFAULT_SCORING_WEIGHTS);

    expect(scoreRentAffordability(200_000, 200_000).score).toBe(100);
    expect(scoreRentAffordability(200_000, 190_000).score).toBe(50); // 5% below
    expect(scoreRentAffordability(200_000, 180_000).score).toBe(50); // exactly 10%
    expect(scoreRentAffordability(200_000, 179_000).score).toBe(0);

    expect(scoreMoveInWindow('2026-09-01', '2026-08-01', '2026-09-15').score).toBe(100);
    expect(scoreMoveInWindow('2026-09-20', '2026-08-01', '2026-09-15').score).toBe(50);
    expect(scoreMoveInWindow('2026-10-01', '2026-08-01', '2026-09-15').score).toBe(0);

    expect(scoreBedroomMatch(2, 2).score).toBe(100);
    expect(scoreBedroomMatch(1, 2).score).toBe(0);

    expect(scoreBadgeTier('fully_screened').score).toBe(100);
    expect(scoreBadgeTier('prechecked').score).toBe(60);
    expect(scoreBadgeTier('unverified').score).toBe(20);

    expect(scoreSubmarketMatch(submarketId, [submarketId]).score).toBe(100);
    expect(scoreSubmarketMatch(submarketId, [randomUUID()]).score).toBe(0);

    const perfect = computeMatchScore(
      {
        rent_amount_cents: 200_000,
        available_on: '2026-09-01',
        bedrooms: 2,
        submarket_id: submarketId,
      },
      {
        rent_max_cents: 250_000,
        move_in_earliest: '2026-08-15',
        move_in_latest: '2026-09-15',
        bedrooms_min: 2,
        badge_state: 'fully_screened',
        target_submarket_ids: [submarketId],
      },
      DEFAULT_SCORING_WEIGHTS,
    );
    expect(perfect.match_score).toBe(100);
    writeEvidence('dimension-edges.json', JSON.stringify({ perfect }, null, 2) + '\n');
  });

  it('search: null match without listing_id; scored with listing; config change shifts score', async () => {
    const noListing = await withBypass(db.pool, (c) =>
      searchDiscoverableRenters(c, {
        actorPartyId: landlordPartyId,
        filters: {},
      }),
    );
    expect(noListing.every((h) => h.match_score === null)).toBe(true);
    for (const h of noListing) {
      assertMinimalSerializer(h as unknown as Record<string, unknown>);
      expect(h).not.toHaveProperty('email');
      expect(h).not.toHaveProperty('party_id');
    }

    const withListing = await withBypass(db.pool, (c) =>
      searchDiscoverableRenters(c, {
        actorPartyId: landlordPartyId,
        filters: {},
        listingId,
        sortBy: 'match_score',
      }),
    );
    expect(withListing[0]!.renter_profile_id).toBe(profilePerfectId);
    expect(withListing[0]!.match_score).toBe(100);
    expect(withListing.find((h) => h.renter_profile_id === profileWeakId)!.match_score).toBeLessThan(
      50,
    );

    const alt: ScoringWeights = {
      rent_affordability: 0.1,
      move_in_window: 0.1,
      bedroom_match: 0.1,
      badge_tier: 0.6,
      submarket_match: 0.1,
    };
    await withBypass(db.pool, (c) => upsertWeights(c, proposerId, alt, 'b2-alt'));

    const afterConfig = await withBypass(db.pool, (c) =>
      searchDiscoverableRenters(c, {
        actorPartyId: landlordPartyId,
        filters: {},
        listingId,
      }),
    );
    const weakAfter = afterConfig.find((h) => h.renter_profile_id === profileWeakId)!;
    // unverified badge 20 * 0.6 = 12, plus maybe zeros elsewhere — different from default
    const weakBefore = withListing.find((h) => h.renter_profile_id === profileWeakId)!;
    expect(weakAfter.match_score).not.toBe(weakBefore.match_score);

    writeEvidence(
      'search-scores.json',
      JSON.stringify({ noListingNull: true, withListing, afterConfig: weakAfter }, null, 2) +
        '\n',
    );

    // restore default for interest test
    await withBypass(db.pool, (c) =>
      upsertWeights(c, proposerId, DEFAULT_SCORING_WEIGHTS, 'b2-default-restore'),
    );
  });

  it('express interest snapshots model version', async () => {
    const result = await withBypass(db.pool, (c) =>
      expressLandlordInterest(c, {
        listingId,
        orgId,
        renterProfileId: profilePerfectId,
        initiatedByPartyId: landlordPartyId,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      }),
    );
    expect(result.match_model_version).toBe(MATCH_MODEL_VERSION);

    const row = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query<{
        match_score: string;
        match_model_version: string;
      }>(
        `select match_score::text, match_model_version from landlord_interest where id = $1`,
        [result.interestId],
      );
      return rows[0]!;
    });
    expect(row.match_model_version).toBe(MATCH_MODEL_VERSION);
    expect(Number(row.match_score)).toBe(100);
    writeEvidence('interest-snapshot.json', JSON.stringify({ result, row }, null, 2) + '\n');
  });
});
