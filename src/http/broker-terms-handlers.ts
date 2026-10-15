import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import type { DbPool } from '../db/pool.js';
import {
  DEMO_TERMS_VERSION,
  getBrokerTermsAcceptance,
  recordBrokerTermsAcceptance,
} from '../modules/brokerage/terms.js';
import { requireSession } from './session-auth.js';
import { getClientIp, getUserAgent, readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';

export type BrokerTermsHandlerDeps = { pool: DbPool };

const acceptSchema = z.object({
  terms_version: z.string().min(3).max(64).optional(),
  compensation_cap_ack: z.literal(true),
  non_circumvention_ack: z.literal(true),
  licensing_ack: z.literal(true),
  platform_role_ack: z.literal(true),
});

export async function handleGetBrokerTerms(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerTermsHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const acceptance = await withSystemBypass(deps.pool, (client) =>
      getBrokerTermsAcceptance(client, identity.partyId, DEMO_TERMS_VERSION),
    );
    sendJson(res, 200, {
      terms_version: DEMO_TERMS_VERSION,
      accepted: Boolean(acceptance),
      acceptance,
      provisional: true,
      notice:
        'Provisional business copy — not legally approved. Counsel must review before production.',
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAcceptBrokerTerms(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerTermsHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const body = acceptSchema.parse(await readJsonBody(req));
    const acceptance = await withSystemBypass(deps.pool, (client) =>
      recordBrokerTermsAcceptance(client, {
        partyId: identity.partyId,
        termsVersion: body.terms_version ?? DEMO_TERMS_VERSION,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        compensationCapAck: body.compensation_cap_ack,
        nonCircumventionAck: body.non_circumvention_ack,
        licensingAck: body.licensing_ack,
        platformRoleAck: body.platform_role_ack,
        allowProductionRecord: true,
      }),
    );
    sendJson(res, 201, {
      accepted: true,
      acceptance,
      provisional: true,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'all acknowledgments required' });
      return;
    }
    sendError(res, err);
  }
}
