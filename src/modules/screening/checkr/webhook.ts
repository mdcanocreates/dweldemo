import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { systemClock, type Clock } from '../../shared/clock.js';
import { emitDomainEvent } from '../../audit/index.js';
import {
  createCheckrTenantClientFromEnv,
  sanitizeReportSummary,
  verifyCheckrTenantSignature,
  type CheckrWebhookEvent,
} from '../../vendors/checkr/index.js';
import {
  getCheckrScreeningByOrderId,
  transitionCheckrScreeningStatus,
  type CheckrScreeningStatus,
} from './state.js';
import { refreshOrderAndApplication } from '../webhook.js';

const KNOWN_EVENTS = new Set([
  'order.applicant.visited',
  'order.applicant.started',
  'order.applicant.completed',
  'order.applicant.paid',
  'report.product.completed',
  'report.completed',
]);

/**
 * Ingest Checkr Tenant webhook.
 * Empty body = connectivity probe → accept without signature.
 */
export async function ingestCheckrWebhook(
  client: DbClient,
  input: {
    rawBody: string;
    signature?: string | null;
    signingSecret: string;
    clock?: Clock;
  },
): Promise<{
  accepted: boolean;
  duplicate: boolean;
  probe: boolean;
  webhookEventId: string | null;
}> {
  const clock = input.clock ?? systemClock;
  const raw = input.rawBody;

  // Connectivity probe: empty POST, no signature.
  if (!raw.trim()) {
    return { accepted: true, duplicate: false, probe: true, webhookEventId: null };
  }

  const verified = verifyCheckrTenantSignature(raw, input.signature, input.signingSecret);
  if (!verified.valid) {
    const id = randomUUID();
    let eventId = `invalid_${id}`;
    let eventType = 'invalid_signature';
    try {
      const parsed = JSON.parse(raw) as CheckrWebhookEvent;
      if (parsed.id) eventId = parsed.id;
      if (parsed.type) eventType = parsed.type;
    } catch {
      /* ignore */
    }
    await client.query(
      `insert into vendor_webhook_event (
         id, vendor, vendor_event_id, event_type, payload, signature_valid, received_at
       ) values ($1,'checkr_tenant',$2,$3,$4::jsonb,false,$5)
       on conflict (vendor, vendor_event_id) do nothing`,
      [id, eventId, eventType, raw, clock.now()],
    );
    return { accepted: false, duplicate: false, probe: false, webhookEventId: id };
  }

  let payload: CheckrWebhookEvent;
  try {
    payload = JSON.parse(raw) as CheckrWebhookEvent;
  } catch {
    throw new AppError('invalid webhook JSON', 'webhook_invalid_json', 400);
  }
  if (!payload.id) {
    throw new AppError('webhook missing event id', 'webhook_missing_event_id', 400);
  }

  const eventType = payload.type ?? 'unknown';
  const id = randomUUID();
  const insert = await client.query<{ id: string }>(
    `insert into vendor_webhook_event (
       id, vendor, vendor_event_id, event_type, payload, signature_valid, received_at
     ) values ($1,'checkr_tenant',$2,$3,$4::jsonb,true,$5)
     on conflict (vendor, vendor_event_id) do nothing
     returning id`,
    [id, payload.id, eventType, raw, clock.now()],
  );

  if (!insert.rows[0]) {
    const { rows } = await client.query<{ id: string }>(
      `select id from vendor_webhook_event
       where vendor = 'checkr_tenant' and vendor_event_id = $1`,
      [payload.id],
    );
    return {
      accepted: true,
      duplicate: true,
      probe: false,
      webhookEventId: rows[0]!.id,
    };
  }

  return {
    accepted: true,
    duplicate: false,
    probe: false,
    webhookEventId: insert.rows[0].id,
  };
}

