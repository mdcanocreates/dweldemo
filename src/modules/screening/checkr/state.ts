import type { DbClient } from '../../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { systemClock, type Clock } from '../../shared/clock.js';

/**
 * Checkr screening sub-states — orthogonal to application leasing status.
 */
export type CheckrScreeningStatus =
  | 'not_requested'
  | 'awaiting_applicant'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled';

const ALLOWED: Record<CheckrScreeningStatus, CheckrScreeningStatus[]> = {
  not_requested: ['awaiting_applicant', 'processing', 'failed', 'canceled'],
  awaiting_applicant: ['processing', 'completed', 'failed', 'canceled'],
  processing: ['completed', 'failed', 'canceled'],
  completed: [],
  failed: [],
  canceled: [],
};

export function canTransitionCheckrStatus(
  from: CheckrScreeningStatus,
  to: CheckrScreeningStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED[from]?.includes(to) ?? false;
}

export async function transitionCheckrScreeningStatus(
  client: DbClient,
  screeningId: string,
  to: CheckrScreeningStatus,
  clock: Clock = systemClock,
  extra?: {
    applicationUrl?: string | null;
    checkrOrderId?: string | null;
    checkrReportId?: string | null;
    checkrApplicantId?: string | null;
    checkrPropertyId?: string | null;
    reportSummary?: Record<string, unknown> | null;
    productStatuses?: Record<string, unknown> | null;
    lastErrorCode?: string | null;
  },
): Promise<{ transitioned: boolean; from: CheckrScreeningStatus }> {
  const { rows } = await client.query<{ status: CheckrScreeningStatus }>(
    `select status from checkr_tenant_screening where id = $1 for update`,
    [screeningId],
  );
  const row = rows[0];
  if (!row) {
    throw new AppError('checkr screening not found', 'checkr_screening_not_found', 404);
  }
  const from = row.status;
  if (from === to) {
    // Still allow metadata updates on same-status (out-of-order webhooks).
    await applyExtra(client, screeningId, clock, extra);
    return { transitioned: false, from };
  }
  if (!canTransitionCheckrStatus(from, to)) {
    // Out-of-order: ignore illegal reverse transitions without failing the webhook.
    return { transitioned: false, from };
  }

  const now = clock.now();
  const completedAt = to === 'completed' || to === 'failed' || to === 'canceled' ? now : null;
  await client.query(
    `update checkr_tenant_screening
     set status = $2,
         updated_at = $3,
         completed_at = coalesce($4, completed_at),
         application_url = coalesce($5, application_url),
         checkr_order_id = coalesce($6, checkr_order_id),
         checkr_report_id = coalesce($7, checkr_report_id),
         checkr_applicant_id = coalesce($8, checkr_applicant_id),
         checkr_property_id = coalesce($9, checkr_property_id),
         report_summary = coalesce($10::jsonb, report_summary),
         product_statuses = coalesce($11::jsonb, product_statuses),
         last_error_code = coalesce($12, last_error_code),
         last_webhook_at = $3
     where id = $1`,
    [
      screeningId,
      to,
      now,
      completedAt,
      extra?.applicationUrl ?? null,
      extra?.checkrOrderId ?? null,
      extra?.checkrReportId ?? null,
      extra?.checkrApplicantId ?? null,
      extra?.checkrPropertyId ?? null,
      extra?.reportSummary ? JSON.stringify(extra.reportSummary) : null,
      extra?.productStatuses ? JSON.stringify(extra.productStatuses) : null,
      extra?.lastErrorCode ?? null,
    ],
  );
  return { transitioned: true, from };
}

async function applyExtra(
  client: DbClient,
  screeningId: string,
  clock: Clock,
  extra?: Parameters<typeof transitionCheckrScreeningStatus>[4],
): Promise<void> {
  if (!extra) return;
  await client.query(
    `update checkr_tenant_screening
     set updated_at = $2,
         application_url = coalesce($3, application_url),
         checkr_order_id = coalesce($4, checkr_order_id),
         checkr_report_id = coalesce($5, checkr_report_id),
         checkr_applicant_id = coalesce($6, checkr_applicant_id),
         checkr_property_id = coalesce($7, checkr_property_id),
         report_summary = coalesce($8::jsonb, report_summary),
         product_statuses = coalesce($9::jsonb, product_statuses),
         last_error_code = coalesce($10, last_error_code),
         last_webhook_at = $2
     where id = $1`,
    [
      screeningId,
      clock.now(),
      extra.applicationUrl ?? null,
      extra.checkrOrderId ?? null,
      extra.checkrReportId ?? null,
      extra.checkrApplicantId ?? null,
      extra.checkrPropertyId ?? null,
      extra.reportSummary ? JSON.stringify(extra.reportSummary) : null,
      extra.productStatuses ? JSON.stringify(extra.productStatuses) : null,
      extra.lastErrorCode ?? null,
    ],
  );
}

export type CheckrScreeningRow = {
  id: string;
  application_id: string;
  property_id: string | null;
  listing_id: string | null;
  applicant_party_id: string;
  requester_party_id: string | null;
  requester_org_id: string;
  screening_order_id: string | null;
  checkr_order_id: string | null;
  checkr_report_id: string | null;
  checkr_applicant_id: string | null;
  checkr_property_id: string | null;
  package_slug: string;
  payer: string;
  environment: string;
  status: CheckrScreeningStatus;
  application_url: string | null;
  idempotency_key: string;
  report_summary: Record<string, unknown> | null;
  product_statuses: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

export async function getCheckrScreeningByApplication(
  client: DbClient,
  applicationId: string,
): Promise<CheckrScreeningRow | null> {
  const { rows } = await client.query<CheckrScreeningRow>(
    `select *
     from checkr_tenant_screening
     where application_id = $1
     order by created_at desc
     limit 1`,
    [applicationId],
  );
  return rows[0] ?? null;
}

export async function getCheckrScreeningByOrderId(
  client: DbClient,
  checkrOrderId: string,
): Promise<CheckrScreeningRow | null> {
  const { rows } = await client.query<CheckrScreeningRow>(
    `select * from checkr_tenant_screening where checkr_order_id = $1 limit 1`,
    [checkrOrderId],
  );
  return rows[0] ?? null;
}
