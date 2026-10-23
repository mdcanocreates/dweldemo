import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import type { DbPool } from '../db/pool.js';
import { assertAdmin } from '../modules/admin/ops.js';
import {
  decidePartnerIntake,
  latestPartnerIntake,
  listPartnerIntakes,
  submitPartnerIntake,
  type PartnerRole,
  type PartnerStatus,
} from '../modules/partner/index.js';
import { requireSession } from './session-auth.js';
import { readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';

export type PartnerHandlerDeps = { pool: DbPool };

const intakeBody = z.object({
  full_name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(7).max(40),
  organization_name: z.string().trim().min(2).max(200),
  market: z.string().trim().min(2).max(200),
  portfolio_size: z.string().trim().min(1).max(80),
  property_types: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

function parseRole(role: string): PartnerRole | null {
  if (role === 'landlord' || role === 'broker') return role;
  return null;
}

export async function handleGetMyPartnerIntake(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PartnerHandlerDeps,
  role: string,
): Promise<void> {
  try {
    const parsed = parseRole(role);
    if (!parsed) {
      sendJson(res, 400, { error: 'validation_error', message: 'role must be landlord or broker' });
      return;
    }
    const identity = await requireSession(deps.pool, req);
    const intake = await withSystemBypass(deps.pool, (client) =>
      latestPartnerIntake(client, identity.partyId, parsed),
    );
    sendJson(res, 200, { intake });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleSubmitPartnerIntake(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PartnerHandlerDeps,
  role: string,
): Promise<void> {
  try {
    const parsed = parseRole(role);
    if (!parsed) {
      sendJson(res, 400, { error: 'validation_error', message: 'role must be landlord or broker' });
      return;
    }
    const identity = await requireSession(deps.pool, req);
    const body = intakeBody.parse(await readJsonBody(req));
    if (parsed === 'landlord' && !body.property_types?.trim()) {
      sendJson(res, 400, {
        error: 'validation_error',
        message: 'property types are required for a landlord intake',
      });
      return;
    }
    const intake = await withSystemBypass(deps.pool, (client) =>
      submitPartnerIntake(client, identity.partyId, {
        role: parsed,
        fullName: body.full_name,
        email: body.email,
        phone: body.phone,
        organizationName: body.organization_name,
        market: body.market,
        portfolioSize: body.portfolio_size,
        propertyTypes: body.property_types ?? null,
        notes: body.notes ?? null,
      }),
    );
    sendJson(res, intake.status === 'new' ? 201 : 200, { intake });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'Check the required fields and try again.' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleAdminListPartnerIntakes(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PartnerHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    await withSystemBypass(deps.pool, (client) => assertAdmin(client, identity.partyId));
    const q = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const status = new URLSearchParams(q).get('status');
    const allowed: PartnerStatus[] = ['new', 'under_review', 'approved', 'rejected'];
    if (status && !allowed.includes(status as PartnerStatus)) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid status' });
      return;
    }
    const items = await withSystemBypass(deps.pool, (client) =>
      listPartnerIntakes(client, (status as PartnerStatus | null) || null),
    );
    sendJson(res, 200, { items });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAdminDecidePartnerIntake(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PartnerHandlerDeps,
  intakeId: string,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    await withSystemBypass(deps.pool, (client) => assertAdmin(client, identity.partyId));
    const body = z
      .object({ decision: z.enum(['under_review', 'approved', 'rejected']) })
      .parse(await readJsonBody(req));
    const intake = await withSystemBypass(deps.pool, (client) =>
      decidePartnerIntake(client, {
        intakeId,
        decision: body.decision,
        actorPartyId: identity.partyId,
      }),
    );
    sendJson(res, 200, { intake });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'decision is required' });
      return;
    }
    sendError(res, err);
  }
}