export async function processCheckrWebhookEvent(
  client: DbClient,
  webhookEventId: string,
  clock: Clock = systemClock,
): Promise<{ handled: boolean; status?: CheckrScreeningStatus }> {
  const { rows } = await client.query<{
    id: string;
    event_type: string;
    payload: CheckrWebhookEvent;
    processed_at: Date | null;
  }>(
    `select id, event_type, payload, processed_at
     from vendor_webhook_event where id = $1 for update`,
    [webhookEventId],
  );
  const event = rows[0];
  if (!event) return { handled: false };
  if (event.processed_at) return { handled: false };

  const payload = event.payload;
  const eventType = event.event_type;

  // Unknown types: acknowledge safely without failing.
  if (!KNOWN_EVENTS.has(eventType)) {
    await client.query(
      `update vendor_webhook_event set processed_at = $2, processing_error = 'ignored_unknown_type' where id = $1`,
      [webhookEventId, clock.now()],
    );
    return { handled: true };
  }

  const orderId = payload.data?.order_id ?? (eventType.startsWith('order.') ? payload.data?.id : null);
  if (!orderId && eventType !== 'report.product.completed' && eventType !== 'report.completed') {
    await client.query(
      `update vendor_webhook_event set processed_at = $2, processing_error = 'missing_order_id' where id = $1`,
      [webhookEventId, clock.now()],
    );
    return { handled: false };
  }

  let screening = orderId ? await getCheckrScreeningByOrderId(client, orderId) : null;

  if (!screening && (eventType === 'report.completed' || eventType === 'report.product.completed')) {
    const reportId =
      eventType === 'report.completed' ? payload.data?.id : payload.data?.report_id;
    if (reportId) {
      const { rows: byReport } = await client.query<{ id: string }>(
        `select id from checkr_tenant_screening where checkr_report_id = $1 limit 1`,
        [reportId],
      );
      if (byReport[0]) {
        const { rows: full } = await client.query(
          `select * from checkr_tenant_screening where id = $1`,
          [byReport[0].id],
        );
        screening = (full[0] as typeof screening) ?? null;
      }
    }
  }

  if (!screening) {
    await client.query(
      `update vendor_webhook_event set processed_at = $2, processing_error = 'screening_not_found' where id = $1`,
      [webhookEventId, clock.now()],
    );
    return { handled: false };
  }

  let nextStatus: CheckrScreeningStatus | null = null;
  const extra: Parameters<typeof transitionCheckrScreeningStatus>[4] = {};

  switch (eventType) {
    case 'order.applicant.visited':
    case 'order.applicant.started':
      nextStatus = 'awaiting_applicant';
      break;
    case 'order.applicant.completed':
    case 'order.applicant.paid':
      nextStatus = 'processing';
      break;
    case 'report.product.completed': {
      nextStatus = 'processing';
      const product = payload.data?.product;
      if (product) {
        const statuses = {
          ...(screening.product_statuses ?? {}),
          [product]: 'completed',
        };
        extra.productStatuses = statuses;
      }
      break;
    }
    case 'report.completed': {
      nextStatus = 'completed';
      const reportId = payload.data?.id;
      if (reportId) extra.checkrReportId = reportId;
      // Fetch authoritative report (never log full payload).
      try {
        const api = createCheckrTenantClientFromEnv();
        const report = reportId
          ? await api.getReport(reportId)
          : orderId
            ? await api.getOrderReport(orderId)
            : null;
        if (report) {
          extra.checkrReportId = report.id;
          extra.reportSummary = sanitizeReportSummary(report as Record<string, unknown>);
          const productStatuses: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(
            (extra.reportSummary.products as Record<string, unknown>) ?? {},
          )) {
            productStatuses[k] = v;
          }
          extra.productStatuses = productStatuses;
        }
      } catch {
        // Keep completion even if fetch fails — retry via poll later.
        extra.lastErrorCode = 'checkr_report_fetch_failed';
      }
      break;
    }
    default:
      break;
  }

  let status = screening.status;
  if (nextStatus) {
    const result = await transitionCheckrScreeningStatus(
      client,
      screening.id,
      nextStatus,
      clock,
      extra,
    );
    status = result.transitioned ? nextStatus : screening.status;
  }

  // Sync existing screening_order / application when Checkr completes.
  if (nextStatus === 'completed') {
    if (screening.screening_order_id) {
      // Ensure at least one complete report row so refreshOrderAndApplication can advance.
      const { rows: existingReports } = await client.query<{ id: string }>(
        `select id from screening_report where screening_order_id = $1 limit 1`,
        [screening.screening_order_id],
      );
      if (!existingReports[0] && screening.checkr_report_id) {
        await client.query(
          `insert into screening_report (
             id, screening_order_id, party_id, vendor, vendor_report_id,
             report_kind, issued_at, derived_summary, status
           ) values ($1,$2,$3,'checkr_tenant',$4,'criminal',$5,$6::jsonb,'complete')
           on conflict (vendor, vendor_report_id) do nothing`,
          [
            randomUUID(),
            screening.screening_order_id,
            screening.applicant_party_id,
            screening.checkr_report_id ?? extra.checkrReportId ?? `${screening.checkr_order_id}:report`,
            clock.now(),
            extra.reportSummary ? JSON.stringify(extra.reportSummary) : '{}',
          ],
        );
      } else {
        await client.query(
          `update screening_report
           set status = 'complete', issued_at = coalesce(issued_at, $2),
               derived_summary = coalesce($3::jsonb, derived_summary)
           where screening_order_id = $1 and status = 'pending'`,
          [
            screening.screening_order_id,
            clock.now(),
            extra.reportSummary ? JSON.stringify(extra.reportSummary) : null,
          ],
        );
      }
      await refreshOrderAndApplication(
        client,
        screening.screening_order_id,
        screening.applicant_party_id,
        clock,
      );
    }

    // Direct application advance when Checkr is authoritative (no Certn saga reports).
    const { rows: apps } = await client.query<{ status: string }>(
      `select status from application where id = $1 for update`,
      [screening.application_id],
    );
    if (apps[0]?.status === 'screening_running') {
      const now = clock.now();
      await client.query(
        `update application set status = 'screened', screened_at = $2 where id = $1`,
        [screening.application_id, now],
      );
      await emitDomainEvent(client, {
        aggregateType: 'application',
        aggregateId: screening.application_id,
        eventType: 'application.status_changed',
        payload: { from: 'screening_running', to: 'screened', via: 'checkr_webhook' },
        actorKind: 'system',
        occurredAt: now,
      });
    }
  }

  await emitDomainEvent(client, {
    aggregateType: 'checkr_tenant_screening',
    aggregateId: screening.id,
    eventType: `checkr_webhook.${eventType}`,
    payload: {
      webhook_event_id: webhookEventId,
      checkr_order_id: orderId,
      status,
    },
    actorKind: 'system',
    occurredAt: clock.now(),
  });

  await client.query(
    `update vendor_webhook_event set processed_at = $2 where id = $1`,
    [webhookEventId, clock.now()],
  );

  return { handled: true, status };
}
