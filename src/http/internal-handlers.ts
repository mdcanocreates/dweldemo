/**
 * Authenticated /internal/v1 APIs for RBIT Control Center.
 * Require Bearer DWEL_INTERNAL_SERVICE_TOKEN (never public unauthenticated).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import type { DbPool } from '../db/pool.js';
import {
  getApplicationIntakeSnapshot,
  getApplicationWorkItemDetail,
  listApplicationWorkItems,
  listPartnerReviewWorkItems,
  pingDb,
  requireInternalService,
} from '../modules/internal/index.js';
import { parseQuery } from './request.js';
import { sendError, sendJson } from './response.js';

export type InternalHandlerDeps = { pool: DbPool };

function requireService(req: IncomingMessage, res: ServerResponse): boolean {
  const auth = requireInternalService(req);
  if (!auth.ok) {
    sendJson(res, auth.status, {
      error: auth.error,
      ...(auth.message ? { message: auth.message } : {}),
    });
    return false;
  }
  return true;
}

export async function handleInternalHealth(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InternalHandlerDeps,
): Promise<void> {
  try {
    if (!requireService(req, res)) return;
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
    if (!requireService(req, res)) return;
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
    if (!requireService(req, res)) return;
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
    if (!requireService(req, res)) return;
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
    if (!requireService(req, res)) return;
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
