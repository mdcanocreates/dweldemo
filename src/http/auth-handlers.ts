import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import type { DbPool } from '../db/pool.js';
import { getKmsProvider } from '../infra/crypto/kms.js';
import {
  issueMagicToken,
  redeemMagicToken,
  revokeSession,
} from '../modules/auth/index.js';
import { pickOrgForRole } from '../modules/auth/session.js';
import { getClientIp, readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';
import {
  clearSessionCookieHeader,
  requireSession,
  sessionCookieHeader,
} from './session-auth.js';

const issueSchema = z.object({
  email: z.string().email().max(320),
  purpose: z.enum(['sign_in', 'landlord_sign_in', 'broker_sign_in']).default('sign_in'),
});

const redeemSchema = z.object({
  token: z.string().min(10).max(200),
  purpose: z.enum(['sign_in', 'landlord_sign_in', 'broker_sign_in']).default('sign_in'),
});

export type AuthHandlerDeps = {
  pool: DbPool;
};

export async function handleAuthMagicLink(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthHandlerDeps,
): Promise<void> {
  try {
    const body = issueSchema.parse(await readJsonBody(req));
    const result = await withSystemBypass(deps.pool, (client) =>
      issueMagicToken(client, getKmsProvider(), {
        email: body.email,
        purpose: body.purpose,
        ip: getClientIp(req),
        createPartyIfMissing: true,
        // DEV / unset email delivery: return one-time redeem token so sign-in works
        // without inventing fake sessions. Never logged.
        returnTokenForTest:
          process.env.NODE_ENV === 'dev' || process.env.AUTH_RETURN_REDEEM_TOKEN === '1',
      }),
    );

    const payload: Record<string, unknown> = {
      ok: true,
      message: 'If an account can be created for this email, a sign-in link is ready.',
    };
    if (result.debugToken) {
      payload.redeem_token = result.debugToken;
    }
    sendJson(res, 200, payload);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleAuthRedeem(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthHandlerDeps,
): Promise<void> {
  try {
    const body = redeemSchema.parse(await readJsonBody(req));
    const redeemed = await withSystemBypass(deps.pool, (client) =>
      redeemMagicToken(client, {
        token: body.token,
        purpose: body.purpose,
      }),
    );

    res.setHeader('Set-Cookie', sessionCookieHeader(redeemed.sessionId, 60 * 60 * 24 * 30));
    sendJson(res, 200, {
      session_id: redeemed.sessionId,
      party_id: redeemed.partyId,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleAuthMe(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const landlord = pickOrgForRole(identity, ['landlord']);
    const broker = pickOrgForRole(identity, ['broker', 'broker_admin', 'agent']);
    sendJson(res, 200, {
      party_id: identity.partyId,
      session_id: identity.sessionId,
      roles: identity.roles.map((r) => ({ role: r.role, org_id: r.orgId })),
      landlord_org_id: landlord?.orgId ?? null,
      broker_org_id: broker?.orgId ?? null,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAuthLogout(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    await withSystemBypass(deps.pool, (client) => revokeSession(client, identity.sessionId));
    res.setHeader('Set-Cookie', clearSessionCookieHeader());
    sendJson(res, 200, { ok: true });
  } catch (err) {
    res.setHeader('Set-Cookie', clearSessionCookieHeader());
    sendError(res, err);
  }
}
