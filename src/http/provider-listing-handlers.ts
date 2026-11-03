import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { DbPool } from '../db/pool.js';
import { withTenantContext } from '../db/tenant.js';
import {
  activateProviderListingAccessFromWebhook,
  createPropertyListingClaim,
  getActiveProviderAccessPlan,
  orgHasListingLeadAccess,
  verifyPropertyListingClaim,
} from '../modules/provider/listing-access.js';
import { AppError } from '../modules/shared/errors.js';
import { requireSession } from './session-auth.js';
import { readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';

export type ProviderListingHandlerDeps = { pool: DbPool };

async function requireOrgId(pool: DbPool, partyId: string): Promise<string> {
  const { rows } = await pool.query<{ org_id: string }>(
    `select org_id from party_role
     where party_id = $1 and status = 'active' and org_id is not null and revoked_at is null
     order by granted_at asc
     limit 1`,
    [partyId],
  );
  if (!rows[0]?.org_id) {
    throw new AppError('provider organization required', 'org_required', 403);
  }
  return rows[0].org_id;
}

/** Provider starts a claim after receiving a teaser notification. */
export async function handleCreateListingClaim(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ProviderListingHandlerDeps,
): Promise<void> {
  try {
    const body = z
      .object({
        listing_id: z.string().uuid(),
        evidence_summary: z.string().trim().min(8).max(2000),
      })
      .parse(await readJsonBody(req));
    const identity = await requireSession(deps.pool, req);
    const orgId = await requireOrgId(deps.pool, identity.partyId);
    const result = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId, orgId },
      (client) =>
        createPropertyListingClaim(client, {
          listingId: body.listing_id,
          partyId: identity.partyId,
          orgId,
          evidenceSummary: body.evidence_summary,
        }),
    );
    sendJson(res, 201, result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleVerifyListingClaim(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ProviderListingHandlerDeps,
): Promise<void> {
  try {
    const body = z
      .object({
        listing_id: z.string().uuid(),
        claim_token: z.string().min(16),
      })
      .parse(await readJsonBody(req));
    const identity = await requireSession(deps.pool, req);
    const orgId = await requireOrgId(deps.pool, identity.partyId);
    const result = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId, orgId },
      (client) =>
        verifyPropertyListingClaim(client, {
          listingId: body.listing_id,
          claimToken: body.claim_token,
        }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

/** Returns configured provider fee separately from the renter $49 product. */
export async function handleGetProviderAccessPlan(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: ProviderListingHandlerDeps,
): Promise<void> {
  try {
    const plan = await withTenantContext(deps.pool, {}, (client) => getActiveProviderAccessPlan(client));
    sendJson(res, 200, {
      plan: plan
        ? {
            plan_key: 'per_listing_lead_access_v1',
            billing_model: plan.billing_model,
            amount_cents: plan.amount_cents,
            active: true,
          }
        : null,
      note: 'Provider listing fee is separate from the renter $49 application product.',
    });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * Test-mode entitlement activation after verified claim.
 * Live Stripe charges remain blocked inside the module.
 */
export async function handleActivateProviderListingAccessTest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ProviderListingHandlerDeps,
): Promise<void> {
  try {
    const body = z
      .object({
        listing_id: z.string().uuid(),
        payment_intent_id: z.string().min(3).max(200),
      })
      .parse(await readJsonBody(req));
    const identity = await requireSession(deps.pool, req);
    const orgId = await requireOrgId(deps.pool, identity.partyId);
    const result = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId, orgId },
      async (client) => {
        const plan = await getActiveProviderAccessPlan(client);
        if (!plan) {
          throw new AppError(
            'provider listing fee is not configured/active',
            'plan_not_configured',
            409,
          );
        }
        return activateProviderListingAccessFromWebhook(client, {
          orgId,
          listingId: body.listing_id,
          planId: plan.id,
          billingModel: 'per_listing',
          paymentIntentId: body.payment_intent_id,
          stripeMode: 'test',
        });
      },
    );
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleProviderLeadAccessStatus(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ProviderListingHandlerDeps,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const listingId = z.string().uuid().parse(url.searchParams.get('listing_id'));
    const identity = await requireSession(deps.pool, req);
    const orgId = await requireOrgId(deps.pool, identity.partyId);
    const hasAccess = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId, orgId },
      (client) => orgHasListingLeadAccess(client, { orgId, listingId }),
    );
    sendJson(res, 200, { listing_id: listingId, lead_access: hasAccess });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid listing_id' });
      return;
    }
    sendError(res, err);
  }
}
