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
import { getOrgConnectStatus } from '../modules/payments/index.js';
import { AppError } from '../modules/shared/errors.js';
import { requireSession } from './session-auth.js';
import { sendError, sendJson } from './response.js';

export type BrokerHandlerDeps = {
  pool: DbPool;
};

function parseQuery(url: string | undefined): URLSearchParams {
  const q = url?.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  return new URLSearchParams(q);
}

async function requireBrokerOrg(pool: DbPool, req: IncomingMessage) {
  const identity = await requireSession(pool, req);
  const broker = pickOrgForRole(identity, ['broker', 'broker_admin', 'agent']);
  if (!broker) {
    throw new AppError('broker role required for this organization', 'auth_forbidden', 403);
  }
  return { identity, orgId: broker.orgId, role: broker.role };
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
