import { randomBytes } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';

/** Fields allowed on the public badge response — anything else is rejected. */
export const BADGE_PUBLIC_ALLOWLIST = [
  'badge_state',
  'score_band',
  'income_band',
  'verification_components',
  'move_in_window',
  'submarket_names',
  'household_size',
  'has_pets',
  'cta',
  'cache_control_max_age_seconds',
] as const;

export type BadgePublicResponse = {
  badge_state: string;
  score_band: string | null;
  income_band: number | null;
  verification_components: string[];
  move_in_window: { earliest: string | null; latest: string | null };
  submarket_names: string[];
  household_size: number | null;
  has_pets: boolean | null;
  cta: { label: string; href: string };
  cache_control_max_age_seconds: number;
};

const IDENTITY_OR_FORBIDDEN = new Set([
  'email',
  'phone',
  'name',
  'given_name',
  'family_name',
  'givenName',
  'familyName',
  'dob',
  'date_of_birth',
  'address',
  'party_id',
  'partyId',
  'exact_income',
  'income_cents',
  'monthly_income_cents',
]);

export function serializePublicBadge(
  raw: Record<string, unknown>,
): BadgePublicResponse {
  for (const key of Object.keys(raw)) {
    if (IDENTITY_OR_FORBIDDEN.has(key)) {
      throw new AppError(
        `identity/forbidden field rejected by badge allowlist: ${key}`,
        'badge_identity_leak',
        500,
      );
    }
    if (!(BADGE_PUBLIC_ALLOWLIST as readonly string[]).includes(key)) {
      throw new AppError(
        `field outside badge allowlist: ${key}`,
        'badge_allowlist_violation',
        500,
      );
    }
  }
  for (const required of BADGE_PUBLIC_ALLOWLIST) {
    if (!(required in raw)) {
      throw new AppError(
        `missing required badge field: ${required}`,
        'badge_incomplete',
        500,
      );
    }
  }
  return raw as BadgePublicResponse;
}

function scoreBand(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

function newShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function enableBadgeShare(
  client: DbClient,
  input: { partyId: string; clock?: Clock; baseUrl?: string },
): Promise<{ token: string; shareUrl: string; created: boolean }> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const base = (input.baseUrl ?? 'https://dwel.app').replace(/\/$/, '');

  const { rows } = await client.query<{
    id: string;
    badge_share_token: string | null;
    badge_share_enabled: boolean;
  }>(
    `select id, badge_share_token, badge_share_enabled
     from renter_profile where party_id = $1 for update`,
    [input.partyId],
  );
  const rp = rows[0];
  if (!rp) {
    throw new AppError('renter profile not found', 'renter_profile_not_found', 404);
  }

  let token = rp.badge_share_token;
  let created = false;
  if (!token) {
    token = newShareToken();
    created = true;
  }

  await client.query(
    `update renter_profile
     set badge_share_token = $2,
         badge_share_enabled = true,
         updated_at = $3
     where id = $1`,
    [rp.id, token, now],
  );

  await emitDomainEvent(client, {
    aggregateType: 'renter_profile',
    aggregateId: rp.id,
    eventType: 'renter_badge_shared',
    payload: { party_id: input.partyId, token_rotated: created },
    actorPartyId: input.partyId,
    actorKind: 'user',
    occurredAt: now,
  });

  return { token, shareUrl: `${base}/badge/${token}`, created };
}

/**
 * Disable sharing and rotate token so the old URL 404s immediately.
 */
export async function disableBadgeShare(
  client: DbClient,
  input: { partyId: string; clock?: Clock },
): Promise<{ rotated: true }> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();

  const { rows } = await client.query<{ id: string }>(
    `select id from renter_profile where party_id = $1 for update`,
    [input.partyId],
  );
  const rp = rows[0];
  if (!rp) {
    throw new AppError('renter profile not found', 'renter_profile_not_found', 404);
  }

  const newToken = newShareToken();
  await client.query(
    `update renter_profile
     set badge_share_token = $2,
         badge_share_enabled = false,
         updated_at = $3
     where id = $1`,
    [rp.id, newToken, now],
  );

  await emitDomainEvent(client, {
    aggregateType: 'renter_profile',
    aggregateId: rp.id,
    eventType: 'renter_badge_share_disabled',
    payload: { party_id: input.partyId },
    actorPartyId: input.partyId,
    actorKind: 'user',
    occurredAt: now,
  });

  return { rotated: true };
}

const badgeIpBuckets = new Map<string, number[]>();

export function resetBadgeRateLimitState(): void {
  badgeIpBuckets.clear();
}

