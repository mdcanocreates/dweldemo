import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import type { DbPool } from '../db/pool.js';
import {
  assertAdmin,
  assertSuperAdmin,
  assignUserRole,
  decideSelfExecutionReview,
  getCertnAdminStatus,
  getConsentConfig,
  listAdminOrgs,
  listAdminUsers,
  listAuditEvents,
  listPlatformFlags,
  listSelfExecutionReviews,
  setOrgBrokerPayoutsFlag,
  setPlatformFlag,
  updateConsentConfig,
} from '../modules/admin/ops.js';
import { requireSession } from './session-auth.js';
import { readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';

export type AdminHandlerDeps = { pool: DbPool };

function parseQuery(url: string | undefined): URLSearchParams {
  const q = url?.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  return new URLSearchParams(q);
}

async function requireAdmin(pool: DbPool, req: IncomingMessage) {
  const identity = await requireSession(pool, req);
  const { isSuper } = await withSystemBypass(pool, (c) => assertAdmin(c, identity.partyId));
  return { identity, isSuper };
}

export async function handleAdminListUsers(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminHandlerDeps,
): Promise<void> {
  try {
    await requireAdmin(deps.pool, req);
    const q = parseQuery(req.url);
    const result = await withSystemBypass(deps.pool, (c) =>
      listAdminUsers(c, {
        q: q.get('q'),
        limit: Number(q.get('limit') ?? 50),
        offset: Number(q.get('offset') ?? 0),
      }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAdminAssignRole(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminHandlerDeps,
): Promise<void> {
  try {
    const { identity, isSuper } = await requireAdmin(deps.pool, req);
    if (!isSuper) {
      sendJson(res, 403, { error: 'auth_forbidden', message: 'rbit_super_admin required' });
      return;
    }
    const body = z
      .object({
        party_id: z.string().uuid(),
        role: z.string().min(2),
        org_id: z.string().uuid().nullable().optional(),
      })
      .parse(await readJsonBody(req));
    const granted = await withSystemBypass(deps.pool, (c) =>
      assignUserRole(c, {
        partyId: body.party_id,
        role: body.role,
        orgId: body.org_id,
        actorPartyId: identity.partyId,
      }),
    );
    sendJson(res, 201, granted);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleAdminListOrgs(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminHandlerDeps,
): Promise<void> {
  try {
    await requireAdmin(deps.pool, req);
    const q = parseQuery(req.url);
    const result = await withSystemBypass(deps.pool, (c) =>
      listAdminOrgs(c, {
        q: q.get('q'),
        limit: Number(q.get('limit') ?? 50),
        offset: Number(q.get('offset') ?? 0),
      }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAdminOrgFlags(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminHandlerDeps,
  orgId: string,
): Promise<void> {
  try {
    const { identity, isSuper } = await requireAdmin(deps.pool, req);
    if (!isSuper) {
      sendJson(res, 403, { error: 'auth_forbidden', message: 'rbit_super_admin required' });
      return;
    }
    const body = z
      .object({ broker_payouts_enabled: z.boolean() })
      .parse(await readJsonBody(req));
    const updated = await withSystemBypass(deps.pool, (c) =>
      setOrgBrokerPayoutsFlag(c, {
        orgId,
        enabled: body.broker_payouts_enabled,
        actorPartyId: identity.partyId,
      }),
    );
    sendJson(res, 200, updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleAdminGetConsent(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminHandlerDeps,
): Promise<void> {
  try {
    await requireAdmin(deps.pool, req);
    const cfg = await withSystemBypass(deps.pool, (c) => getConsentConfig(c));
    sendJson(res, 200, cfg);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAdminPutConsent(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminHandlerDeps,
): Promise<void> {
  try {
    const { identity, isSuper } = await requireAdmin(deps.pool, req);
    if (!isSuper) {
      sendJson(res, 403, { error: 'auth_forbidden', message: 'rbit_super_admin required' });
      return;
    }
    const body = z.object({ text: z.string().min(1).max(20000) }).parse(await readJsonBody(req));
    const updated = await withSystemBypass(deps.pool, (c) =>
      updateConsentConfig(c, { text: body.text, actorPartyId: identity.partyId }),
    );
    sendJson(res, 200, updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleAdminCertnStatus(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminHandlerDeps,
): Promise<void> {
  try {
    await requireAdmin(deps.pool, req);
    const status = await withSystemBypass(deps.pool, (c) => getCertnAdminStatus(c));
    sendJson(res, 200, status);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAdminListSelfExecution(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminHandlerDeps,
): Promise<void> {
  try {
    await requireAdmin(deps.pool, req);
    const q = parseQuery(req.url);
    const result = await withSystemBypass(deps.pool, (c) =>
      listSelfExecutionReviews(c, {
        status: q.get('status') ?? 'pending',
        limit: Number(q.get('limit') ?? 50),
        offset: Number(q.get('offset') ?? 0),
      }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAdminDecideSelfExecution(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminHandlerDeps,
  id: string,
): Promise<void> {
  try {
    const { identity } = await requireAdmin(deps.pool, req);
    const body = z
      .object({
        decision: z.enum(['verify', 'reject']),
        notes: z.string().max(4000).optional(),
      })
      .parse(await readJsonBody(req));
    const result = await withSystemBypass(deps.pool, (c) =>
      decideSelfExecutionReview(c, {
        id,
        decision: body.decision,
        notes: body.notes,
        actorPartyId: identity.partyId,
      }),
    );
    sendJson(res, 200, { ...result, interim_v1: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleAdminListFlags(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminHandlerDeps,
): Promise<void> {
  try {
    await requireAdmin(deps.pool, req);
    const flags = await withSystemBypass(deps.pool, (c) => listPlatformFlags(c));
    sendJson(res, 200, { flags, note: 'broker_payouts_enabled is per-org via PUT /v1/admin/orgs/{id}/flags' });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAdminSetFlag(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminHandlerDeps,
  name: string,
): Promise<void> {
  try {
    const { identity, isSuper } = await requireAdmin(deps.pool, req);
    if (!isSuper) {
      sendJson(res, 403, { error: 'auth_forbidden', message: 'rbit_super_admin required' });
      return;
    }
    void assertSuperAdmin;
    const body = z.object({ enabled: z.boolean() }).parse(await readJsonBody(req));
    const updated = await withSystemBypass(deps.pool, (c) =>
      setPlatformFlag(c, {
        name,
        enabled: body.enabled,
        actorPartyId: identity.partyId,
      }),
    );
    sendJson(res, 200, updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleAdminAudit(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminHandlerDeps,
): Promise<void> {
  try {
    await requireAdmin(deps.pool, req);
    const q = parseQuery(req.url);
    const result = await withSystemBypass(deps.pool, (c) =>
      listAuditEvents(c, {
        eventType: q.get('event_type'),
        partyId: q.get('party_id'),
        orgId: q.get('org_id'),
        from: q.get('from') ? new Date(q.get('from')!) : null,
        to: q.get('to') ? new Date(q.get('to')!) : null,
        limit: Number(q.get('limit') ?? 50),
        offset: Number(q.get('offset') ?? 0),
      }),
    );
    if (q.get('format') === 'csv') {
      const header = 'id,event_type,aggregate_type,aggregate_id,actor_party_id,occurred_at\n';
      const lines = (result.items as Array<Record<string, unknown>>)
        .map((r) =>
          [
            r.id,
            r.event_type,
            r.aggregate_type,
            r.aggregate_id,
            r.actor_party_id,
            r.occurred_at instanceof Date
              ? r.occurred_at.toISOString()
              : String(r.occurred_at ?? ''),
          ].join(','),
        )
        .join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="audit.csv"',
      });
      res.end(header + lines + '\n');
      return;
    }
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}
