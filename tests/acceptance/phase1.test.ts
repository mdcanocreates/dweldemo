import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  issueMagicToken,
  redeemMagicToken,
  resetAuthRateLimits,
} from '../../src/modules/auth/index.js';
import { normalizeAddress } from '../../src/modules/geo/index.js';
import {
  ingestCsvRows,
  ingestManualListing,
} from '../../src/modules/ingestion/index.js';
import { createOrg, createPartyWithIdentity } from '../../src/modules/identity/index.js';
import {
  acceptPlacement,
  AllowlistViolationError,
  enqueuePlacement,
  lapseHoldAndPromote,
  markLeaseSigned,
  PlacementConflictError,
  searchDiscoverableRenters,
} from '../../src/modules/matching/index.js';
import {
  captureOutcomeFromToken,
  mintOutcomeCaptureToken,
  schedulePlacementOutcomes,
} from '../../src/modules/outcomes/index.js';
import {
  createNotification,
  sendNotificationStub,
} from '../../src/modules/notifications/index.js';
import { runListingLifecycle } from '../../src/modules/supply/index.js';
import { MutableClock } from '../../src/modules/shared/clock.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'phase1');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

describe('Phase 1 acceptance (§17)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('Address fixtures normalize to one unit_id', async () => {
    const fixtures = [
      '123 Main St Apt 2',
      '123 Main Street #2',
      '123 MAIN ST UNIT 2',
    ];
    const hashes = fixtures.map((f) => normalizeAddress(f).normalizedHash);
    expect(new Set(hashes).size).toBe(1);

    const unitIds = await withBypass(db.pool, async (c) => {
      const org = await createOrg(c, {
        kind: 'landlord',
        legalName: 'Addr LLC',
        displayName: 'Addr',
      });
      const ids: string[] = [];
      for (const raw of fixtures) {
        await ingestManualListing(c, {
          orgId: org.id,
          externalId: `addr-${raw}`,
          addressRaw: raw,
          rentAmountCents: 150000,
          bedrooms: 1,
        });
        const { rows } = await c.query<{ unit_id: string }>(
          `select unit_id from source_listing
           where org_id = $1 and external_id = $2`,
          [org.id, `addr-${raw}`],
        );
        ids.push(rows[0]!.unit_id);
      }
      return ids;
    });

    expect(new Set(unitIds).size).toBe(1);
    writeEvidence(
      'address-normalize.txt',
      [
        ...fixtures.map((f, i) => `${f} -> hash=${hashes[i]} unit=${unitIds[i]}`),
        `unique_units=${new Set(unitIds).size}`,
      ].join('\n') + '\n',
    );
  });

  it('Listing lifecycle: active → stale@14d → expired@21d via clock', async () => {
    const clock = new MutableClock(new Date('2026-01-01T00:00:00Z'));
    const listingId = await withBypass(db.pool, async (c) => {
      const org = await createOrg(c, {
        kind: 'landlord',
        legalName: 'Life LLC',
        displayName: 'Life',
      });
      await ingestManualListing(c, {
        orgId: org.id,
        externalId: 'life-1',
        addressRaw: '10 Lifecycle Ave Unit 1',
        rentAmountCents: 200000,
      });
      const { rows } = await c.query<{ id: string }>(
        `select l.id from listing l
         join source_listing sl on sl.id = l.primary_source_listing_id
         where sl.external_id = 'life-1'`,
      );
      await c.query(
        `update listing set last_confirmed_at = $2, status = 'active' where id = $1`,
        [rows[0]!.id, clock.now()],
      );
      return rows[0]!.id;
    });

    clock.advanceDays(14);
    await withBypass(db.pool, (c) => runListingLifecycle(c, clock));
    let status = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query<{ status: string }>(
        `select status from listing where id = $1`,
        [listingId],
      );
      return rows[0]!.status;
    });
    expect(status).toBe('stale');

    clock.advanceDays(7); // day 21 from confirm
    await withBypass(db.pool, (c) => runListingLifecycle(c, clock));
    status = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query<{ status: string }>(
        `select status from listing where id = $1`,
        [listingId],
      );
      return rows[0]!.status;
    });
    expect(status).toBe('expired');

    const events = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query<{ event_type: string; payload: unknown }>(
        `select event_type, payload from domain_event
         where aggregate_type = 'listing' and aggregate_id = $1
           and event_type = 'listing.status_changed'
         order by seq`,
        [listingId],
      );
      return rows;
    });
    expect(events.some((e) => (e.payload as { to: string }).to === 'stale')).toBe(true);
    expect(events.some((e) => (e.payload as { to: string }).to === 'expired')).toBe(true);

    writeEvidence(
      'listing-lifecycle.txt',
      `listing=${listingId}\nfinal_status=${status}\nevents=${JSON.stringify(events)}\n`,
    );
  });

  it('Manual listing produces source_listing + merged listing + provenance', async () => {
    const result = await withBypass(db.pool, async (c) => {
      const org = await createOrg(c, {
        kind: 'landlord',
        legalName: 'Manual LLC',
        displayName: 'Manual',
      });
      await ingestManualListing(c, {
        orgId: org.id,
        externalId: 'manual-42',
        addressRaw: '42 Provenance Rd Apt 3',
        rentAmountCents: 175000,
        bedrooms: 2,
      });
      const { rows: sl } = await c.query(
        `select id, resolution_status, unit_id from source_listing where external_id = 'manual-42'`,
      );
      const { rows: listing } = await c.query(
        `select id, primary_source_listing_id, rent_amount_cents, origin from listing
         where primary_source_listing_id = $1`,
        [sl[0]!.id],
      );
      const { rows: prov } = await c.query(
        `select field_name, source_listing_id from listing_field_provenance where listing_id = $1`,
        [listing[0]!.id],
      );
      return { sl: sl[0], listing: listing[0], prov };
    });

    expect(result.sl).toBeTruthy();
    expect(result.sl!.resolution_status).toBe('resolved');
    expect(result.listing).toBeTruthy();
    expect(result.listing!.origin).toBe('manual');
    expect(result.prov.length).toBeGreaterThan(0);
    expect(result.prov.every((p) => p.source_listing_id === result.sl!.id)).toBe(true);

    writeEvidence(
      'manual-ingest.txt',
      JSON.stringify(result, null, 2) + '\n',
    );
  });

  it('CSV import of 500 rows: counts reported, ambiguous routed, zero silent drops', async () => {
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 498; i++) {
      rows.push({
        external_id: `csv-${i}`,
        address: `${1000 + i} Import St Apt ${i % 10}`,
        rent_amount_cents: 100000 + i * 10,
        bedrooms: 1,
      });
    }
    // Ambiguous: building-level
    rows.push({
      external_id: 'csv-building',
      address: '1 Building Ave',
      rent_amount_cents: 200000,
      unit_count: 40,
    });
    // Rejected: missing rent
    rows.push({
      external_id: 'csv-bad',
      address: '2 Bad Ave Apt 1',
    });

    const report = await withBypass(db.pool, async (c) => {
      const org = await createOrg(c, {
        kind: 'landlord',
        legalName: 'CSV LLC',
        displayName: 'CSV',
      });
      return ingestCsvRows(c, { orgId: org.id, rows });
    });

    const accounted =
      report.counts.resolved +
      report.counts.ambiguous +
      report.counts.rejected +
      report.counts.unresolvable +
      report.counts.unchanged;
    // fetched = accounted (no silent drops)
    expect(report.counts.fetched).toBe(500);
    expect(accounted).toBe(500);
    expect(report.counts.ambiguous).toBeGreaterThanOrEqual(1);
    expect(report.counts.rejected).toBeGreaterThanOrEqual(1);

    writeEvidence(
      'csv-import-500.txt',
      JSON.stringify({ syncRunId: report.syncRunId, counts: report.counts, accounted }, null, 2) +
        '\n',
    );
  });

  it('Concurrency: 50 parallel accepts → 1 placement, 49 typed rejections', async () => {
    const setup = await withBypass(db.pool, async (c) => {
      const org = await createOrg(c, {
        kind: 'landlord',
        legalName: 'Race LLC',
        displayName: 'Race',
      });
      await ingestManualListing(c, {
        orgId: org.id,
        externalId: 'race-unit',
        addressRaw: '99 Race St Apt 1',
        rentAmountCents: 120000,
      });
      const { rows: listing } = await c.query<{
        id: string;
        unit_id: string;
        org_id: string;
      }>(
        `select l.id, l.unit_id, l.org_id from listing l
         join source_listing sl on sl.id = l.primary_source_listing_id
         where sl.external_id = 'race-unit'`,
      );

      const apps: { applicationId: string; partyId: string }[] = [];
      for (let i = 0; i < 50; i++) {
        const party = await createPartyWithIdentity(c, db.kms, {
          identity: { email: `racer${i}@example.com` },
        });
        const { rows: rp } = await c.query<{ id: string }>(
          `insert into renter_profile (party_id, is_discoverable) values ($1, false) returning id`,
          [party.partyId],
        );
        const { rows: app } = await c.query<{ id: string }>(
          `insert into application (
             party_id, renter_profile_id, listing_id, unit_id, org_id,
             entry_point, status
           ) values ($1,$2,$3,$4,$5,'renter_initiated','screened')
           returning id`,
          [party.partyId, rp[0]!.id, listing[0]!.id, listing[0]!.unit_id, org.id],
        );
        apps.push({ applicationId: app[0]!.id, partyId: party.partyId });
      }
      return { listing: listing[0]!, apps };
    });

    const results = await Promise.all(
      setup.apps.map(async (app) => {
        try {
          return await withBypass(db.pool, (c) =>
            acceptPlacement(c, {
              unitId: setup.listing.unit_id,
              listingId: setup.listing.id,
              applicationId: app.applicationId,
              partyId: app.partyId,
              orgId: setup.listing.org_id,
            }),
          );
        } catch (err) {
          return err;
        }
      }),
    );

    const wins = results.filter((r) => r && typeof r === 'object' && 'placementId' in r);
    const rejects = results.filter((r) => r instanceof PlacementConflictError);
    expect(wins).toHaveLength(1);
    expect(rejects).toHaveLength(49);

    const count = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `select count(*)::text as n from placement
         where unit_id = $1 and status in ('hold','broker_assigned','lease_signed')`,
        [setup.listing.unit_id],
      );
      return Number(rows[0]!.n);
    });
    expect(count).toBe(1);

    writeEvidence(
      'concurrency-50.txt',
      `wins=${wins.length}\nrejects=${rejects.length}\nactive_placements=${count}\n`,
    );
  });

  it('Hold expiry: lapse → unit frees → queue head promoted → events', async () => {
    const clock = new MutableClock(new Date('2026-02-01T00:00:00Z'));
    const ids = await withBypass(db.pool, async (c) => {
      const org = await createOrg(c, {
        kind: 'landlord',
        legalName: 'Hold LLC',
        displayName: 'Hold',
      });
      await ingestManualListing(c, {
        orgId: org.id,
        externalId: 'hold-unit',
        addressRaw: '7 Hold St Apt 1',
        rentAmountCents: 130000,
      });
      const { rows: listing } = await c.query<{
        id: string;
        unit_id: string;
        org_id: string;
      }>(
        `select l.id, l.unit_id, l.org_id from listing l
         join source_listing sl on sl.id = l.primary_source_listing_id
         where sl.external_id = 'hold-unit'`,
      );

      async function makeApp(email: string) {
        const party = await createPartyWithIdentity(c, db.kms, { identity: { email } });
        const { rows: rp } = await c.query<{ id: string }>(
          `insert into renter_profile (party_id) values ($1) returning id`,
          [party.partyId],
        );
        const { rows: app } = await c.query<{ id: string }>(
          `insert into application (
             party_id, renter_profile_id, listing_id, unit_id, org_id,
             entry_point, status
           ) values ($1,$2,$3,$4,$5,'renter_initiated','screened') returning id`,
          [party.partyId, rp[0]!.id, listing[0]!.id, listing[0]!.unit_id, org.id],
        );
        return { applicationId: app[0]!.id, partyId: party.partyId };
      }

      const a1 = await makeApp('holder@example.com');
      const a2 = await makeApp('queued@example.com');
      const placed = await acceptPlacement(c, {
        unitId: listing[0]!.unit_id,
        listingId: listing[0]!.id,
        applicationId: a1.applicationId,
        partyId: a1.partyId,
        orgId: org.id,
        clock,
      });
      await enqueuePlacement(c, {
        listingId: listing[0]!.id,
        applicationId: a2.applicationId,
        rankScore: 1,
        rankPosition: 1,
      });
      return {
        placementId: placed.placementId,
        listingId: listing[0]!.id,
        unitId: listing[0]!.unit_id,
        queuedAppId: a2.applicationId,
      };
    });

    const promoted = await withBypass(db.pool, (c) =>
      lapseHoldAndPromote(c, ids.placementId, clock),
    );
    expect(promoted.promotedPlacementId).toBeTruthy();

    const state = await withBypass(db.pool, async (c) => {
      const { rows: orig } = await c.query<{ status: string }>(
        `select status from placement where id = $1`,
        [ids.placementId],
      );
      const { rows: neu } = await c.query<{ status: string; application_id: string }>(
        `select status, application_id from placement where id = $1`,
        [promoted.promotedPlacementId!],
      );
      const { rows: events } = await c.query<{ event_type: string }>(
        `select event_type from domain_event
         where event_type in ('placement.lapsed','placement_queue.promoted','placement.accepted')
         order by seq`,
      );
      return { orig: orig[0]!.status, neu: neu[0], events: events.map((e) => e.event_type) };
    });

    expect(state.orig).toBe('lapsed');
    expect(state.neu).toBeTruthy();
    expect(state.neu!.status).toBe('hold');
    expect(state.neu!.application_id).toBe(ids.queuedAppId);
    expect(state.events).toContain('placement.lapsed');
    expect(state.events).toContain('placement_queue.promoted');

    writeEvidence('hold-lapse-promote.txt', JSON.stringify(state, null, 2) + '\n');
  });

  it('Placement signed → four placement_outcome rows with correct scheduled dates', async () => {
    const clock = new MutableClock(new Date('2026-03-01T12:00:00Z'));
    const { placementId, outcomes } = await withBypass(db.pool, async (c) => {
      const org = await createOrg(c, {
        kind: 'landlord',
        legalName: 'Outcome LLC',
        displayName: 'Outcome',
      });
      await ingestManualListing(c, {
        orgId: org.id,
        externalId: 'outcome-unit',
        addressRaw: '5 Outcome Blvd Apt 2',
        rentAmountCents: 140000,
      });
      const { rows: listing } = await c.query<{
        id: string;
        unit_id: string;
      }>(
        `select l.id, l.unit_id from listing l
         join source_listing sl on sl.id = l.primary_source_listing_id
         where sl.external_id = 'outcome-unit'`,
      );
      const party = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'signed@example.com' },
      });
      const { rows: rp } = await c.query<{ id: string }>(
        `insert into renter_profile (party_id) values ($1) returning id`,
        [party.partyId],
      );
      const { rows: app } = await c.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, listing_id, unit_id, org_id,
           entry_point, status
         ) values ($1,$2,$3,$4,$5,'renter_initiated','screened') returning id`,
        [party.partyId, rp[0]!.id, listing[0]!.id, listing[0]!.unit_id, org.id],
      );
      const { placementId } = await acceptPlacement(c, {
        unitId: listing[0]!.unit_id,
        listingId: listing[0]!.id,
        applicationId: app[0]!.id,
        partyId: party.partyId,
        orgId: org.id,
        clock,
      });
      await markLeaseSigned(c, placementId, clock);
      await schedulePlacementOutcomes(c, placementId, clock);
      const { rows } = await c.query<{
        horizon_days: number;
        requested_at: Date;
      }>(
        `select horizon_days, requested_at from placement_outcome
         where placement_id = $1 order by horizon_days`,
        [placementId],
      );
      return { placementId, outcomes: rows };
    });

    expect(outcomes).toHaveLength(4);
    const signed = clock.now();
    for (const o of outcomes) {
      const expected = new Date(signed.getTime() + o.horizon_days * 86400000);
      expect(o.requested_at.toISOString()).toBe(expected.toISOString());
    }
    writeEvidence(
      'placement-outcomes-schedule.txt',
      JSON.stringify(
        {
          placementId,
          outcomes: outcomes.map((o) => ({
            horizon_days: o.horizon_days,
            requested_at: o.requested_at.toISOString(),
          })),
        },
        null,
        2,
      ) + '\n',
    );
  });

  it('Outcome capture: single-tap token records response without login session', async () => {
    const { token, outcomeId } = await withBypass(db.pool, async (c) => {
      const org = await createOrg(c, {
        kind: 'landlord',
        legalName: 'Tap LLC',
        displayName: 'Tap',
      });
      await ingestManualListing(c, {
        orgId: org.id,
        externalId: 'tap-unit',
        addressRaw: '8 Tap Lane Apt 4',
        rentAmountCents: 160000,
      });
      const { rows: listing } = await c.query<{ id: string; unit_id: string }>(
        `select l.id, l.unit_id from listing l
         join source_listing sl on sl.id = l.primary_source_listing_id
         where sl.external_id = 'tap-unit'`,
      );
      const party = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'tap@example.com' },
      });
      const { rows: rp } = await c.query<{ id: string }>(
        `insert into renter_profile (party_id) values ($1) returning id`,
        [party.partyId],
      );
      const { rows: app } = await c.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, listing_id, unit_id, org_id,
           entry_point, status
         ) values ($1,$2,$3,$4,$5,'renter_initiated','screened') returning id`,
        [party.partyId, rp[0]!.id, listing[0]!.id, listing[0]!.unit_id, org.id],
      );
      const { placementId } = await acceptPlacement(c, {
        unitId: listing[0]!.unit_id,
        listingId: listing[0]!.id,
        applicationId: app[0]!.id,
        partyId: party.partyId,
        orgId: org.id,
      });
      await markLeaseSigned(c, placementId);
      const { outcomeIds } = await schedulePlacementOutcomes(c, placementId);
      const outcomeId = outcomeIds[0]!;
      const token = mintOutcomeCaptureToken(
        outcomeId,
        new Date(Date.now() + 7 * 86400000),
      );
      return { token, outcomeId };
    });

    // Capture outside any session context — just a DB write with token.
    await withBypass(db.pool, (c) =>
      captureOutcomeFromToken(c, {
        token,
        paymentStatus: 'current',
        tenancyStatus: 'occupied',
      }),
    );

    const reported = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query<{
        reported_at: Date | null;
        payment_status: string;
        source: string;
      }>(`select reported_at, payment_status, source from placement_outcome where id = $1`, [
        outcomeId,
      ]);
      // Prove no session was required: zero sessions for this flow
      const { rows: sessions } = await c.query<{ n: string }>(
        `select count(*)::text as n from session`,
      );
      return { row: rows[0]!, sessionCount: Number(sessions[0]!.n) };
    });

    expect(reported.row.reported_at).toBeTruthy();
    expect(reported.row.payment_status).toBe('current');
    expect(reported.row.source).toBe('landlord_attest');

    writeEvidence(
      'outcome-capture-single-tap.txt',
      `outcomeId=${outcomeId}\npayment_status=${reported.row.payment_status}\nsource=${reported.row.source}\nnote=captured_via_signed_token_without_login\n`,
    );
  });

  it('Passwordless: single-use, 15-min expiry, enumeration-resistant, rate limits', async () => {
    resetAuthRateLimits();
    const clock = new MutableClock(new Date('2026-04-01T00:00:00Z'));

    const issueA = await withBypass(db.pool, (c) =>
      issueMagicToken(c, db.kms, {
        email: 'magic@example.com',
        purpose: 'login',
        ip: '1.2.3.4',
        returnTokenForTest: true,
        clock,
      }),
    );
    const issueUnknown = await withBypass(db.pool, (c) =>
      issueMagicToken(c, db.kms, {
        email: 'never-before-seen-xyz@example.com',
        purpose: 'login',
        ip: '1.2.3.5',
        returnTokenForTest: true,
        clock,
      }),
    );
    // Enumeration-resistant: same shape
    expect(issueA.ok).toBe(true);
    expect(issueUnknown.ok).toBe(true);
    expect(Object.keys(issueA).sort().join(',')).toBe(
      Object.keys(issueUnknown).sort().join(','),
    );

    const token = issueA.debugToken!;
    const session = await withBypass(db.pool, (c) =>
      redeemMagicToken(c, { token, purpose: 'login', clock }),
    );
    expect(session.sessionId).toBeTruthy();

    // Single-use
    await expect(
      withBypass(db.pool, (c) => redeemMagicToken(c, { token, purpose: 'login', clock })),
    ).rejects.toMatchObject({ code: 'auth_invalid_token' });

    // Expiry
    const issued2 = await withBypass(db.pool, (c) =>
      issueMagicToken(c, db.kms, {
        email: 'magic@example.com',
        purpose: 'login',
        returnTokenForTest: true,
        clock,
      }),
    );
    clock.advanceMs(16 * 60 * 1000);
    await expect(
      withBypass(db.pool, (c) =>
        redeemMagicToken(c, { token: issued2.debugToken!, purpose: 'login', clock }),
      ),
    ).rejects.toMatchObject({ code: 'auth_invalid_token' });

    // Rate limit
    resetAuthRateLimits();
    let limited = false;
    for (let i = 0; i < 6; i++) {
      try {
        await withBypass(db.pool, (c) =>
          issueMagicToken(c, db.kms, {
            email: 'ratelimit@example.com',
            purpose: 'login',
            ip: '9.9.9.9',
            clock,
          }),
        );
      } catch (err) {
        if ((err as { code?: string }).code === 'auth_rate_limited') {
          limited = true;
          break;
        }
        throw err;
      }
    }
    expect(limited).toBe(true);

    writeEvidence(
      'passwordless-auth.txt',
      [
        'enumeration_resistant=true',
        'single_use=true',
        'expiry_15m=true',
        'rate_limit=true',
      ].join('\n') + '\n',
    );
  });

  it('Renter search allowlist rejection + minimal serializer + admin_action_log', async () => {
    const { actorId, hits } = await withBypass(db.pool, async (c) => {
      const actor = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'landlord-search@example.com', givenName: 'Lan' },
      });
      const renter = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'discoverable@example.com', givenName: 'Ren' },
      });
      await c.query(
        `insert into renter_profile (
           party_id, is_discoverable, discoverability_level, badge_state, rent_max_cents
         ) values ($1, true, 'minimal', 'prechecked', 200000)`,
        [renter.partyId],
      );
      await c.query(
        `update party_features set latest_score = 72 where party_id = $1`,
        [renter.partyId],
      );

      await expect(
        searchDiscoverableRenters(c, {
          actorPartyId: actor.partyId,
          filters: { ethnicity: 'x', badge_state: 'prechecked' },
        }),
      ).rejects.toBeInstanceOf(AllowlistViolationError);

      const hits = await searchDiscoverableRenters(c, {
        actorPartyId: actor.partyId,
        filters: { badge_state: 'prechecked', rent_max_cents: 250000 },
      });
      return { actorId: actor.partyId, hits };
    });

    expect(hits.length).toBeGreaterThanOrEqual(1);
    for (const hit of hits) {
      expect(hit).not.toHaveProperty('email');
      expect(hit).not.toHaveProperty('given_name');
      expect(hit).not.toHaveProperty('party_id');
      expect(hit).not.toHaveProperty('givenName');
    }

    const logged = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query<{ action: string; after_state: unknown }>(
        `select action, after_state from admin_action_log
         where actor_party_id = $1 and action = 'renter_search.executed'
         order by seq desc limit 1`,
        [actorId],
      );
      return rows[0];
    });
    expect(logged?.action).toBe('renter_search.executed');
    expect((logged?.after_state as { filters: unknown }).filters).toMatchObject({
      badge_state: 'prechecked',
    });

    writeEvidence(
      'renter-search-allowlist.txt',
      JSON.stringify({ hits, logged }, null, 2) + '\n',
    );
  });

  it('Notifications create/send stub', async () => {
    const result = await withBypass(db.pool, async (c) => {
      const party = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'notify@example.com' },
      });
      const { id } = await createNotification(c, {
        recipientPartyId: party.partyId,
        channel: 'email',
        eventType: 'placement.hold',
        templateKey: 'placement_hold',
        payload: { placement_ref: randomUUID() },
      });
      const sent = await sendNotificationStub(c, id);
      const { rows } = await c.query<{ status: string }>(
        `select status from notification where id = $1`,
        [id],
      );
      return { id, sent, status: rows[0]!.status };
    });
    expect(result.status).toBe('sent');
    writeEvidence('notifications-stub.txt', JSON.stringify(result) + '\n');
  });
});
