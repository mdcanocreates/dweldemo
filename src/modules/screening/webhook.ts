import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { getJobQueue } from '../../infra/queue/index.js';
import { emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import { verifyCertnWebhookSignature } from '../vendors/certn.js';
import { recordVendorCost } from './archive.js';
import { recomputeBadge } from './badge.js';
import { transitionOrderStatus } from './order.js';
import { setReportExpiryFromConfig } from './reports.js';

export type CertnWebhookPayload = {
  event_id: string;
  event_type: string;
  /** Centric: object_id is the case id; legacy stubs use vendor_order_ref. */
  object_id?: string;
  object_type?: string;
  case_status?: string;
  vendor_order_ref?: string;
  vendor_report_id?: string;
  report_kind?: string;
  status?: 'pending' | 'complete' | 'failed';
  derived_summary?: Record<string, unknown>;
  cost_cents?: number;
  sequence?: number;
};

/**
 * §3.5 webhook contract:
 * verify signature → persist raw event (unique vendor event id) → 200 → process async.
 *
 * CertnCentric: HMAC-SHA256(raw body) in X-Signature header.
 */
export async function ingestCertnWebhook(
  client: DbClient,
  input: {
    /** Raw body string used for signature verification. */
    rawBody: string;
    payload?: CertnWebhookPayload;
    signature?: string | null;
    signingSecret?: string;
    clock?: Clock;
  },
): Promise<{ accepted: boolean; duplicate: boolean; webhookEventId: string }> {
  const clock = input.clock ?? systemClock;
  const raw = input.rawBody;

  let payload = input.payload;
  if (!payload) {
    try {
      payload = JSON.parse(raw) as CertnWebhookPayload;
    } catch {
      throw new AppError('invalid webhook JSON', 'webhook_invalid_json', 400);
    }
  }

  const eventId = payload.event_id;
  if (!eventId) {
    throw new AppError('webhook missing event_id', 'webhook_missing_event_id', 400);
  }

  const eventType = payload.event_type ?? 'unknown';
  let signatureValid = true;
  if (input.signingSecret) {
    signatureValid = verifyCertnWebhookSignature(
      raw,
      input.signature,
      input.signingSecret,
    );
  }

  if (!signatureValid) {
    const id = randomUUID();
    await client.query(
      `insert into vendor_webhook_event (
         id, vendor, vendor_event_id, event_type, payload, signature_valid, received_at
       ) values ($1,'certn',$2,$3,$4::jsonb,false,$5)
       on conflict (vendor, vendor_event_id) do nothing`,
      [id, eventId, eventType, raw, clock.now()],
    );
    return { accepted: false, duplicate: false, webhookEventId: id };
  }

  const id = randomUUID();
  const insert = await client.query<{ id: string }>(
    `insert into vendor_webhook_event (
       id, vendor, vendor_event_id, event_type, payload, signature_valid, received_at
     ) values ($1,'certn',$2,$3,$4::jsonb,true,$5)
     on conflict (vendor, vendor_event_id) do nothing
     returning id`,
    [id, eventId, eventType, raw, clock.now()],
  );

  if (!insert.rows[0]) {
    const { rows } = await client.query<{ id: string }>(
      `select id from vendor_webhook_event
       where vendor = 'certn' and vendor_event_id = $1`,
      [eventId],
    );
    return { accepted: true, duplicate: true, webhookEventId: rows[0]!.id };
  }

  await getJobQueue().enqueue('vendor_webhook', {
    webhook_event_id: insert.rows[0].id,
    vendor: 'certn',
  });

  return { accepted: true, duplicate: false, webhookEventId: insert.rows[0].id };
}

export async function processCertnWebhookEvent(
  client: DbClient,
  webhookEventId: string,
  clock: Clock = systemClock,
): Promise<{ transitioned: boolean; costRecorded: boolean }> {
  const { rows } = await client.query<{
    id: string;
    payload: CertnWebhookPayload;
    processed_at: Date | null;
  }>(
    `select id, payload, processed_at from vendor_webhook_event
     where id = $1 for update`,
    [webhookEventId],
  );
  const event = rows[0];
  if (!event) return { transitioned: false, costRecorded: false };
  if (event.processed_at) return { transitioned: false, costRecorded: false };

  const payload = normalizeCertnPayload(event.payload as CertnWebhookPayload);
  const now = clock.now();

  // Prefer report-level update when vendor_report_id present (legacy stub + check events).
  if (payload.vendor_report_id) {
    return processReportLevelWebhook(client, webhookEventId, payload, now, clock);
  }

  // Centric case-level events: match screening_order.vendor_order_ref = object_id
  const orderRef = payload.vendor_order_ref ?? payload.object_id;
  if (!orderRef) {
    await client.query(
      `update vendor_webhook_event
       set processed_at = $2, processing_error = 'missing_order_ref'
       where id = $1`,
      [webhookEventId, now],
    );
    return { transitioned: false, costRecorded: false };
  }

  const { rows: orders } = await client.query<{
    id: string;
    party_id: string;
  }>(
    `select id, party_id from screening_order where vendor_order_ref = $1 for update`,
    [orderRef],
  );
  const order = orders[0];
  if (!order) {
    await client.query(
      `update vendor_webhook_event
       set processed_at = $2, processing_error = 'order_not_found'
       where id = $1`,
      [webhookEventId, now],
    );
    return { transitioned: false, costRecorded: false };
  }

  const mappedStatus = payload.status ?? 'pending';
  let transitioned = false;
  if (mappedStatus === 'complete' || mappedStatus === 'failed') {
    const { rows: reports } = await client.query<{
      id: string;
      status: string;
      screening_order_id: string;
      party_id: string;
      report_kind: string;
      vendor_report_id: string;
    }>(
      `select id, status, screening_order_id, party_id, report_kind, vendor_report_id
       from screening_report
       where screening_order_id = $1
       for update`,
      [order.id],
    );
    for (const report of reports) {
      if (report.status === 'complete' || report.status === 'failed') continue;
      await applyReportStatus(
        client,
        report,
        {
          ...payload,
          vendor_report_id: report.vendor_report_id,
          status: mappedStatus,
        },
        now,
        clock,
      );
      transitioned = true;
    }
  }

  await refreshOrderAndApplication(client, order.id, order.party_id, clock);

  await client.query(
    `update vendor_webhook_event set processed_at = $2 where id = $1`,
    [webhookEventId, now],
  );

  await emitDomainEvent(client, {
    aggregateType: 'vendor_webhook_event',
    aggregateId: webhookEventId,
    eventType: 'vendor_webhook.processed',
    payload: {
      vendor: 'certn',
      vendor_event_id: payload.event_id,
      vendor_order_ref: orderRef,
      status: mappedStatus,
      transitioned,
      cost_recorded: false,
    },
    actorKind: 'vendor',
    occurredAt: now,
  });

  return { transitioned, costRecorded: false };
}

function normalizeCertnPayload(payload: CertnWebhookPayload): CertnWebhookPayload {
  const caseStatus = (payload.case_status ?? '').toUpperCase();
  let status = payload.status;
  if (!status && caseStatus) {
    if (caseStatus === 'COMPLETE' || caseStatus === 'COMPLETED') status = 'complete';
    else if (caseStatus === 'FAILED' || caseStatus === 'CANCELLED') status = 'failed';
    else status = 'pending';
  }
  return {
    ...payload,
    vendor_order_ref: payload.vendor_order_ref ?? payload.object_id,
    status,
  };
}

async function processReportLevelWebhook(
  client: DbClient,
  webhookEventId: string,
  payload: CertnWebhookPayload,
  now: Date,
  clock: Clock,
): Promise<{ transitioned: boolean; costRecorded: boolean }> {
  const { rows: reports } = await client.query<{
    id: string;
    screening_order_id: string;
    status: string;
    party_id: string;
    report_kind: string;
    cost_cents: number | null;
  }>(
    `select id, screening_order_id, status, party_id, report_kind, cost_cents
     from screening_report
     where vendor_report_id = $1
     for update`,
    [payload.vendor_report_id],
  );
  const report = reports[0];
  if (!report) {
    await client.query(
      `update vendor_webhook_event
       set processed_at = $2, processing_error = 'report_not_found'
       where id = $1`,
      [webhookEventId, now],
    );
    return { transitioned: false, costRecorded: false };
  }

  let transitioned = false;
  const terminal = report.status === 'complete' || report.status === 'failed';
  const nextStatus = payload.status ?? 'pending';

  if (terminal) {
    if (nextStatus === 'pending') {
      // Intermediate after terminal — ignore
    } else if (nextStatus === 'complete' && report.status === 'failed') {
      await applyReportStatus(client, report, { ...payload, status: nextStatus }, now, clock);
      transitioned = true;
    }
  } else {
    await applyReportStatus(client, report, { ...payload, status: nextStatus }, now, clock);
    transitioned = report.status !== nextStatus;
  }

  let costRecorded = false;
  const costCents = payload.cost_cents ?? report.cost_cents ?? 0;
  if (nextStatus === 'complete' && costCents > 0) {
    const existingCost = await client.query<{ id: string }>(
      `select id from vendor_cost_entry where webhook_event_id = $1`,
      [webhookEventId],
    );
    if (!existingCost.rows[0]) {
      const prior = await client.query<{ id: string }>(
        `select id from vendor_cost_entry
         where screening_order_id = $1
           and capability = $2
           and note = $3`,
        [report.screening_order_id, `screening:${report.report_kind}`, report.id],
      );
      if (!prior.rows[0]) {
        await recordVendorCost(client, {
          vendor: 'certn',
          capability: `screening:${report.report_kind}`,
          amountCents: costCents,
          screeningOrderId: report.screening_order_id,
          correlationId: payload.vendor_order_ref,
          webhookEventId,
          occurredAt: now,
          note: report.id,
        });
        costRecorded = true;
      }
    }
  }

  await refreshOrderAndApplication(client, report.screening_order_id, report.party_id, clock);

  await client.query(
    `update vendor_webhook_event set processed_at = $2 where id = $1`,
    [webhookEventId, now],
  );

  await emitDomainEvent(client, {
    aggregateType: 'vendor_webhook_event',
    aggregateId: webhookEventId,
    eventType: 'vendor_webhook.processed',
    payload: {
      vendor: 'certn',
      vendor_event_id: payload.event_id,
      vendor_report_id: payload.vendor_report_id,
      status: nextStatus,
      transitioned,
      cost_recorded: costRecorded,
    },
    actorKind: 'vendor',
    occurredAt: now,
  });

  return { transitioned, costRecorded };
}

async function applyReportStatus(
  client: DbClient,
  report: {
    id: string;
    status: string;
    screening_order_id: string;
    party_id: string;
    report_kind: string;
  },
  payload: CertnWebhookPayload,
  now: Date,
  clock: Clock,
): Promise<void> {
  if (!payload.status || report.status === payload.status) return;

  const issuedAt = payload.status === 'complete' ? now : null;
  await client.query(
    `update screening_report
     set status = $2,
         derived_summary = coalesce($3::jsonb, derived_summary),
         issued_at = coalesce($4, issued_at)
     where id = $1`,
    [
      report.id,
      payload.status,
      payload.derived_summary ? JSON.stringify(payload.derived_summary) : null,
      issuedAt,
    ],
  );

  if (payload.status === 'complete' && issuedAt) {
    await setReportExpiryFromConfig(client, report.id, issuedAt, clock);
  }

  await emitDomainEvent(client, {
    aggregateType: 'screening_report',
    aggregateId: report.id,
    eventType: 'screening_report.status_changed',
    payload: {
      from: report.status,
      to: payload.status,
      report_kind: report.report_kind,
    },
    actorKind: 'vendor',
    occurredAt: now,
  });
}

export async function refreshOrderAndApplication(
  client: DbClient,
  orderId: string,
  partyId: string,
  clock: Clock = systemClock,
): Promise<void> {
  const { rows: reports } = await client.query<{
    status: string;
    report_kind: string;
  }>(`select status, report_kind from screening_report where screening_order_id = $1`, [
    orderId,
  ]);

  const allDone = reports.every((r) => r.status === 'complete' || r.status === 'failed');
  const anyComplete = reports.some((r) => r.status === 'complete');
  const anyPending = reports.some((r) => r.status === 'pending');
  const allComplete = reports.length > 0 && reports.every((r) => r.status === 'complete');

  const { rows: orderBeforeRows } = await client.query<{
    application_id: string | null;
    status: string;
  }>(`select application_id, status from screening_order where id = $1`, [orderId]);
  const ordersBefore = orderBeforeRows[0];

  if (allComplete) {
    if (ordersBefore?.status !== 'complete') {
      await transitionOrderStatus(client, orderId, 'complete', clock);
    }
  } else if (anyPending && anyComplete) {
    if (ordersBefore?.status !== 'complete' && ordersBefore?.status !== 'failed') {
      try {
        await transitionOrderStatus(client, orderId, 'partial', clock);
      } catch (err) {
        if ((err as { code?: string }).code !== 'order_invalid_transition') throw err;
      }
    }
  } else if (allDone && !allComplete) {
    if (ordersBefore?.status !== 'failed' && ordersBefore?.status !== 'complete') {
      await transitionOrderStatus(client, orderId, 'failed', clock);
    }
  }

  const { rows: orders } = await client.query<{
    application_id: string | null;
    status: string;
  }>(`select application_id, status from screening_order where id = $1`, [orderId]);
  const order = orders[0];

  // Application advances to screened only when every product resolves successfully.
  if (order?.application_id && allComplete) {
    const { rows: apps } = await client.query<{ status: string }>(
      `select status from application where id = $1 for update`,
      [order.application_id],
    );
    if (apps[0] && apps[0].status === 'screening_running') {
      const now = clock.now();
      await client.query(
        `update application set status = 'screened', screened_at = $2 where id = $1`,
        [order.application_id, now],
      );
      await emitDomainEvent(client, {
        aggregateType: 'application',
        aggregateId: order.application_id,
        eventType: 'application.status_changed',
        payload: { from: 'screening_running', to: 'screened' },
        actorKind: 'system',
        occurredAt: now,
      });
    }
  }

  await recomputeBadge(client, partyId, clock);
}

export function registerWebhookWorker(
  processFn: (webhookEventId: string) => Promise<void>,
): void {
  const queue = getJobQueue();
  queue.registerHandler('vendor_webhook', async (msg) => {
    const webhookEventId = String(msg.body.webhook_event_id);
    await processFn(webhookEventId);
  });
}

/**
 * Process webhook synchronously inside an existing transaction (tests).
 * Still goes through unique constraint + single cost path.
 */
export async function ingestAndProcessCertnWebhook(
  client: DbClient,
  payload: CertnWebhookPayload,
  clock: Clock = systemClock,
): Promise<{ duplicate: boolean; transitioned: boolean; costRecorded: boolean }> {
  const rawBody = JSON.stringify(payload);
  const ingested = await ingestCertnWebhook(client, { rawBody, payload, clock });
  if (ingested.duplicate) {
    return { duplicate: true, transitioned: false, costRecorded: false };
  }
  if (!ingested.accepted) {
    return { duplicate: false, transitioned: false, costRecorded: false };
  }
  const result = await processCertnWebhookEvent(client, ingested.webhookEventId, clock);
  return { duplicate: false, ...result };
}
