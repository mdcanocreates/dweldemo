/**
 * §3.7 Public API protection — rate limiting + bot/crawler policy from scraping_policy config.
 */

import type { DbClient } from '../../db/pool.js';
import { resolveConfig } from '../config/index.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';

export type ScrapingPolicy = {
  allow_indexed_crawlers: boolean;
  allow_generic_automation: boolean;
  unauthenticated_burst_limit: number;
  unauthenticated_window_ms: number;
};

export const DEFAULT_SCRAPING_POLICY_TEST: ScrapingPolicy = {
  allow_indexed_crawlers: true,
  allow_generic_automation: false,
  unauthenticated_burst_limit: 30,
  unauthenticated_window_ms: 60_000,
};

const INDEXED_CRAWLER_UA =
  /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|applebot|facebookexternalhit/i;

type Bucket = { timestamps: number[] };

const ipBuckets = new Map<string, Bucket>();
const partyBuckets = new Map<string, Bucket>();
const orgBuckets = new Map<string, Bucket>();

export function resetRateLimitState(): void {
  ipBuckets.clear();
  partyBuckets.clear();
  orgBuckets.clear();
}

export async function loadScrapingPolicy(
  client: DbClient,
  asOf?: Date,
): Promise<ScrapingPolicy> {
  const payload = await resolveConfig(client, 'scraping_policy', asOf ?? new Date());
  if (!payload) return { ...DEFAULT_SCRAPING_POLICY_TEST };
  return {
    allow_indexed_crawlers: Boolean(payload.allow_indexed_crawlers ?? true),
    allow_generic_automation: Boolean(payload.allow_generic_automation ?? false),
    unauthenticated_burst_limit: Number(
      payload.unauthenticated_burst_limit ?? DEFAULT_SCRAPING_POLICY_TEST.unauthenticated_burst_limit,
    ),
    unauthenticated_window_ms: Number(
      payload.unauthenticated_window_ms ?? DEFAULT_SCRAPING_POLICY_TEST.unauthenticated_window_ms,
    ),
  };
}

function takeToken(
  map: Map<string, Bucket>,
  key: string,
  limit: number,
  windowMs: number,
  nowMs: number,
): boolean {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    map.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => nowMs - t < windowMs);
  if (bucket.timestamps.length >= limit) return false;
  bucket.timestamps.push(nowMs);
  return true;
}

export type PublicRequestContext = {
  ip: string;
  userAgent?: string | null;
  partyId?: string | null;
  orgId?: string | null;
  /** Fingerprint for unauthenticated clients. */
  fingerprint?: string | null;
  isBot?: boolean;
  isIndexedCrawler?: boolean;
};

export type RateLimitDecision = {
  allowed: boolean;
  reason?:
    | 'ok'
    | 'unauthenticated_burst'
    | 'party_limit'
    | 'org_limit'
    | 'generic_automation_denied'
    | 'indexed_crawler_denied';
  retryAfterMs?: number;
};

/**
 * Evaluate rate limit + scraping_policy for a public listing/search request.
 */
export async function evaluatePublicApiProtection(
  client: DbClient,
  ctx: PublicRequestContext,
  opts?: { clock?: Clock; policy?: ScrapingPolicy },
): Promise<RateLimitDecision> {
  const clock = opts?.clock ?? systemClock;
  const nowMs = clock.now().getTime();
  const policy = opts?.policy ?? (await loadScrapingPolicy(client, clock.now()));

  const ua = ctx.userAgent ?? '';
  const isIndexed =
    ctx.isIndexedCrawler === true || INDEXED_CRAWLER_UA.test(ua);
  const isGenericBot =
    ctx.isBot === true ||
    (!isIndexed && /bot|crawler|spider|scrapy|curl|wget|python-requests/i.test(ua));

  if (isIndexed) {
    if (!policy.allow_indexed_crawlers) {
      return { allowed: false, reason: 'indexed_crawler_denied' };
    }
    return { allowed: true, reason: 'ok' };
  }

  if (isGenericBot && !policy.allow_generic_automation) {
    return { allowed: false, reason: 'generic_automation_denied' };
  }

  if (ctx.partyId) {
    const ok = takeToken(
      partyBuckets,
      ctx.partyId,
      policy.unauthenticated_burst_limit * 2,
      policy.unauthenticated_window_ms,
      nowMs,
    );
    if (!ok) {
      return {
        allowed: false,
        reason: 'party_limit',
        retryAfterMs: policy.unauthenticated_window_ms,
      };
    }
  }

  if (ctx.orgId) {
    const ok = takeToken(
      orgBuckets,
      ctx.orgId,
      policy.unauthenticated_burst_limit * 3,
      policy.unauthenticated_window_ms,
      nowMs,
    );
    if (!ok) {
      return {
        allowed: false,
        reason: 'org_limit',
        retryAfterMs: policy.unauthenticated_window_ms,
      };
    }
  }

  if (!ctx.partyId) {
    const key = ctx.fingerprint ?? ctx.ip;
    const ok = takeToken(
      ipBuckets,
      key,
      policy.unauthenticated_burst_limit,
      policy.unauthenticated_window_ms,
      nowMs,
    );
    if (!ok) {
      return {
        allowed: false,
        reason: 'unauthenticated_burst',
        retryAfterMs: policy.unauthenticated_window_ms,
      };
    }
  }

  return { allowed: true, reason: 'ok' };
}

export async function assertPublicApiAllowed(
  client: DbClient,
  ctx: PublicRequestContext,
  opts?: { clock?: Clock; policy?: ScrapingPolicy },
): Promise<void> {
  const decision = await evaluatePublicApiProtection(client, ctx, opts);
  if (!decision.allowed) {
    throw new AppError(
      `public api blocked: ${decision.reason}`,
      decision.reason ?? 'rate_limited',
      decision.reason === 'unauthenticated_burst' ||
        decision.reason === 'party_limit' ||
        decision.reason === 'org_limit'
        ? 429
        : 403,
    );
  }
}
