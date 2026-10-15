import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import type { DbPool } from '../db/pool.js';
import {
  getPartnerFunnelMetrics,
  recordVisitorAttribution,
} from '../modules/attribution/index.js';
import { requireSession } from './session-auth.js';
import { getClientIp, readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';

export type AttributionHandlerDeps = {
  pool: DbPool;
};

const visitSchema = z.object({
  partner_code: z.string().min(2).max(64).optional().nullable(),
  campaign_code: z.string().min(2).max(80).optional().nullable(),
  visitor_key: z.string().min(8).max(128).optional().nullable(),
  landing_path: z.string().max(500).optional().nullable(),
  http_referrer: z.string().max(500).optional().nullable(),
  utm_source: z.string().max(120).optional().nullable(),
  utm_medium: z.string().max(120).optional().nullable(),
  utm_campaign: z.string().max(120).optional().nullable(),
  utm_content: z.string().max(120).optional().nullable(),
});

/** Public — no auth. Creates/updates visitor_attribution. */
export async function handleAttributionVisit(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AttributionHandlerDeps,
): Promise<void> {
  try {
    const body = visitSchema.parse(await readJsonBody(req));
    const row = await withSystemBypass(deps.pool, (client) =>
      recordVisitorAttribution(client, {
        partnerCode: body.partner_code,
        campaignCode: body.campaign_code,
        visitorKey: body.visitor_key,
        landingPath: body.landing_path,
        httpReferrer: body.http_referrer ?? req.headers.referer ?? null,
        utmSource: body.utm_source,
        utmMedium: body.utm_medium,
        utmCampaign: body.utm_campaign,
        utmContent: body.utm_content,
      }),
    );
    void getClientIp(req);
    sendJson(res, 200, {
      visitor_key: row.visitor_key,
      partner_org_id: row.partner_org_id,
      campaign_id: row.campaign_id,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

/** Internal aggregate funnel metrics for a partner code. */
export async function handleInternalPartnerMetrics(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AttributionHandlerDeps,
  partnerCode: string,
): Promise<void> {
  try {
    await requireSession(deps.pool, req);
    const metrics = await withSystemBypass(deps.pool, (client) =>
      getPartnerFunnelMetrics(client, partnerCode),
    );
    sendJson(res, 200, metrics);
  } catch (err) {
    sendError(res, err);
  }
}
