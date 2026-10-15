import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import { withTenantContext } from '../db/tenant.js';
import type { DbPool } from '../db/pool.js';
import { issueApplicationAccessToken } from '../modules/auth/index.js';
import {
  checkApplicationCreationRateLimit,
  createPublicApplication,
  getApplicationStatusSafe,
  submitScreeningForApplication,
} from '../modules/applications/index.js';
import { getPublicListingById, listPublicListings } from '../modules/listings/index.js';
import {
  assertPublicApiAllowed,
  type PublicRequestContext,
} from '../modules/public-api/index.js';
import {
  ingestCertnWebhook,
  processCertnWebhookEvent,
  registerWebhookWorker,
} from '../modules/screening/index.js';
import { AppError } from '../modules/shared/errors.js';
import { assessCertnAvailability } from '../modules/vendors/index.js';
import { createLogger } from '../infra/logging/logger.js';
import { requireApplicationAccess } from './application-auth.js';
import { getClientIp, getUserAgent, parseQuery, readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';

const logger = createLogger();

const createApplicationSchema = z.object({
  listing_id: z.string().uuid(),
  device_id: z.string().max(256).optional(),
});

const submitScreeningSchema = z.object({
  stated_monthly_income_cents: z.number().int().positive().optional(),
  device_id: z.string().max(256).optional(),
});

const appMutationBuckets = new Map<string, number[]>();
const MAX_APP_MUTATIONS_PER_HOUR = 30;

export function resetApplicationRouteRateLimits(): void {
  appMutationBuckets.clear();
}

function checkAppRouteRateLimit(key: string): void {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const arr = (appMutationBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= MAX_APP_MUTATIONS_PER_HOUR) {
    throw new AppError('rate limit exceeded', 'application_route_rate_limited', 429);
  }
  arr.push(now);
  appMutationBuckets.set(key, arr);
}

export type HttpHandlerDeps = {
  pool: DbPool;
  certnWebhookSecret?: string | null;
  checkrWebhookSecret?: string | null;
};

function publicContext(req: IncomingMessage): PublicRequestContext {
  return {
    ip: getClientIp(req),
    userAgent: getUserAgent(req),
    fingerprint: req.headers['x-client-fingerprint']?.toString() ?? null,
  };
}

export async function handleListListings(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  try {
    const query = parseQuery(req.url ?? '');
    const limit = Number(query.get('limit') ?? '20');
    const offset = Number(query.get('offset') ?? '0');
    // Public active listing policy — no bypass. Rate-limit config may need bypass
    // only for config_version read if RLS blocks; scraping_policy is GLOBAL via config.
    const result = await withSystemBypass(deps.pool, async (client) => {
      await assertPublicApiAllowed(client, publicContext(req));
      // Listing rows themselves are readable under listing_public_active_read once
      // we drop bypass for the data query — keep protection assert under bypass
      // for config, then re-query listings without bypass.
      return null;
    });
    void result;
    const listings = await withTenantContext(deps.pool, {}, async (client) =>
      listPublicListings(client, { limit, offset }),
    );
    sendJson(res, 200, {
      listings: listings.listings,
      pagination: { total: listings.total, limit, offset },
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleGetListing(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
  listingId: string,
): Promise<void> {
  try {
    await withSystemBypass(deps.pool, async (client) => {
      await assertPublicApiAllowed(client, publicContext(req));
    });
    const listing = await withTenantContext(deps.pool, {}, async (client) =>
      getPublicListingById(client, listingId),
    );
    sendJson(res, 200, { listing });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleCreateApplication(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  try {
    const ip = getClientIp(req);
    const body = createApplicationSchema.parse(await readJsonBody(req));
    checkApplicationCreationRateLimit({ ip, listingId: body.listing_id });

    // Resolve listing org under public-read policy, then create under that tenant context.
    const listingOrg = await withTenantContext(deps.pool, {}, async (client) => {
      const { rows } = await client.query<{ org_id: string; status: string }>(
        `select org_id, status from listing where id = $1`,
        [body.listing_id],
      );
      const row = rows[0];
      if (!row) throw new AppError('listing not found', 'listing_not_found', 404);
      if (row.status !== 'active') {
        throw new AppError('listing not available', 'listing_not_available', 409);
      }
      return row.org_id;
    });

    const created = await withTenantContext(
      deps.pool,
      { orgId: listingOrg },
      async (client) => {
        // party/renter_profile are global; application insert needs org context.
        // After party insert, set party on context for token RLS.
        const app = await createPublicApplication(client, {
          listingId: body.listing_id,
          deviceId: body.device_id ?? null,
          ip,
        });
        // Re-bind party for token insert RLS (join application.party_id)
        await client.query(`select set_config('rbit.current_party_id', $1, true)`, [
          (
            await client.query<{ party_id: string }>(
              `select party_id from application where id = $1`,
              [app.applicationId],
            )
          ).rows[0]!.party_id,
        ]);
        const token = await issueApplicationAccessToken(client, {
          applicationId: app.applicationId,
          ip,
        });
        return { app, token };
      },
    );

    sendJson(res, 201, {
      application_id: created.app.applicationId,
      listing_id: created.app.listingId,
      status: created.app.status,
      access_token: created.token.token,
      access_token_expires_at: created.token.expiresAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleGetApplication(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const ip = getClientIp(req);
    checkAppRouteRateLimit(`get:${ip}:${applicationId}`);

    // Token lookup needs hash match before tenant context — brief bypass for auth only.
    const auth = await withSystemBypass(deps.pool, (client) =>
      requireApplicationAccess(client, req, applicationId),
    );

    const status = await withTenantContext(
      deps.pool,
      { orgId: auth.orgId, partyId: auth.partyId },
      (client) => getApplicationStatusSafe(client, applicationId),
    );
    sendJson(res, 200, status);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleRecordConsent(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    // G-4 atomicity: free consent is forbidden. Payment + consent only via pay-consent.
    await readJsonBody(req).catch(() => ({}));
    void applicationId;
    void deps;
    sendJson(res, 402, {
      error: 'payment_required',
      message:
        'consent cannot be recorded without payment — use POST /v1/applications/{id}/pay-consent',
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleSubmitScreening(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const ip = getClientIp(req);
    checkAppRouteRateLimit(`submit:${ip}:${applicationId}`);
    const body = submitScreeningSchema.parse(await readJsonBody(req));

    // Fail closed BEFORE any auth-gated domain work that could advance state.
    // Distinguish config-missing from vendor timeouts/rejections in telemetry.
    const certn = assessCertnAvailability();
    if (!certn.available) {
      logger.warn(
        {
          event: 'screening_provider_unavailable',
          reason: certn.reason,
          application_id: applicationId,
          outcome: 'no_state_transition',
        },
        'submit-screening blocked: Certn not configured',
      );
      sendJson(res, 503, {
        error: 'SCREENING_PROVIDER_UNAVAILABLE',
        message: 'screening provider not configured',
      });
      return;
    }

    const auth = await withSystemBypass(deps.pool, (client) =>
      requireApplicationAccess(client, req, applicationId),
    );

    const result = await withTenantContext(
      deps.pool,
      { orgId: auth.orgId, partyId: auth.partyId },
      (client) =>
        submitScreeningForApplication(client, {
          applicationId,
          statedMonthlyIncomeCents: body.stated_monthly_income_cents ?? null,
          deviceId: body.device_id ?? null,
        }),
    );

    sendJson(res, 202, {
      application_id: result.applicationId,
      status: result.status,
      screening_order_id: result.orderId,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    if (err instanceof AppError && err.code === 'SCREENING_PROVIDER_UNAVAILABLE') {
      logger.warn(
        {
          event: 'screening_provider_unavailable',
          reason: 'adapter_unavailable',
          application_id: applicationId,
          outcome: 'no_state_transition',
        },
        'submit-screening blocked by unavailable adapter',
      );
      sendJson(res, 503, {
        error: 'SCREENING_PROVIDER_UNAVAILABLE',
        message: 'screening provider not configured',
      });
      return;
    }
    // Genuine vendor/runtime failures keep their codes (e.g. certn_unavailable, certn_order_failed).
    sendError(res, err);
  }
}

export async function handleCertnWebhookGet(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const query = parseQuery(req.url ?? '');
  const challenge = query.get('challenge');
  if (!challenge) {
    sendJson(res, 400, { error: 'missing_challenge' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(challenge);
}

export async function handleCertnWebhookPost(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > 256 * 1024) {
        sendJson(res, 413, { error: 'payload_too_large' });
        return;
      }
      chunks.push(buf);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const signature =
      (req.headers['x-signature'] as string | undefined) ??
      (req.headers['certn-signature'] as string | undefined) ??
      null;

    const secret = deps.certnWebhookSecret ?? process.env.CERTN_WEBHOOK_SECRET ?? '';
    if (!secret) {
      sendJson(res, 503, { error: 'webhook_secret_not_configured' });
      return;
    }

    const ingested = await withSystemBypass(deps.pool, async (client) => {
      const result = await ingestCertnWebhook(client, {
        rawBody,
        signature,
        signingSecret: secret,
      });
      if (result.accepted && !result.duplicate) {
        // Process inline for single-task ECS (queue may be in-memory).
        await processCertnWebhookEvent(client, result.webhookEventId);
      }
      return result;
    });

    if (!ingested.accepted) {
      sendJson(res, 401, { error: 'invalid_signature' });
      return;
    }
    sendJson(res, 200, { ok: true, duplicate: ingested.duplicate });
  } catch (err) {
    sendError(res, err);
  }
}

/** Ensure webhook worker is registered once at boot. */
let webhookWorkerStarted = false;
export function ensureWebhookWorker(pool: DbPool): void {
  if (webhookWorkerStarted) return;
  webhookWorkerStarted = true;
  registerWebhookWorker(async (webhookEventId) => {
    await withSystemBypass(pool, (client) => processCertnWebhookEvent(client, webhookEventId));
  });
}
