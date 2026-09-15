import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  disableBadgeShare,
  enableBadgeShare,
  getPublicBadge,
  resetBadgeRateLimitState,
  serializePublicBadge,
} from '../../src/modules/badge/index.js';
import { AppError } from '../../src/modules/shared/errors.js';
import { createPartyWithIdentity } from '../../src/modules/identity/index.js';
import { setTenantContext } from '../../src/db/session.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'part-b', 'B-1');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

describe('B-1 — Shareable renter verification badge', () => {
  let db: TestDb;
  let appPool: DbPool;
  let partyId: string;
  let profileId: string;

  beforeAll(async () => {
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);

    await withBypass(db.pool, async (c) => {
      const party = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'badge-renter@example.com' },
      });
      partyId = party.partyId;
      const { rows } = await c.query<{ id: string }>(
        `insert into renter_profile (party_id, badge_state, household_size, has_pets, is_discoverable)
         values ($1,'fully_screened',2,false,true) returning id`,
        [partyId],
      );
      profileId = rows[0]!.id;
      await c.query(
        `insert into party_features (party_id, first_seen_at, income_band, latest_score, updated_at)
         values ($1, now(), 3, 85, now())
         on conflict (party_id) do update
           set income_band = 3, latest_score = 85, updated_at = now()`,
        [partyId],
      );
      const { rows: pkg } = await c.query<{ id: string }>(
        `insert into screening_package (package_key, version, product_codes, total_cost_cents)
         values ('b1','v1',array['identity'],100)
         on conflict (package_key, version) do update set total_cost_cents = 100
         returning id`,
      );
      const packageId =
        pkg[0]?.id ??
        (
          await c.query<{ id: string }>(
            `select id from screening_package where package_key='b1'`,
          )
        ).rows[0]!.id;
      const { rows: order } = await c.query<{ id: string }>(
        `insert into screening_order (
           party_id, package_id, payer_kind, amount_charged_cents, status
         ) values ($1,$2,'applicant',100,'complete') returning id`,
        [partyId, packageId],
      );
      await c.query(
        `insert into screening_report (
           screening_order_id, party_id, vendor, vendor_report_id, report_kind, status
         ) values ($1,$2,'certn','b1-ident','identity','complete')`,
        [order[0]!.id, partyId],
      );
    });
  }, 300_000);

  beforeEach(() => {
    resetBadgeRateLimitState();
  });

  afterAll(async () => {
    await appPool?.end();
    await db?.stop();
  });

  it('allowlist serializer rejects identity fields', () => {
    expect(() =>
      serializePublicBadge({
        badge_state: 'fully_screened',
        score_band: 'A',
        income_band: 3,
        verification_components: [],
        move_in_window: { earliest: null, latest: null },
        submarket_names: [],
        household_size: 2,
        has_pets: false,
        cta: { label: 'x', href: 'y' },
        cache_control_max_age_seconds: 60,
        email: 'leak@example.com',
      }),
    ).toThrow(/identity|allowlist/i);

    expect(() =>
      serializePublicBadge({
        badge_state: 'fully_screened',
        score_band: 'A',
        income_band: 3,
        verification_components: [],
        move_in_window: { earliest: null, latest: null },
        submarket_names: [],
        household_size: 2,
        has_pets: false,
        cta: { label: 'x', href: 'y' },
        cache_control_max_age_seconds: 60,
        name: 'Jane',
        phone: '555',
      }),
    ).toThrow(/identity|allowlist/i);
  });

  it('public badge returns allowlisted fields; disabled/rotated → 404; views + events', async () => {
    const enabled = await withBypass(db.pool, async (c) => {
      await setTenantContext(c, { partyId, bypassRls: true });
      return enableBadgeShare(c, { partyId });
    });

    expect(enabled.shareUrl).toMatch(/^https:\/\/dwel\.app\/badge\//);
    writeEvidence('share-url.txt', enabled.shareUrl + '\n');

    const app = await appPool.connect();
    try {
      await app.query('begin');
      await setTenantContext(app, { orgId: null, partyId: null, bypassRls: false });
      const publicBody = await getPublicBadge(app, {
        token: enabled.token,
        viewerIp: '203.0.113.10',
        viewerUa: 'test-agent',
        skipRateLimit: true,
      });
      await app.query('commit');

      writeEvidence('public-badge.json', JSON.stringify(publicBody, null, 2) + '\n');
      expect(publicBody.badge_state).toBe('fully_screened');
      expect(publicBody.score_band).toBe('A');
      expect(publicBody.income_band).toBe(3);
      expect(publicBody.cta.label).toMatch(/List your property/);
      expect(publicBody.cache_control_max_age_seconds).toBe(60);
      expect(publicBody).not.toHaveProperty('email');
      expect(publicBody).not.toHaveProperty('name');
      expect(publicBody).not.toHaveProperty('phone');

      await app.query('begin');
      await setTenantContext(app, { partyId: null, bypassRls: false });
      await getPublicBadge(app, {
        token: enabled.token,
        viewerIp: '203.0.113.11',
        viewerPartyId: partyId,
        skipRateLimit: true,
      });
      await app.query('commit');
    } finally {
      app.release();
    }

    const logs = await withBypass(db.pool, async (c) => {
      const { rows: views } = await c.query<{
        is_authenticated: boolean;
        viewer_party_id: string | null;
      }>(
        `select is_authenticated, viewer_party_id::text
         from badge_share_view where renter_profile_id = $1 order by occurred_at`,
        [profileId],
      );
      const { rows: counters } = await c.query<{ badge_share_views: number }>(
        `select badge_share_views from renter_profile where id = $1`,
        [profileId],
      );
      const { rows: events } = await c.query<{ event_type: string }>(
        `select event_type from domain_event
         where aggregate_id = $1 and event_type like 'renter_badge%'
         order by occurred_at`,
        [profileId],
      );
      return { views, viewsCount: counters[0]!.badge_share_views, events };
    });

    writeEvidence('views-and-events.json', JSON.stringify(logs, null, 2) + '\n');
    expect(logs.views.length).toBeGreaterThanOrEqual(2);
    expect(logs.views.some((v) => !v.is_authenticated)).toBe(true);
    expect(logs.views.some((v) => v.is_authenticated && v.viewer_party_id === partyId)).toBe(
      true,
    );
    expect(logs.viewsCount).toBeGreaterThanOrEqual(2);
    expect(logs.events.map((e) => e.event_type)).toContain('renter_badge_shared');

    const oldToken = enabled.token;
    await withBypass(db.pool, async (c) => {
      await setTenantContext(c, { partyId, bypassRls: true });
      await disableBadgeShare(c, { partyId });
    });

    const app2 = await appPool.connect();
    try {
      await app2.query('begin');
      await setTenantContext(app2, { bypassRls: false });
      let status = 0;
      try {
        await getPublicBadge(app2, { token: oldToken, skipRateLimit: true });
      } catch (err) {
        status = (err as AppError).status;
      }
      await app2.query('rollback');
      expect(status).toBe(404);
      writeEvidence('disabled-404.txt', `old_token_status=${status}\n`);
    } finally {
      app2.release();
    }

    const disableEvents = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query<{ event_type: string }>(
        `select event_type from domain_event
         where aggregate_id = $1 and event_type = 'renter_badge_share_disabled'`,
        [profileId],
      );
      return rows;
    });
    expect(disableEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('61st request from same IP within 60s → 429', async () => {
    const enabled = await withBypass(db.pool, async (c) => {
      await setTenantContext(c, { partyId, bypassRls: true });
      return enableBadgeShare(c, { partyId });
    });

    const app = await appPool.connect();
    try {
      await app.query('begin');
      await setTenantContext(app, { bypassRls: false });
      for (let i = 0; i < 60; i++) {
        await getPublicBadge(app, {
          token: enabled.token,
          viewerIp: '198.51.100.7',
        });
      }
      let status = 0;
      try {
        await getPublicBadge(app, {
          token: enabled.token,
          viewerIp: '198.51.100.7',
        });
      } catch (err) {
        status = (err as AppError).status;
      }
      await app.query('commit');
      expect(status).toBe(429);
      writeEvidence('rate-limit-429.txt', `status=${status}\n`);
    } finally {
      app.release();
    }
  });
});
