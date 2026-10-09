/**
 * Authenticated /internal/v1 APIs for RBIT Control Center.
 * Require Bearer DWEL_INTERNAL_SERVICE_TOKEN (never public unauthenticated).
 * Optional CC service assertion when configured.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import type { DbPool } from '../db/pool.js';
import {
  executeCaseAction,
  getApplicationIntakeSnapshot,
  getApplicationWorkItemDetail,
  getCaseDetail,
  getParty,
  getScreeningStatus,
  hasScope,
  listApplicationWorkItems,
  listBrokers,
  listCaseEvents,
  listCases,
  listListings,
  listPartnerReviewWorkItems,
  listParties,
  pingDb,
  requireInternalService,
  SCREENING_VIEW_SCOPE,
  type ServiceAssertionClaims,
} from '../modules/internal/index.js';
import { parseQuery, readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';

export type InternalHandlerDeps = { pool: DbPool };

function requireService(
  req: IncomingMessage,
  res: ServerResponse,
): ServiceAssertionClaims | null | false {
  const auth = requireInternalService(req);
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: auth.error,
      ...(auth.message ? { message: auth.message } : {}),
    });
    return false;
  }
  return auth.assertion;
}

function headerMap(req: IncomingMessage): Record<string, string | string[] | undefined> {
  return req.headers as Record<string, string | string[] | undefined>;
}

function idempotencyKeyFrom(req: IncomingMessage): string | null {
  const h = req.headers['idempotency-key'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  if (Array.isArray(h) && h[0]?.trim()) return h[0].trim();
  return null;
}

function actorSubjectFrom(
  req: IncomingMessage,
  assertion: ServiceAssertionClaims | null,
): string | null {
  if (assertion?.sub) return assertion.sub;
  const h = req.headers['x-rbit-actor-subject'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  return null;
}

export async function handleInternalHealth(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
): Promise<void> {
  try {
    if (requireService(req, res) === false) return;
    await withSystemBypass(deps.pool, (c) => pingDb(c));
    sendJson(res, 200, { ok: true, product: 'dwel' });
  } catch {
    sendJson(res, 503, { ok: false, product: 'dwel', error: 'db_unavailable' });
  }
}

export async function handleInternalListApplications(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
): Promise<void> {
  try {
    if (requireService(req, res) === false) return;
    const q = parseQuery(req.url ?? '');
    const limitRaw = q.get('limit');
    const limit = limitRaw != null ? Number(limitRaw) : 50;
    const result = await withSystemBypass(deps.pool, (c) =>
      listApplicationWorkItems(c, {
        limit: Number.isFinite(limit) ? limit : 50,
        cursor: q.get('cursor'),
        q: q.get('q'),
      }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInternalGetApplication(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    if (requireService(req, res) === false) return;
    const parsed = z.string().uuid().safeParse(applicationId);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid application id' });
      return;
    }
    const detail = await withSystemBypass(deps.pool, (c) =>
      getApplicationWorkItemDetail(c, parsed.data),
    );
    sendJson(res, 200, detail);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInternalGetApplicationIntake(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    if (requireService(req, res) === false) return;
    const parsed = z.string().uuid().safeParse(applicationId);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid application id' });
      return;
    }
    const intake = await withSystemBypass(deps.pool, (c) =>
      getApplicationIntakeSnapshot(c, parsed.data),
    );
    sendJson(res, 200, intake);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInternalListPartnerReviews(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
): Promise<void> {
  try {
    if (requireService(req, res) === false) return;
    const q = parseQuery(req.url ?? '');
    const limitRaw = q.get('limit');
    const offsetRaw = q.get('offset');
    const limit = limitRaw != null ? Number(limitRaw) : 50;
    const offset = offsetRaw != null ? Number(offsetRaw) : 0;
    const result = await withSystemBypass(deps.pool, (c) =>
      listPartnerReviewWorkItems(c, {
        status: q.get('status') ?? 'pending',
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
      }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInternalListCases(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
): Promise<void> {
  try {
    if (requireService(req, res) === false) return;
    const q = parseQuery(req.url ?? '');
    const limitRaw = q.get('limit');
    const limit = limitRaw != null ? Number(limitRaw) : 50;
    const result = await withSystemBypass(deps.pool, (c) =>
      listCases(c, {
        limit: Number.isFinite(limit) ? limit : 50,
        cursor: q.get('cursor'),
        q: q.get('q'),
        caseType: q.get('case_type') ?? q.get('caseType'),
        updatedSince: q.get('updated_since') ?? q.get('updatedSince'),
      }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInternalGetCase(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
  sourceCaseId: string,
): Promise<void> {
  try {
    if (requireService(req, res) === false) return;
    const detail = await withSystemBypass(deps.pool, (c) => getCaseDetail(c, sourceCaseId));
    sendJson(res, 200, detail);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInternalListCaseEvents(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
  sourceCaseId: string,
): Promise<void> {
  try {
    if (requireService(req, res) === false) return;
    const q = parseQuery(req.url ?? '');
    const limitRaw = q.get('limit');
    const limit = limitRaw != null ? Number(limitRaw) : 50;
    const result = await withSystemBypass(deps.pool, (c) =>
      listCaseEvents(c, sourceCaseId, {
        limit: Number.isFinite(limit) ? limit : 50,
      }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInternalListParties(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
): Promise<void> {
  try {
    if (requireService(req, res) === false) return;
    const q = parseQuery(req.url ?? '');
    const limitRaw = q.get('limit');
    const limit = limitRaw != null ? Number(limitRaw) : 50;
    const result = await withSystemBypass(deps.pool, (c) =>
      listParties(c, {
        limit: Number.isFinite(limit) ? limit : 50,
        cursor: q.get('cursor'),
        q: q.get('q'),
      }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInternalGetParty(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
  partyId: string,
): Promise<void> {
  try {
    if (requireService(req, res) === false) return;
    const party = await withSystemBypass(deps.pool, (c) => getParty(c, partyId));
    sendJson(res, 200, party);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInternalScreeningStatus(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
  sourceCaseId: string,
): Promise<void> {
  try {
    if (requireService(req, res) === false) return;
    const status = await withSystemBypass(deps.pool, (c) =>
      getScreeningStatus(c, sourceCaseId),
    );
    sendJson(res, 200, status);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInternalScreeningResult(
  req: IncomingMessage,
  res: ServerResponse,
  _deps: InternalHandlerDeps,
  _sourceCaseId: string,
): Promise<void> {
  try {
    const assertion = requireService(req, res);
    if (assertion === false) return;
    // Prefer status-only: full screening result requires explicit scope + audit.
    // Even with scope, do not return report bodies through this surface yet.
    if (!hasScope(assertion, SCREENING_VIEW_SCOPE)) {
      sendJson(res, 403, {
        error: 'screening_view_forbidden',
        message:
          'screening view requires explicit scope dwel.screening.view and audit; use GET .../screening-status',
      });
      return;
    }
    sendJson(res, 403, {
      error: 'screening_view_not_enabled',
      message:
        'screening report bodies are not exposed via Control Center internal API; use screening-status (status-only)',
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInternalListBrokers(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
): Promise<void> {
  try {
    if (requireService(req, res) === false) return;
    const q = parseQuery(req.url ?? '');
    const limitRaw = q.get('limit');
    const limit = limitRaw != null ? Number(limitRaw) : 50;
    const result = await withSystemBypass(deps.pool, (c) =>
      listBrokers(c, {
        limit: Number.isFinite(limit) ? limit : 50,
        q: q.get('q'),
      }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInternalListListings(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
): Promise<void> {
  try {
    if (requireService(req, res) === false) return;
    const q = parseQuery(req.url ?? '');
    const limitRaw = q.get('limit');
    const limit = limitRaw != null ? Number(limitRaw) : 50;
    const result = await withSystemBypass(deps.pool, (c) =>
      listListings(c, {
        limit: Number.isFinite(limit) ? limit : 50,
        q: q.get('q'),
        status: q.get('status'),
      }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleInternalCaseAction(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
  sourceCaseId: string,
  action: string,
): Promise<void> {
  try {
    const assertion = requireService(req, res);
    if (assertion === false) return;

    const idempotencyKey = idempotencyKeyFrom(req);
    if (!idempotencyKey) {
      sendJson(res, 400, {
        error: 'idempotency_key_required',
        message: 'Idempotency-Key header is required for mutations',
      });
      return;
    }

    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const result = await withSystemBypass(deps.pool, (c) =>
      executeCaseAction(c, {
        rawCaseId: sourceCaseId,
        action,
        headers: headerMap(req),
        body,
        idempotencyKey,
        actorSubject: actorSubjectFrom(req, assertion),
      }),
    );
    sendJson(res, result.status, result.body);
  } catch (err) {
    sendError(res, err);
  }
}
