import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';

export type CreditTier = 'new' | 'established' | 'invoiced' | 'suspended';

export async function upsertBrokerProfile(
  client: DbClient,
  input: {
    orgId: string;
    licenseState: string;
    licenseNumber?: string | null;
    licenseVerifiedAt?: Date | null;
    licenseExpiresAt?: string | null; // date YYYY-MM-DD
    status?: string;
    creditTier?: CreditTier;
    maxOpenLeads?: number;
    isAutoAccept?: boolean;
  },
): Promise<void> {
  await client.query(
    `insert into broker_profile (
       org_id, license_state, license_number, license_verified_at, license_expires_at,
       status, credit_tier, max_open_leads, is_auto_accept
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (org_id) do update set
       license_state = excluded.license_state,
       license_number = excluded.license_number,
       license_verified_at = excluded.license_verified_at,
       license_expires_at = excluded.license_expires_at,
       status = excluded.status,
       credit_tier = excluded.credit_tier,
       max_open_leads = excluded.max_open_leads,
       is_auto_accept = excluded.is_auto_accept`,
    [
      input.orgId,
      input.licenseState,
      input.licenseNumber ?? null,
      input.licenseVerifiedAt ?? null,
      input.licenseExpiresAt ?? null,
      input.status ?? 'active',
      input.creditTier ?? 'new',
      input.maxOpenLeads ?? 10,
      input.isAutoAccept ?? false,
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'broker_profile',
    aggregateId: input.orgId,
    eventType: 'broker_profile.upserted',
    payload: {
      license_state: input.licenseState,
      credit_tier: input.creditTier ?? 'new',
      status: input.status ?? 'active',
    },
    actorKind: 'system',
  });
}

export async function setBrokerCoverage(
  client: DbClient,
  input: {
    orgId: string;
    submarketId: string;
    priority?: number;
    isActive?: boolean;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  const { rows } = await client.query<{ id: string }>(
    `insert into broker_coverage (id, org_id, submarket_id, priority, is_active)
     values ($1,$2,$3,$4,$5)
     on conflict (org_id, submarket_id) do update set
       priority = excluded.priority,
       is_active = excluded.is_active
     returning id`,
    [
      id,
      input.orgId,
      input.submarketId,
      input.priority ?? 100,
      input.isActive ?? true,
    ],
  );
  await emitDomainEvent(client, {
    aggregateType: 'broker_coverage',
    aggregateId: rows[0]!.id,
    eventType: 'broker_coverage.upserted',
    payload: {
      org_id: input.orgId,
      submarket_id: input.submarketId,
      priority: input.priority ?? 100,
    },
    actorKind: 'system',
  });
  return { id: rows[0]!.id };
}

export async function ensureBrokerPerformance(
  client: DbClient,
  orgId: string,
): Promise<void> {
  await client.query(
    `insert into broker_performance (org_id) values ($1)
     on conflict (org_id) do nothing`,
    [orgId],
  );
}

/**
 * License gate mechanism (§10.1).
 * D-03: does NOT consult a launch-market state list — only verifies
 * license_verified_at, license_expires_at, and coverage for submarket.
 */
export async function isLicenseEligible(
  client: DbClient,
  input: { orgId: string; submarketId: string; asOf?: Date; clock?: Clock },
): Promise<{ eligible: boolean; reasons: string[] }> {
  const clock = input.clock ?? systemClock;
  const asOf = input.asOf ?? clock.now();
  const reasons: string[] = [];

  const { rows: profile } = await client.query<{
    license_verified_at: Date | null;
    license_expires_at: string | null;
    status: string;
    credit_tier: string;
  }>(
    `select license_verified_at, license_expires_at::text, status, credit_tier
     from broker_profile where org_id = $1`,
    [input.orgId],
  );
  const p = profile[0];
  if (!p) {
    return { eligible: false, reasons: ['missing_broker_profile'] };
  }
  if (p.license_verified_at == null) reasons.push('license_unverified');
  if (p.license_expires_at == null) {
    reasons.push('license_expires_missing');
  } else {
    const exp = new Date(`${p.license_expires_at}T23:59:59.999Z`);
    if (exp < asOf) reasons.push('license_expired');
  }
  if (p.status !== 'active') reasons.push('org_inactive_status');
  if (p.credit_tier === 'suspended') reasons.push('credit_tier_suspended');

  const { rows: cov } = await client.query(
    `select 1 from broker_coverage
     where org_id = $1 and submarket_id = $2 and is_active = true
     limit 1`,
    [input.orgId, input.submarketId],
  );
  if (cov.length === 0) reasons.push('no_coverage_for_submarket');

  const { rows: org } = await client.query<{ status: string }>(
    `select status from org where id = $1`,
    [input.orgId],
  );
  if (!org[0] || org[0].status !== 'active') reasons.push('org_not_active');

  return { eligible: reasons.length === 0, reasons };
}

export async function suspendBrokerForDispute(
  client: DbClient,
  orgId: string,
): Promise<void> {
  const { rowCount } = await client.query(
    `update broker_profile set credit_tier = 'suspended' where org_id = $1`,
    [orgId],
  );
  if (!rowCount) throw new AppError('broker_profile not found', 'BROKER_NOT_FOUND');
  await client.query(
    `update broker_performance
     set dispute_count = dispute_count + 1, updated_at = now()
     where org_id = $1`,
    [orgId],
  );
  await emitDomainEvent(client, {
    aggregateType: 'broker_profile',
    aggregateId: orgId,
    eventType: 'broker_profile.suspended',
    payload: { reason: 'open_dispute' },
    actorKind: 'system',
  });
}
