import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import type { DbPool } from '../db/pool.js';
import { getKmsProvider } from '../infra/crypto/kms.js';
import { isEmailDeliveryEnabled } from '../infra/email/transport.js';
import { sendEmailCodeEmail } from '../infra/email/ses.js';
import { createLogger } from '../infra/logging/logger.js';
import {
  issueEmailCode,
  issueMagicToken,
  platformEmailHmac,
  redeemMagicToken,
  revokeSession,
  verifyEmailCode,
} from '../modules/auth/index.js';
import { assertAuthEmailAllowed } from '../modules/auth/email-allowlist.js';
import { pickOrgForRole } from '../modules/auth/session.js';
import { AppError } from '../modules/shared/errors.js';
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
  rememberDevice: z.boolean().optional(),
});

const AUTH_NO_STORE = { 'Cache-Control': 'private, no-store' };
const logger = createLogger();

function safeInet(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return ip;
  if (/^[0-9a-fA-F:]+$/.test(ip)) return ip;
  return null;
}

function shouldReturnRedeemToken(): boolean {
  return process.env.NODE_ENV === 'dev' || process.env.AUTH_RETURN_REDEEM_TOKEN === '1';
}

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
    sendJson(res, 200, payload, AUTH_NO_STORE);
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
        remember: body.rememberDevice === true,
      }),
    );

    const maxAge = Math.max(
      1,
      Math.floor((redeemed.absoluteExpiresAt.getTime() - Date.now()) / 1000),
    );
    res.setHeader('Set-Cookie', sessionCookieHeader(redeemed.credential, maxAge));
    sendJson(res, 200, {
      session_id: redeemed.sessionId,
      party_id: redeemed.partyId,
    }, AUTH_NO_STORE);
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
    }, AUTH_NO_STORE);
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
    sendJson(res, 200, { ok: true }, AUTH_NO_STORE);
  } catch (err) {
    res.setHeader('Set-Cookie', clearSessionCookieHeader());
    sendError(res, err);
  }
}

const codeIssueSchema = z.object({
  email: z.string().email().max(320),
  purpose: z.enum(['sign_in', 'landlord_sign_in', 'broker_sign_in']).default('sign_in'),
  rememberDevice: z.boolean().optional(),
});

const codeVerifySchema = z.object({
  email: z.string().email().max(320),
  code: z.string().min(6).max(12),
  purpose: z.enum(['sign_in', 'landlord_sign_in', 'broker_sign_in']).default('sign_in'),
  rememberDevice: z.boolean().optional(),
});

export async function handleAuthEmailCode(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthHandlerDeps,
): Promise<void> {
  try {
    const body = codeIssueSchema.parse(await readJsonBody(req));
    assertAuthEmailAllowed(body.email);
    const issued = await withSystemBypass(deps.pool, (client) =>
      issueEmailCode(client, getKmsProvider(), {
        email: body.email,
        purpose: body.purpose,
        ip: safeInet(getClientIp(req)),
        remember: body.rememberDevice === true,
      }),
    );
    if (issued.delivered && issued.code && isEmailDeliveryEnabled()) {
      try {
        await sendEmailCodeEmail(body.email, issued.code, issued.expiresInSeconds);
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 200) : 'send failed';
        logger.error({ err_message: message }, 'email code send failed');
        await withSystemBypass(deps.pool, (client) =>
          client.query(
            `update auth_email_challenge
             set superseded_at = now()
             where email_hmac = $1 and consumed_at is null and superseded_at is null`,
            [platformEmailHmac(body.email)],
          ),
        );
        throw new AppError(
          "We couldn't send the sign-in email. Please try again.",
          'email_code_send_failed',
          502,
        );
      }
    }
    const payload: Record<string, unknown> = {
      ok: true,
      delivered: issued.delivered && isEmailDeliveryEnabled(),
      message: 'If that email can receive messages from us, a verification code is on the way.',
      retryAfterSeconds: issued.retryAfterSeconds,
      expiresInSeconds: issued.expiresInSeconds,
    };
    if (issued.code && shouldReturnRedeemToken() && !isEmailDeliveryEnabled()) {
      payload.debug_code = issued.code;
    }
    sendJson(res, 200, payload, AUTH_NO_STORE);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'Enter a valid email address.' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleAuthEmailCodeVerify(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthHandlerDeps,
): Promise<void> {
  try {
    const body = codeVerifySchema.parse(await readJsonBody(req));
    const verified = await withSystemBypass(deps.pool, (client) =>
      verifyEmailCode(client, {
        email: body.email,
        code: body.code.replace(/\D/g, ''),
        purpose: body.purpose,
        remember: body.rememberDevice,
      }),
    );
    const maxAge = Math.max(
      1,
      Math.floor((verified.absoluteExpiresAt.getTime() - Date.now()) / 1000),
    );
    res.setHeader('Set-Cookie', sessionCookieHeader(verified.credential, maxAge));
    sendJson(
      res,
      200,
      {
        ok: true,
        authenticated: true,
        party_id: verified.partyId,
        session_id: verified.sessionId,
      },
      AUTH_NO_STORE,
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'Enter the 6-digit code.' });
      return;
    }
    sendError(res, err);
  }
}
