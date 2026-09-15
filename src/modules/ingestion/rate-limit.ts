import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { DEFAULT_INGESTION_THRESHOLDS } from './types.js';

type Bucket = {
  tokens: number;
  lastRefillMs: number;
  consecutiveFailures: number;
  breakerOpenUntilMs: number | null;
  state: 'closed' | 'open' | 'half_open';
};

const buckets = new Map<string, Bucket>();

export function resetRateLimiters(): void {
  buckets.clear();
}

function getBucket(sourceId: string, ratePerMinute: number, clock: Clock): Bucket {
  let b = buckets.get(sourceId);
  if (!b) {
    b = {
      tokens: ratePerMinute,
      lastRefillMs: clock.now().getTime(),
      consecutiveFailures: 0,
      breakerOpenUntilMs: null,
      state: 'closed',
    };
    buckets.set(sourceId, b);
  }
  return b;
}

function refill(b: Bucket, ratePerMinute: number, nowMs: number): void {
  const elapsed = nowMs - b.lastRefillMs;
  const add = (elapsed / 60_000) * ratePerMinute;
  b.tokens = Math.min(ratePerMinute, b.tokens + add);
  b.lastRefillMs = nowMs;
}

export type AcquireResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'circuit_open'; retryAfterMs: number };

/**
 * Per-source token bucket + circuit breaker (§6A.7).
 * Respects Retry-After via retryAfterMs; exponential backoff with jitter on failures.
 */
export function acquireSyncSlot(
  sourceId: string,
  opts?: {
    rateLimitPerMinute?: number;
    clock?: Clock;
    breakerFailures?: number;
  },
): AcquireResult {
  const clock = opts?.clock ?? systemClock;
  const rate = opts?.rateLimitPerMinute ?? 60;
  const threshold = opts?.breakerFailures ?? DEFAULT_INGESTION_THRESHOLDS.circuit_breaker_failures;
  const now = clock.now().getTime();
  const b = getBucket(sourceId, rate, clock);

  if (b.state === 'open') {
    if (b.breakerOpenUntilMs != null && now >= b.breakerOpenUntilMs) {
      b.state = 'half_open';
      b.breakerOpenUntilMs = null;
    } else {
      return {
        ok: false,
        reason: 'circuit_open',
        retryAfterMs: Math.max(0, (b.breakerOpenUntilMs ?? now) - now),
      };
    }
  }

  refill(b, rate, now);
  if (b.tokens < 1) {
    const retryAfterMs = Math.ceil(((1 - b.tokens) / rate) * 60_000);
    return { ok: false, reason: 'rate_limited', retryAfterMs };
  }
  b.tokens -= 1;
  return { ok: true };
}

export function recordSyncSuccess(sourceId: string): void {
  const b = buckets.get(sourceId);
  if (!b) return;
  b.consecutiveFailures = 0;
  b.state = 'closed';
  b.breakerOpenUntilMs = null;
}

export function recordSyncFailure(
  sourceId: string,
  opts?: { clock?: Clock; breakerFailures?: number; retryAfterHeaderSec?: number },
): { openedBreaker: boolean; backoffMs: number } {
  const clock = opts?.clock ?? systemClock;
  const threshold = opts?.breakerFailures ?? DEFAULT_INGESTION_THRESHOLDS.circuit_breaker_failures;
  const b = getBucket(sourceId, 60, clock);
  b.consecutiveFailures += 1;
  const exp = Math.min(6, b.consecutiveFailures);
  const base = Math.pow(2, exp) * 1000;
  const jitter = Math.floor(Math.random() * 250);
  const headerMs = (opts?.retryAfterHeaderSec ?? 0) * 1000;
  const backoffMs = Math.max(base + jitter, headerMs);

  if (b.consecutiveFailures >= threshold) {
    b.state = 'open';
    b.breakerOpenUntilMs = clock.now().getTime() + backoffMs * 2;
    return { openedBreaker: true, backoffMs };
  }
  return { openedBreaker: false, backoffMs };
}

export function getBreakerState(sourceId: string): Bucket['state'] {
  return buckets.get(sourceId)?.state ?? 'closed';
}