/** 60 requests / 60s per IP for GET /v1/badge/{token}. */
export function assertBadgeRateLimit(ip: string, nowMs = Date.now()): void {
  const windowMs = 60_000;
  const limit = 60;
  let stamps = badgeIpBuckets.get(ip) ?? [];
  stamps = stamps.filter((t) => nowMs - t < windowMs);
  if (stamps.length >= limit) {
    badgeIpBuckets.set(ip, stamps);
    throw new AppError('rate limit exceeded', 'badge_rate_limited', 429);
  }
  stamps.push(nowMs);
  badgeIpBuckets.set(ip, stamps);
}

/**
 * Public badge fetch — equivalent to GET /v1/badge/{token}.
 * Returns 404 (not 403) when missing or disabled.
 */
export async function getPublicBadge(
  client: DbClient,
  input: {
    token: string;
    viewerIp?: string | null;
    viewerUa?: string | null;
    referrer?: string | null;
    viewerPartyId?: string | null;
    clock?: Clock;
    /** Skip rate limit (tests that aren't measuring it). */
    skipRateLimit?: boolean;
  },
): Promise<BadgePublicResponse> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();

  if (!input.skipRateLimit) {
    assertBadgeRateLimit(input.viewerIp ?? 'unknown', now.getTime());
  }

  await client.query(`select set_config('rbit.badge_share_token', $1, true)`, [
    input.token,
  ]);

  const { rows } = await client.query<{
    id: string;
    party_id: string;
    badge_state: string;
    badge_share_enabled: boolean;
    move_in_earliest: string | null;
    move_in_latest: string | null;
    household_size: number | null;
    has_pets: boolean | null;
    target_submarket_ids: string[] | null;
    income_band: number | null;
    latest_score: string | null;
  }>(
    `select rp.id, rp.party_id, rp.badge_state, rp.badge_share_enabled,
            rp.move_in_earliest::text, rp.move_in_latest::text,
            rp.household_size, rp.has_pets, rp.target_submarket_ids,
            pf.income_band, pf.latest_score::text
     from renter_profile rp
     left join party_features pf on pf.party_id = rp.party_id
     where rp.badge_share_token = $1`,
    [input.token],
  );

  const row = rows[0];
  if (!row || !row.badge_share_enabled) {
    throw new AppError('not found', 'badge_not_found', 404);
  }

  await client.query(
    `update renter_profile
     set badge_share_views = badge_share_views + 1, updated_at = $2
     where id = $1`,
    [row.id, now],
  );

  await client.query(
    `insert into badge_share_view (
       renter_profile_id, viewer_ip, viewer_ua, referrer,
       is_authenticated, viewer_party_id, occurred_at
     ) values ($1, $2::inet, $3, $4, $5, $6, $7)`,
    [
      row.id,
      input.viewerIp ?? null,
      input.viewerUa ?? null,
      input.referrer ?? null,
      Boolean(input.viewerPartyId),
      input.viewerPartyId ?? null,
      now,
    ],
  );

  // Enrichment tables are PARTY-RLS; public path already authorized via share token.
  await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
  const { rows: reports } = await client.query<{ report_kind: string }>(
    `select report_kind from screening_report
     where party_id = $1 and status = 'complete'`,
    [row.party_id],
  );
  const { rows: income } = await client.query<{ n: string }>(
    `select count(*)::text as n from income_verification where party_id = $1`,
    [row.party_id],
  );
  const components = new Set(reports.map((r) => r.report_kind));
  if (Number(income[0]?.n ?? 0) > 0) components.add('income');

  let submarketNames: string[] = [];
  const ids = row.target_submarket_ids ?? [];
  if (ids.length) {
    const { rows: sms } = await client.query<{ name: string }>(
      `select name from submarket where id = any($1::uuid[]) order by name`,
      [ids],
    );
    submarketNames = sms.map((s) => s.name);
  }
  await client.query(`select set_config('rbit.bypass_rls', 'off', true)`);

  const payload: Record<string, unknown> = {
    badge_state: row.badge_state,
    score_band: scoreBand(
      row.latest_score != null ? Number(row.latest_score) : null,
    ),
    income_band: row.income_band,
    verification_components: [...components].sort(),
    move_in_window: {
      earliest: row.move_in_earliest,
      latest: row.move_in_latest,
    },
    submarket_names: submarketNames,
    household_size: row.household_size,
    has_pets: row.has_pets,
    cta: {
      label: 'List your property on dwel →',
      href: 'https://dwel.app/landlord/signup',
    },
    cache_control_max_age_seconds: 60,
  };

  return serializePublicBadge(payload);
}
