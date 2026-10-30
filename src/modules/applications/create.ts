import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';

const rateBuckets = new Map<string, number[]>();

const DEFAULT_MAX_PER_IP_PER_HOUR = 10;
const DEFAULT_MAX_PER_LISTING_PER_HOUR = 50;

export function resetApplicationCreationRateLimits(): void {
  rateBuckets.clear();
}

function pruneAndCount(key: string, windowMs: number, now: number): number {
  const arr = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  rateBuckets.set(key, arr);
  return arr.length;
}

function hitRate(key: string, now: number): void {
  const arr = rateBuckets.get(key) ?? [];
  arr.push(now);
  rateBuckets.set(key, arr);
}

export type ApplicationCreationRateLimitInput = {
  ip: string;
  listingId: string;
  nowMs?: number;
  maxPerIpPerHour?: number;
  maxPerListingPerHour?: number;
};

export function checkApplicationCreationRateLimit(
  input: ApplicationCreationRateLimitInput,
): void {
  const nowMs = input.nowMs ?? Date.now();
  const windowMs = 60 * 60 * 1000;
  const maxIp = input.maxPerIpPerHour ?? DEFAULT_MAX_PER_IP_PER_HOUR;
  const maxListing = input.maxPerListingPerHour ?? DEFAULT_MAX_PER_LISTING_PER_HOUR;

  const ipKey = `ip:${input.ip}`;
  const listingKey = `listing:${input.listingId}`;

  if (pruneAndCount(ipKey, windowMs, nowMs) >= maxIp) {
    throw new AppError(
      'application creation rate limit exceeded',
      'application_creation_rate_limited',
      429,
    );
  }
  if (pruneAndCount(listingKey, windowMs, nowMs) >= maxListing) {
    throw new AppError(
      'application creation rate limit exceeded',
      'application_creation_rate_limited',
      429,
    );
  }

  hitRate(ipKey, nowMs);
  hitRate(listingKey, nowMs);
}

export type ApplicationRecordKind = 'interest' | 'formal';

export type CreatePublicApplicationInput = {
  listingId: string;
  deviceId?: string | null;
  ip?: string | null;
  /** When set, attach application to existing session party (authenticated interest). */
  partyId?: string | null;
  initialStatus?: string;
  /** Interest and formal applications are separate open rows. Defaults to interest. */
  recordKind?: ApplicationRecordKind;
};

export function isUniqueViolation(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    if ((err as { code?: string }).code === '23505') return true;
  }
  if (typeof err === 'object' && err !== null && 'cause' in err) {
    return isUniqueViolation((err as { cause?: unknown }).cause);
  }
  return false;
}

/** A unique violation aborts the current transaction. Retry in a new one. */
export async function retryOnUniqueViolation<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return await fn();
  }
}

export type CreatePublicApplicationResult = {
  applicationId: string;
  orgId: string;
  listingId: string;
  unitId: string;
  status: string;
  reused: boolean;
};

/**
 * Create a draft application for an active listing.
 * Authenticated renters reuse party + renter_profile; duplicates for same listing return existing open app.
 */
export async function createPublicApplication(
  client: DbClient,
  input: CreatePublicApplicationInput,
): Promise<CreatePublicApplicationResult> {
  const { rows: listings } = await client.query<{
    id: string;
    org_id: string;
    unit_id: string;
    status: string;
  }>(
    `select id, org_id, unit_id, status from listing where id = $1`,
    [input.listingId],
  );
  const listing = listings[0];
  if (!listing) {
    throw new AppError('listing not found', 'listing_not_found', 404);
  }
  if (listing.status !== 'active') {
    throw new AppError('listing not available', 'listing_not_available', 409);
  }

  let partyId = input.partyId ?? null;
  const recordKind = input.recordKind ?? 'interest';
  if (partyId) {
    const existing = await client.query<{ id: string; status: string }>(
      `select id, status from application
       where party_id = $1 and listing_id = $2 and record_kind = $3
         and closed_at is null
         and status not in ('declined','withdrawn','closed')
       order by created_at desc
       limit 1`,
      [partyId, listing.id, recordKind],
    );
    if (existing.rows[0]) {
      return {
        applicationId: existing.rows[0].id,
        orgId: listing.org_id,
        listingId: listing.id,
        unitId: listing.unit_id,
        status: existing.rows[0].status,
        reused: true,
      };
    }
  } else {
    const { rows: party } = await client.query<{ id: string }>(
      `insert into party (kind) values ('person') returning id`,
    );
    partyId = party[0]!.id;
  }

  let profileId: string;
  const { rows: profileRows } = await client.query<{ id: string }>(
    `select id from renter_profile where party_id = $1`,
    [partyId],
  );
  if (profileRows[0]) {
    profileId = profileRows[0].id;
  } else {
    const { rows: createdProfile } = await client.query<{ id: string }>(
      `insert into renter_profile (party_id) values ($1) returning id`,
      [partyId],
    );
    profileId = createdProfile[0]!.id;
  }

  const status = input.initialStatus ?? 'draft';
  const { rows: app } = await client.query<{ id: string; status: string }>(
    `insert into application (
       party_id, renter_profile_id, listing_id, unit_id, org_id,
       entry_point, status, device_id, record_kind
     ) values ($1,$2,$3,$4,$5,'renter_initiated',$7,$6,$8)
     returning id, status`,
    [
      partyId,
      profileId,
      listing.id,
      listing.unit_id,
      listing.org_id,
      input.deviceId ?? null,
      status,
      recordKind,
    ],
  );

  return {
    applicationId: app[0]!.id,
    orgId: listing.org_id,
    listingId: listing.id,
    unitId: listing.unit_id,
    status: app[0]!.status,
    reused: false,
  };
}
