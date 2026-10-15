import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import { withTenantContext } from '../db/tenant.js';
import { AppError } from '../modules/shared/errors.js';
import { requireSession } from './session-auth.js';
import { pickOrgForRole } from '../modules/auth/session.js';
import {
  initiateCheckrScreening,
  getCheckrScreeningForAuthorizedViewer,
  getCheckrReportReview,
  downloadCheckrReportPdf,
  ingestCheckrWebhook,
  processCheckrWebhookEvent,
} from '../modules/screening/checkr/index.js';
import { assessCheckrAvailability } from '../modules/vendors/checkr/index.js';
import { createLogger } from '../infra/logging/logger.js';
import { getClientIp, readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';
import type { HttpHandlerDeps } from './handlers.js';

const logger = createLogger();
void logger;

const initiateSchema = z.object({
  package: z.enum(['starter', 'essential', 'complete']).optional(),
  /** Test-mode only canned profiles — rejected outside test. */
  sandbox_applicant: z
    .object({
      first_name: z.string().min(1).max(50),
      last_name: z.string().min(1).max(50),
      email: z.string().email().optional(),
      dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      ssn: z.string().min(9).max(11).optional(),
    })
    .optional(),
});

export async function handleInitiateCheckrScreening(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const availability = assessCheckrAvailability();
    if (!availability.available) {
      sendJson(res, 503, {
        error: 'SCREENING_PROVIDER_UNAVAILABLE',
        message: 'Checkr Tenant screening is not configured',
        reason: availability.reason,
      });
      return;
    }

    const body = initiateSchema.parse(await readJsonBody(req));
    const identity = await requireSession(deps.pool, req);
    const landlord = pickOrgForRole(identity, ['landlord']);
    const broker = pickOrgForRole(identity, ['broker', 'broker_admin', 'agent']);
    const orgId = landlord?.orgId ?? broker?.orgId;
    if (!orgId) {
      throw new AppError('home provider or broker role required', 'auth_forbidden', 403);
    }

    const result = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        initiateCheckrScreening(client, {
          applicationId,
          actorPartyId: identity.partyId,
          actorOrgId: orgId,
          packageSlug: body.package,
          sandboxApplicantOverride: body.sandbox_applicant,
        }),
    );

    sendJson(res, result.duplicate ? 200 : 201, {
      screening_id: result.screeningId,
      application_id: result.applicationId,
      status: result.status,
      checkr_order_id: result.checkrOrderId,
      application_url: result.applicationUrl,
      environment: result.environment,
      duplicate: result.duplicate,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleGetCheckrScreening(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const landlord = pickOrgForRole(identity, ['landlord']);
    const broker = pickOrgForRole(identity, ['broker', 'broker_admin', 'agent']);
    const renter = pickOrgForRole(identity, ['renter']);

    let role: 'renter' | 'landlord' | 'broker' | 'admin' = 'renter';
    let orgId: string | null = null;
    if (landlord) {
      role = 'landlord';
      orgId = landlord.orgId;
    } else if (broker) {
      role = 'broker';
      orgId = broker.orgId;
    } else if (renter) {
      role = 'renter';
      orgId = renter.orgId;
    } else {
      throw new AppError('forbidden', 'auth_forbidden', 403);
    }

    const screening = await withSystemBypass(deps.pool, (client) =>
      getCheckrScreeningForAuthorizedViewer(client, {
        applicationId,
        viewerPartyId: identity.partyId,
        viewerOrgId: orgId,
        role,
      }),
    );

    if (!screening) {
      sendJson(res, 200, {
        application_id: applicationId,
        status: 'not_requested',
        checkr_enabled: assessCheckrAvailability().available,
      });
      return;
    }

    // Renters see progress + CTA URL only — never full report summary.
    if (role === 'renter') {
      sendJson(res, 200, {
        screening_id: screening.id,
        application_id: screening.application_id,
        status: screening.status,
        application_url: screening.application_url,
        environment: screening.environment,
        package_slug: screening.package_slug,
        updated_at: screening.updated_at,
        completed_at: screening.completed_at,
      });
      return;
    }

    const review = await withSystemBypass(deps.pool, (client) =>
      getCheckrReportReview(client, {
        applicationId,
        viewerPartyId: identity.partyId,
        viewerOrgId: orgId!,
        role: role as 'landlord' | 'broker' | 'admin',
        ip: getClientIp(req),
        userAgent: req.headers['user-agent']?.toString() ?? null,
      }),
    );
    sendJson(res, 200, review);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleDownloadCheckrReportPdf(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const landlord = pickOrgForRole(identity, ['landlord']);
    const broker = pickOrgForRole(identity, ['broker', 'broker_admin', 'agent']);
    const orgId = landlord?.orgId ?? broker?.orgId;
    if (!orgId) {
      throw new AppError('forbidden', 'auth_forbidden', 403);
    }

    const { bytes } = await withSystemBypass(deps.pool, (client) =>
      downloadCheckrReportPdf(client, {
        applicationId,
        viewerPartyId: identity.partyId,
        viewerOrgId: orgId,
        role: landlord ? 'landlord' : 'broker',
        ip: getClientIp(req),
        userAgent: req.headers['user-agent']?.toString() ?? null,
      }),
    );

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="screening-${applicationId}.pdf"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(bytes);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleCheckrWebhookPost(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > 256 * 1024) {
        sendJson(res, 413, { error: 'payload_too_large' });
        return;
      }
      chunks.push(buf);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const signature =
      (req.headers['tenant-signature'] as string | undefined) ??
      (req.headers['Tenant-Signature'] as string | undefined) ??
      null;

    const secret =
      deps.checkrWebhookSecret ?? process.env.CHECKR_TENANT_WEBHOOK_SECRET ?? '';

    // Connectivity probe (empty body) — accept even if secret missing so dashboard test works.
    if (!rawBody.trim()) {
      sendJson(res, 200, { ok: true, probe: true });
      return;
    }

    if (!secret) {
      sendJson(res, 503, { error: 'webhook_secret_not_configured' });
      return;
    }

    const ingested = await withSystemBypass(deps.pool, async (client) => {
      const result = await ingestCheckrWebhook(client, {
        rawBody,
        signature,
        signingSecret: secret,
      });
      if (result.accepted && !result.duplicate && !result.probe && result.webhookEventId) {
        await processCheckrWebhookEvent(client, result.webhookEventId);
      }
      return result;
    });

    if (!ingested.accepted) {
      sendJson(res, 401, { error: 'invalid_signature' });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      duplicate: ingested.duplicate,
      probe: ingested.probe,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleCheckrStatus(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const availability = assessCheckrAvailability();
  sendJson(res, 200, {
    enabled: availability.available,
    mode: availability.available ? availability.mode : null,
    reason: availability.available ? null : availability.reason,
  });
}
