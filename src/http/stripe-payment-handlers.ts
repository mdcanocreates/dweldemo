import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import { withTenantContext } from '../db/tenant.js';
import type { HttpHandlerDeps } from './handlers.js';
import { requireSession } from './session-auth.js';
import { readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';
import { getRenterProfile } from '../modules/renter/index.js';
import { AppError } from '../modules/shared/errors.js';
import { readStripePaymentMode } from '../modules/payments/stripe-mode.js';
import {
  constructStripeEvent,
  createSandboxPaymentIntent,
  publicStripeConfig,
  recordSandboxWebhook,
  type SandboxPurpose,
} from '../modules/payments/stripe-sandbox.js';

const purposeSchema = z.enum(['applicant_screening_fee', 'ny_path2_screening']);

export async function handleStripePaymentConfig(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const config = publicStripeConfig();
  sendJson(res, config.invalid ? 503 : 200, {
    mode: config.mode,
    sandbox: config.sandbox,
    publishable_key: config.publishableKey,
    error: config.invalid ? 'stripe_mode_invalid' : undefined,
  });
}

export async function handleCreateSandboxPaymentIntent(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  try {
    const body = z
      .object({
        purpose: purposeSchema,
        application_id: z.string().uuid().optional(),
      })
      .parse(await readJsonBody(req));
    if (body.purpose === 'applicant_screening_fee' && !body.application_id) {
      throw new AppError('application_id is required', 'validation_error', 400);
    }
    const identity = await requireSession(deps.pool, req);
    const created = await withTenantContext(deps.pool, { partyId: identity.partyId }, async (client) => {
      if (body.application_id) {
        const owned = await client.query(
          `select id from application where id = $1 and party_id = $2`,
          [body.application_id, identity.partyId],
        );
        if (!owned.rows[0]) throw new AppError('forbidden', 'auth_forbidden', 403);
      }
      const profile = await getRenterProfile(client, identity.partyId);
      return createSandboxPaymentIntent(client, {
        partyId: identity.partyId,
        purpose: body.purpose as SandboxPurpose,
        applicationId: body.application_id ?? null,
        state: profile?.preferred_state ?? null,
      });
    });
    sendJson(res, 201, {
      payment_intent_id: created.paymentIntentId,
      client_secret: created.clientSecret,
      amount_cents: created.amountCents,
      sandbox: true,
      mode: 'test',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleStripeWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  const decision = readStripePaymentMode();
  if (decision.invalid || decision.mode !== 'test') {
    sendJson(res, 503, { error: decision.invalid ? 'stripe_mode_invalid' : 'stripe_webhook_disabled' });
    return;
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '';
  if (!secret) {
    sendJson(res, 503, { error: 'webhook_secret_not_configured' });
    return;
  }
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
  const signature = typeof req.headers['stripe-signature'] === 'string' ? req.headers['stripe-signature'] : '';
  try {
    const event = constructStripeEvent(rawBody, signature, secret);
    const result = await withSystemBypass(deps.pool, (client) => recordSandboxWebhook(client, event));
    sendJson(res, 200, { received: true, duplicate: result.duplicate, disposition: result.disposition });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.toLowerCase().includes('signature')) {
      sendJson(res, 400, { error: 'invalid_signature' });
      return;
    }
    sendError(res, err);
  }
}
