import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withTenantContext } from '../db/tenant.js';
import type { DbPool } from '../db/pool.js';
import { pickOrgForRole } from '../modules/auth/session.js';
import {
  createOrgConnectAccount,
  createOrgDashboardLink,
  createOrgOnboardingLink,
  getOrgConnectStatus,
} from '../modules/payments/index.js';
import { AppError } from '../modules/shared/errors.js';
import { requireSession } from './session-auth.js';
import { readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';

export type ConnectHandlerDeps = {
  pool: DbPool;
};

const linkSchema = z.object({
  refresh_url: z.string().url().optional(),
  return_url: z.string().url().optional(),
});

function publicAppOrigin(req: IncomingMessage): string {
  const fromEnv = process.env.PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https';
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  if (host) return `${proto}://${host}`;
  return 'https://d1j0s2h5mond9a.cloudfront.net';
}

async function requireConnectOrg(
  pool: DbPool,
  req: IncomingMessage,
): Promise<{ identity: Awaited<ReturnType<typeof requireSession>>; orgId: string; role: string }> {
  const identity = await requireSession(pool, req);
  const broker = pickOrgForRole(identity, ['broker', 'broker_admin', 'agent']);
  if (broker) return { identity, orgId: broker.orgId, role: broker.role };
  const landlord = pickOrgForRole(identity, ['landlord']);
  if (landlord) return { identity, orgId: landlord.orgId, role: landlord.role };
  throw new AppError(
    'broker or landlord role required for Connect',
    'auth_forbidden',
    403,
  );
}

export async function handleConnectGetAccount(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ConnectHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireConnectOrg(deps.pool, req);
    const status = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) => getOrgConnectStatus(client, orgId),
    );
    sendJson(res, 200, status);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleConnectCreateAccount(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ConnectHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireConnectOrg(deps.pool, req);
    const status = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        createOrgConnectAccount(client, {
          orgId,
          actorPartyId: identity.partyId,
        }),
    );
    sendJson(res, 201, status);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleConnectOnboardingLink(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ConnectHandlerDeps,
): Promise<void> {
  try {
    const body = linkSchema.parse((await readJsonBody(req).catch(() => ({}))) ?? {});
    const { identity, orgId, role } = await requireConnectOrg(deps.pool, req);
    const origin = publicAppOrigin(req);
    const isLandlord = role === 'landlord';
    const path = isLandlord ? '/#/landlord/settings/payments' : '/#/broker/settings/payments';
    const refreshUrl = body.refresh_url ?? `${origin}${path}?connect=refresh`;
    const returnUrl = body.return_url ?? `${origin}${path}?connect=return`;

    const link = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      async (client) => {
        await createOrgConnectAccount(client, {
          orgId,
          actorPartyId: identity.partyId,
        });
        return createOrgOnboardingLink(client, {
          orgId,
          refreshUrl,
          returnUrl,
        });
      },
    );
    sendJson(res, 200, link);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleConnectDashboardLink(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ConnectHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireConnectOrg(deps.pool, req);
    const link = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) => createOrgDashboardLink(client, orgId),
    );
    sendJson(res, 200, link);
  } catch (err) {
    sendError(res, err);
  }
}
