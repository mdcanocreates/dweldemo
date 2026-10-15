import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { DbPool } from '../db/pool.js';
import { AppError } from '../modules/shared/errors.js';
import { readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';
import {
  PREVIEW_ROLES,
  authorizePreviewAccount,
  lookupPartyIdByEmail,
  mapPreviewRoleToContext,
  parsePreviewCookie,
  previewCookieHeaders,
  type PreviewRole,
} from './preview-context.js';

export type PreviewHandlerDeps = {
  pool: DbPool;
};

export type { PreviewRole };

const setRoleSchema = z.object({
  role: z.enum(['renter', 'landlord', 'broker']).nullable(),
});

/**
 * GET /v1/internal/preview
 * Server-authorized UI preview gate — env flag + email allowlist.
 * Does not mutate party_role.
 */
export async function handleInternalPreviewAccess(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PreviewHandlerDeps,
): Promise<void> {
  try {
    const authz = await authorizePreviewAccount(deps.pool, req);
    if (!authz.ok) {
      sendJson(res, authz.status, {
        error: authz.code,
        message: authz.message,
        allowed: false,
        roles: [],
        preview: { enabled: false, role: null, preview_org_id: null, preview_party_id: null },
      });
      return;
    }

    const cookie = parsePreviewCookie(req);
    let previewPartyId: string | null = null;
    if (cookie?.role === 'renter') {
      const mapped = mapPreviewRoleToContext('renter');
      if (mapped.renterEmail) {
        previewPartyId = await lookupPartyIdByEmail(deps.pool, mapped.renterEmail);
      }
    }
    const mapped = cookie ? mapPreviewRoleToContext(cookie.role) : null;

    sendJson(res, 200, {
      allowed: true,
      email: authz.email,
      roles: PREVIEW_ROLES,
      preview: {
        enabled: true,
        role: cookie?.role ?? null,
        preview_org_id: mapped?.orgId ?? null,
        preview_party_id: previewPartyId,
      },
      orgs: {
        landlord: mapPreviewRoleToContext('landlord').orgId,
        broker: mapPreviewRoleToContext('broker').orgId,
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      sendError(res, err);
      return;
    }
    sendError(res, err);
  }
}

/**
 * POST /v1/internal/preview
 * Set or clear preview context cookie (role + server-mapped org/party).
 * Does not change DB memberships / party_role.
 */
export async function handleInternalPreviewSetRole(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PreviewHandlerDeps,
): Promise<void> {
  try {
    const authz = await authorizePreviewAccount(deps.pool, req);
    if (!authz.ok) {
      sendJson(res, authz.status, {
        error: authz.code,
        message: authz.message,
        allowed: false,
        preview: { enabled: false, role: null, preview_org_id: null, preview_party_id: null },
      });
      return;
    }

    const body = setRoleSchema.parse(await readJsonBody(req));
    if (!body.role) {
      for (const h of previewCookieHeaders(null)) {
        res.appendHeader('Set-Cookie', h);
      }
      sendJson(res, 200, {
        allowed: true,
        email: authz.email,
        roles: PREVIEW_ROLES,
        preview: { enabled: true, role: null, preview_org_id: null, preview_party_id: null },
      });
      return;
    }

    const mapped = mapPreviewRoleToContext(body.role);
    let previewPartyId: string | null = null;
    if (body.role === 'renter' && mapped.renterEmail) {
      previewPartyId = await lookupPartyIdByEmail(deps.pool, mapped.renterEmail);
      if (!previewPartyId) {
        sendJson(res, 409, {
          error: 'preview_renter_missing',
          message: 'Seeded renter preview identity not found. Run npm run seed:dev.',
          allowed: true,
          preview: { enabled: true, role: null, preview_org_id: null, preview_party_id: null },
        });
        return;
      }
    }

    const payload = {
      role: body.role,
      orgId: mapped.orgId,
      partyId: previewPartyId,
    };
    for (const h of previewCookieHeaders(payload)) {
      res.appendHeader('Set-Cookie', h);
    }

    sendJson(res, 200, {
      allowed: true,
      email: authz.email,
      roles: PREVIEW_ROLES,
      preview: {
        enabled: true,
        role: body.role,
        preview_org_id: mapped.orgId,
        preview_party_id: previewPartyId,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid preview role' });
      return;
    }
    if (err instanceof AppError) {
      sendError(res, err);
      return;
    }
    sendError(res, err);
  }
}
