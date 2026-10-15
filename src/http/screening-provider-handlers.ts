import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import { withTenantContext } from '../db/tenant.js';
import { AppError } from '../modules/shared/errors.js';
import { requireSession } from './session-auth.js';
import { pickOrgForRole } from '../modules/auth/session.js';
import {
  assertAdmin,
  assertSuperAdmin,
} from '../modules/admin/ops.js';
import {
  initiateProviderScreening,
  getProviderScreeningForViewer,
  listSelectableProviders,
  setSelectedScreeningProvider,
  listProviderSettingHistory,
  listComparisonRuns,
  probeProviderForComparison,
  buildComparisonReport,
  COMPARISON_SCENARIOS,
  assessProviderInfrastructure,
  getScreeningProviderAdapter,
  type ScreeningProviderId,
  type ScreeningProviderSelection,
} from '../modules/screening/providers/index.js';
import { getClientIp, readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';
import type { HttpHandlerDeps } from './handlers.js';

const initiateSchema = z.object({
  package: z.string().max(64).optional(),
  /** Comparison dashboard only — still requires infrastructure readiness. */
  provider: z.enum(['certn', 'checkr_tenant']).optional(),
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

const selectProviderSchema = z.object({
  provider: z.enum(['certn', 'checkr_tenant', 'disabled']),
});

export async function handleInitiateProviderScreening(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
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
        initiateProviderScreening(client, {
          applicationId,
          actorPartyId: identity.partyId,
          actorOrgId: orgId,
          providerOverride: body.provider,
          packageHint: body.package,
          sandboxApplicantOverride: body.sandbox_applicant,
        }),
    );

    sendJson(res, result.duplicate ? 200 : 201, {
      screening_id: result.screeningId,
      application_id: result.applicationId,
      provider: result.provider,
      status: result.status,
      provider_order_id: result.providerOrderId,
      application_url: result.applicationUrl,
      environment: result.environment,
      duplicate: result.duplicate,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleGetProviderScreening(
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
      getProviderScreeningForViewer(client, {
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
        provider: null,
      });
      return;
    }

    if (role === 'renter') {
      sendJson(res, 200, {
        screening_id: screening.id,
        application_id: applicationId,
        provider: screening.provider,
        status: screening.status,
        application_url: screening.application_url,
        environment: screening.environment,
        updated_at: screening.updated_at,
        completed_at: screening.completed_at,
      });
      return;
    }

    const summary = screening.result_summary ?? {};
    sendJson(res, 200, {
      screening_id: screening.id,
      application_id: applicationId,
      provider: screening.provider,
      status: screening.status,
      environment: screening.environment,
      provider_order_id: screening.provider_order_id,
      provider_report_id: screening.provider_report_id,
      application_url: screening.application_url,
      products: screening.product_statuses,
      overall_result: (summary as { overall_result?: string }).overall_result ?? null,
      review_required: Boolean((summary as { review_required?: boolean }).review_required),
      updated_at: screening.updated_at,
      completed_at: screening.completed_at,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAdminGetScreeningProviders(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const result = await withSystemBypass(deps.pool, async (client) => {
      await assertAdmin(client, identity.partyId);
      return listSelectableProviders(client);
    });
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAdminSetScreeningProvider(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  try {
    const body = selectProviderSchema.parse(await readJsonBody(req));
    const identity = await requireSession(deps.pool, req);
    const result = await withSystemBypass(deps.pool, async (client) => {
      await assertSuperAdmin(client, identity.partyId);
      return setSelectedScreeningProvider(client, {
        provider: body.provider as ScreeningProviderSelection,
        actorPartyId: identity.partyId,
      });
    });
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAdminScreeningProviderHistory(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const history = await withSystemBypass(deps.pool, async (client) => {
      await assertAdmin(client, identity.partyId);
      return listProviderSettingHistory(client);
    });
    sendJson(res, 200, { changes: history });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAdminScreeningComparison(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const data = await withSystemBypass(deps.pool, async (client) => {
      await assertAdmin(client, identity.partyId);
      const runs = await listComparisonRuns(client, { limit: 200 });
      return {
        scenarios: COMPARISON_SCENARIOS,
        infrastructure: assessProviderInfrastructure(),
        runs,
        report: buildComparisonReport(runs),
      };
    });
    sendJson(res, 200, data);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAdminProbeScreeningProvider(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  try {
    const body = z
      .object({
        provider: z.enum(['certn', 'checkr_tenant']),
        scenario_key: z.string().min(1).max(80).optional(),
      })
      .parse(await readJsonBody(req));
    const identity = await requireSession(deps.pool, req);
    const run = await withSystemBypass(deps.pool, async (client) => {
      await assertAdmin(client, identity.partyId);
      return probeProviderForComparison(client, {
        provider: body.provider as ScreeningProviderId,
        scenarioKey: body.scenario_key ?? `${body.provider}_probe`,
        actorPartyId: identity.partyId,
      });
    });
    sendJson(res, 201, { run });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleProviderWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
  providerId: ScreeningProviderId,
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

    if (!rawBody.trim()) {
      sendJson(res, 200, { ok: true, probe: true });
      return;
    }

    const adapter = getScreeningProviderAdapter(providerId);
    // Historical webhooks continue even if provider disabled for new orders —
    // only require signing secret presence.
    const secret =
      providerId === 'checkr_tenant'
        ? (deps.checkrWebhookSecret ?? process.env.CHECKR_TENANT_WEBHOOK_SECRET ?? '')
        : (deps.certnWebhookSecret ?? process.env.CERTN_WEBHOOK_SECRET ?? '');
    if (!secret) {
      sendJson(res, 503, { error: 'webhook_secret_not_configured' });
      return;
    }

    const signature =
      providerId === 'checkr_tenant'
        ? ((req.headers['tenant-signature'] as string | undefined) ?? null)
        : ((req.headers['x-signature'] as string | undefined) ??
          (req.headers['certn-signature'] as string | undefined) ??
          null);

    const ingested = await adapter.verifyAndIngestWebhook({
      rawBody,
      signatureHeader: signature,
      signingSecret: secret,
      headers: req.headers as Record<string, string | string[] | undefined>,
    });

    if (!ingested.accepted) {
      sendJson(res, 401, { error: 'invalid_signature' });
      return;
    }

    // Persist into vendor_webhook_event for audit / dedup (historical processing).
    if (ingested.providerEventId) {
      await withSystemBypass(deps.pool, async (client) => {
        const id = randomUUID();
        await client.query(
          `insert into vendor_webhook_event (
             id, vendor, vendor_event_id, event_type, payload, signature_valid, received_at
           ) values ($1,$2,$3,$4,$5::jsonb,true,now())
           on conflict (vendor, vendor_event_id) do nothing`,
          [
            id,
            providerId,
            ingested.providerEventId,
            ingested.eventType ?? 'unknown',
            rawBody,
          ],
        );

        // Update provider_screening if we can resolve order id from envelope.
        const orderId =
          (ingested.envelope?.data as { order_id?: string } | undefined)?.order_id ??
          (typeof ingested.envelope?.object_id === 'string'
            ? ingested.envelope.object_id
            : null);
        if (orderId && ingested.eventType === 'report.completed') {
          await client.query(
            `update provider_screening
             set status = 'completed',
                 last_webhook_at = now(),
                 updated_at = now(),
                 completed_at = coalesce(completed_at, now())
             where provider = $1 and provider_order_id = $2
               and status in ('awaiting_applicant','processing','not_requested')`,
            [providerId, orderId],
          );
        } else if (orderId) {
          await client.query(
            `update provider_screening
             set last_webhook_at = now(), updated_at = now()
             where provider = $1 and provider_order_id = $2`,
            [providerId, orderId],
          );
        }
      });
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

