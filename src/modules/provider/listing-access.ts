import { createHash, randomBytes } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';

export async function createPropertyListingClaim(
  client: DbClient,
  input: {
    listingId: string;
    partyId: string;
    orgId?: string | null;
    evidenceSummary: string;
    ttlHours?: number;
  },
): Promise<{ claim_id: string; claim_token: string; expires_at: string }> {
  if (!input.evidenceSummary.trim()) {
    throw new AppError('claim evidence required', 'claim_evidence_required', 400);
  }
  const token = randomBytes(24).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const hours = input.ttlHours ?? 72;
  const { rows } = await client.query<{ id: string; expires_at: Date }>(
    `insert into property_listing_claim (
       listing_id, party_id, org_id, claim_token_hash, evidence_summary, expires_at
     ) values ($1,$2,$3,$4,$5, now() + ($6::text || ' hours')::interval)
     returning id, expires_at`,
    [
      input.listingId,
      input.partyId,
      input.orgId ?? null,
      tokenHash,
      input.evidenceSummary.trim(),
      String(hours),
    ],
  );
  return {
    claim_id: rows[0]!.id,
    claim_token: token,
    expires_at: rows[0]!.expires_at.toISOString(),
  };
}

export async function verifyPropertyListingClaim(
  client: DbClient,
  input: { claimToken: string; listingId: string },
): Promise<{ verified: boolean; claim_id: string }> {
  const tokenHash = createHash('sha256').update(input.claimToken).digest('hex');
  const { rows } = await client.query<{ id: string; status: string; expires_at: Date }>(
    `select id, status, expires_at
     from property_listing_claim
     where claim_token_hash = $1 and listing_id = $2`,
    [tokenHash, input.listingId],
  );
  const claim = rows[0];
  if (!claim) throw new AppError('claim not found', 'claim_not_found', 404);
  if (claim.expires_at.getTime() < Date.now()) {
    await client.query(`update property_listing_claim set status = 'expired' where id = $1`, [
      claim.id,
    ]);
    throw new AppError('claim expired', 'claim_expired', 410);
  }
  if (claim.status === 'verified') return { verified: true, claim_id: claim.id };
  if (claim.status !== 'pending') {
    throw new AppError('claim not verifiable', 'claim_invalid', 409);
  }
  await client.query(
    `update property_listing_claim
     set status = 'verified', verified_at = now()
     where id = $1`,
    [claim.id],
  );
  return { verified: true, claim_id: claim.id };
}

export async function getActiveProviderAccessPlan(
  client: DbClient,
  planKey = 'per_listing_lead_access_v1',
): Promise<{ id: string; amount_cents: number; billing_model: string } | null> {
  const { rows } = await client.query<{
    id: string;
    amount_cents: number;
    billing_model: string;
    active: boolean;
  }>(
    `select id, amount_cents, billing_model, active
     from provider_access_plan
     where plan_key = $1`,
    [planKey],
  );
  const plan = rows[0];
  if (!plan || !plan.active || plan.amount_cents <= 0) return null;
  return plan;
}

/**
 * Entitlement is server-side only. A checkout success URL alone never unlocks access.
 * Live Stripe charges are not created here.
 */
export async function activateProviderListingAccessFromWebhook(
  client: DbClient,
  input: {
    orgId: string;
    listingId: string;
    planId: string;
    billingModel: 'per_listing' | 'monthly_subscription';
    paymentIntentId: string;
    stripeMode: 'test' | 'live';
  },
): Promise<{ entitlement_status: string }> {
  if (input.stripeMode === 'live') {
    throw new AppError('live provider charges are not authorized', 'live_charge_blocked', 403);
  }
  const plan = await client.query<{ id: string; active: boolean; amount_cents: number }>(
    `select id, active, amount_cents from provider_access_plan where id = $1`,
    [input.planId],
  );
  if (!plan.rows[0]?.active || plan.rows[0].amount_cents <= 0) {
    throw new AppError('provider access plan is not configured', 'plan_not_configured', 409);
  }

  const claim = await client.query<{ id: string }>(
    `select id from property_listing_claim
     where listing_id = $1 and org_id = $2 and status = 'verified'
     order by verified_at desc nulls last
     limit 1`,
    [input.listingId, input.orgId],
  );
  if (!claim.rows[0]) {
    throw new AppError('verified property claim required', 'claim_required', 403);
  }

  const { rows } = await client.query<{ entitlement_status: string }>(
    `insert into provider_listing_access (
       org_id, listing_id, plan_id, billing_model, stripe_mode,
       stripe_payment_intent_id, entitlement_status, period_start
     ) values ($1,$2,$3,$4,'test',$5,'active', now())
     on conflict (org_id, listing_id, billing_model) do update set
       entitlement_status = 'active',
       stripe_payment_intent_id = excluded.stripe_payment_intent_id,
       updated_at = now()
     returning entitlement_status`,
    [
      input.orgId,
      input.listingId,
      input.planId,
      input.billingModel,
      input.paymentIntentId,
    ],
  );
  return { entitlement_status: rows[0]!.entitlement_status };
}

export async function orgHasListingLeadAccess(
  client: DbClient,
  input: { orgId: string; listingId: string },
): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(
    `select true as ok
     from provider_listing_access
     where org_id = $1
       and listing_id = $2
       and entitlement_status = 'active'
     limit 1`,
    [input.orgId, input.listingId],
  );
  return Boolean(rows[0]?.ok);
}
