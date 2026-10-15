import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withTenantContext } from '../db/tenant.js';
import type { DbPool } from '../db/pool.js';
import { pickOrgForRole } from '../modules/auth/session.js';
import {
  ReplicaQueryClient,
  ensureBrokerPerformance,
  getBrokerBalanceCents,
  getBrokerPerformance,
  getBrokerPerformanceLeads,
  getBrokerPerformanceSubmarkets,
} from '../modules/brokerage/index.js';
import {
  getBrokerPortfolioOverview,
  getManagedProviderDetail,
  listManagedApplicants,
  listManagedListings,
  listManagedProviders,
} from '../modules/brokerage/portfolio.js';
import {
  brokerAddNote,
  brokerRequestScreening,
  brokerSetRecommendation,
  getBrokerApplicationDetail,
} from '../modules/brokerage/broker-actions.js';
import {
  cancelBrokerInvitation,
  createBrokerInvitation,
  listBrokerInvitations,
} from '../modules/brokerage/invitations.js';
import { revokeBrokerDelegation } from '../modules/brokerage/delegation.js';
import { getOrgConnectStatus } from '../modules/payments/index.js';
import { AppError } from '../modules/shared/errors.js';
import { resolveActivePreviewContext } from './preview-context.js';
import { requireSession } from './session-auth.js';
import { sendError, sendJson } from './response.js';
import { readJsonBody } from './request.js';

export type BrokerHandlerDeps = {
  pool: DbPool;
};

const noteSchema = z.object({
  note: z.string().min(1).max(2000),
});

const recommendationSchema = z.object({
  recommendation: z.enum(['approve', 'decline']).nullable(),
});

function parseQuery(url: string | undefined): URLSearchParams {
  const q = url?.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  return new URLSearchParams(q);
}

async function requireBrokerOrg(pool: DbPool, req: IncomingMessage) {
  const identity = await requireSession(pool, req);

  // Preview overlay: allowlisted inspector uses Fake Horizon without party_role mutation.
  const preview = await resolveActivePreviewContext(pool, req);
  if (preview?.role === 'broker' && preview.previewOrgId) {
    return {
      identity,
      orgId: preview.previewOrgId,
      role: 'broker_admin',
      preview: true as const,
    };
  }

  const broker = pickOrgForRole(identity, ['broker', 'broker_admin', 'agent']);
  if (!broker) {
    throw new AppError('broker role required for this organization', 'auth_forbidden', 403);
  }
  return { identity, orgId: broker.orgId, role: broker.role, preview: false as const };
}

export async function handleBrokerOverview(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const { balanceCents, connect } = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      async (client) => {
        const balance = await getBrokerBalanceCents(client, orgId);
        const status = await getOrgConnectStatus(client, orgId);
        return { balanceCents: balance, connect: status };
      },
    );

    const payoutsEnabled = connect.broker_payouts_enabled && connect.status === 'active';
    sendJson(res, 200, {
      broker_org_id: orgId,
      balance_cents: balanceCents,
      broker_payouts_enabled: connect.broker_payouts_enabled,
      funding: { available: false, reason: 'bor_licensing_unresolved' },
      lead_purchase: { available: false, reason: 'bor_licensing_unresolved' },
      payouts: {
        available: payoutsEnabled,
        reason: payoutsEnabled
          ? 'ok'
          : !connect.broker_payouts_enabled
            ? 'broker_payouts_disabled'
            : connect.status === 'none'
              ? 'connect_not_linked'
              : `connect_${connect.status}`,
      },
      connect: {
        status: connect.status,
        account_id: connect.account_id,
      },
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBrokerPerformance(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const q = parseQuery(req.url);
    const windowRaw = Number(q.get('window_days') ?? '90');
    const windowDays = ([30, 60, 90] as const).includes(windowRaw as 30 | 60 | 90)
      ? (windowRaw as 30 | 60 | 90)
      : null;
    if (!windowDays) {
      sendJson(res, 400, { error: 'validation_error', message: 'window_days must be 30|60|90' });
      return;
    }

    const performance = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      async (client) => {
        await ensureBrokerPerformance(client, orgId);
        const replica = new ReplicaQueryClient(client);
        return getBrokerPerformance(replica, client, {
          partyId: identity.partyId,
          orgId,
          windowDays,
        });
      },
    );
    sendJson(res, 200, performance);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBrokerLeads(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const q = parseQuery(req.url);
    const page = Math.max(1, Number(q.get('page') ?? '1') || 1);
    const limit = 25;
    const offset = (page - 1) * limit;
    const status = q.get('status');
    const fromRaw = q.get('from');
    const toRaw = q.get('to');

    const result = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      async (client) => {
        const replica = new ReplicaQueryClient(client);
        return getBrokerPerformanceLeads(replica, client, {
          partyId: identity.partyId,
          orgId,
          status: status || null,
          from: fromRaw ? new Date(fromRaw) : null,
          to: toRaw ? new Date(toRaw) : null,
          limit,
          offset,
        });
      },
    );

    sendJson(res, 200, {
      items: result.items,
      total: result.total,
      page,
      page_size: limit,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBrokerSubmarkets(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const q = parseQuery(req.url);
    const windowRaw = Number(q.get('window_days') ?? '90');
    const windowDays = ([30, 60, 90] as const).includes(windowRaw as 30 | 60 | 90)
      ? (windowRaw as 30 | 60 | 90)
      : 90;

    const submarkets = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      async (client) => {
        const replica = new ReplicaQueryClient(client);
        return getBrokerPerformanceSubmarkets(replica, client, {
          partyId: identity.partyId,
          orgId,
          windowDays,
        });
      },
    );
    sendJson(res, 200, { window_days: windowDays, submarkets });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBrokerPortfolioOverview(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const overview = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) => getBrokerPortfolioOverview(client, orgId),
    );
    sendJson(res, 200, overview);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBrokerProviders(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const providers = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) => listManagedProviders(client, orgId),
    );
    sendJson(res, 200, { providers });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBrokerProviderDetail(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
  providerOrgId: string,
): Promise<void> {
  try {
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const data = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      async (client) => {
        const provider = await getManagedProviderDetail(client, orgId, providerOrgId);
        const listings = await listManagedListings(client, orgId, providerOrgId);
        const applicants = await listManagedApplicants(client, orgId, providerOrgId);
        return { provider, listings, applicants };
      },
    );
    sendJson(res, 200, data);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBrokerPortfolioListings(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const q = parseQuery(req.url);
    const providerOrgId = q.get('provider_org_id');
    const listings = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) => listManagedListings(client, orgId, providerOrgId),
    );
    sendJson(res, 200, { listings });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBrokerPortfolioApplicants(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const q = parseQuery(req.url);
    const providerOrgId = q.get('provider_org_id');
    const applicants = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) => listManagedApplicants(client, orgId, providerOrgId),
    );
    sendJson(res, 200, { applicants });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBrokerApplicationDetail(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const detail = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) => getBrokerApplicationDetail(client, orgId, applicationId),
    );
    sendJson(res, 200, detail);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBrokerRequestScreening(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const { identity, orgId, preview } = await requireBrokerOrg(deps.pool, req);
    const result = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        brokerRequestScreening(client, {
          brokerOrgId: orgId,
          applicationId,
          actorPartyId: identity.partyId,
          preview,
        }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBrokerAddNote(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const body = noteSchema.parse(await readJsonBody(req));
    const { identity, orgId, preview } = await requireBrokerOrg(deps.pool, req);
    const result = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        brokerAddNote(client, {
          brokerOrgId: orgId,
          applicationId,
          actorPartyId: identity.partyId,
          note: body.note,
          preview,
        }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid note' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleBrokerSetRecommendation(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const body = recommendationSchema.parse(await readJsonBody(req));
    const { identity, orgId, preview } = await requireBrokerOrg(deps.pool, req);
    const result = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        brokerSetRecommendation(client, {
          brokerOrgId: orgId,
          applicationId,
          actorPartyId: identity.partyId,
          recommendation: body.recommendation,
          preview,
        }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid recommendation' });
      return;
    }
    sendError(res, err);
  }
}

const invitationSchema = z.object({
  contact_email: z.string().email().max(320),
  business_name: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
  expires_at: z.string().datetime({ offset: true }).optional(),
});

export async function handleBrokerListInvitations(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const invitations = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) => listBrokerInvitations(client, orgId),
    );
    sendJson(res, 200, { invitations });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBrokerCreateInvitation(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
): Promise<void> {
  try {
    const body = invitationSchema.parse(await readJsonBody(req));
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const invitation = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        createBrokerInvitation(client, {
          brokerOrgId: orgId,
          actorPartyId: identity.partyId,
          contactEmail: body.contact_email,
          businessName: body.business_name,
          note: body.note,
          expiresAt: body.expires_at,
        }),
    );
    sendJson(res, 201, invitation);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleBrokerCancelInvitation(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
  invitationId: string,
): Promise<void> {
  try {
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const invitation = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        cancelBrokerInvitation(client, {
          brokerOrgId: orgId,
          invitationId,
          actorPartyId: identity.partyId,
        }),
    );
    sendJson(res, 200, invitation);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleBrokerRevokeDelegation(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BrokerHandlerDeps,
  providerOrgId: string,
): Promise<void> {
  try {
    const { identity, orgId } = await requireBrokerOrg(deps.pool, req);
    const delegation = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        revokeBrokerDelegation(client, {
          brokerOrgId: orgId,
          providerOrgId,
          actorPartyId: identity.partyId,
        }),
    );
    sendJson(res, 200, { delegation });
  } catch (err) {
    sendError(res, err);
  }
}
