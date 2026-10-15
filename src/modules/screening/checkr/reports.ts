import type { DbClient } from '../../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { systemClock, type Clock } from '../../shared/clock.js';
import {
  createCheckrTenantClientFromEnv,
  sanitizeReportSummary,
} from '../../vendors/checkr/index.js';
import { getCheckrScreeningForAuthorizedViewer } from './initiate.js';
import type { CheckrScreeningRow } from './state.js';

export type CheckrReportReviewDto = {
  screening_id: string;
  application_id: string;
  status: string;
  environment: string;
  package_slug: string;
  checkr_order_id: string | null;
  checkr_report_id: string | null;
  application_url: string | null;
  /** clear | consider | pending | null — never auto-decide from consider */
  overall_result: string | null;
  products: Record<
    string,
    {
      status: string | null;
      result: string | null;
      consider_reasons: Array<{ category: string | null; label: string | null }>;
    }
  >;
  review_required: boolean;
  completed_at: string | null;
  updated_at: string;
};

/**
 * Authorization-protected report summary for home provider review.
 * Does not auto approve/deny/rank. `consider` ⇒ review_required only.
 */
export async function getCheckrReportReview(
  client: DbClient,
  input: {
    applicationId: string;
    viewerPartyId: string;
    viewerOrgId: string;
    role: 'landlord' | 'broker' | 'admin';
    refresh?: boolean;
    ip?: string | null;
    userAgent?: string | null;
    clock?: Clock;
  },
): Promise<CheckrReportReviewDto | null> {
  const clock = input.clock ?? systemClock;
  const screening = await getCheckrScreeningForAuthorizedViewer(client, {
    applicationId: input.applicationId,
    viewerPartyId: input.viewerPartyId,
    viewerOrgId: input.viewerOrgId,
    role: input.role,
  });
  if (!screening) return null;

  if (input.refresh && screening.checkr_report_id) {
    try {
      const api = createCheckrTenantClientFromEnv();
      const report = await api.getReport(screening.checkr_report_id);
      const summary = sanitizeReportSummary(report as Record<string, unknown>);
      await client.query(
        `update checkr_tenant_screening
         set report_summary = $2::jsonb,
             product_statuses = $3::jsonb,
             updated_at = $4
         where id = $1`,
        [
          screening.id,
          JSON.stringify(summary),
          JSON.stringify(summary.products ?? {}),
          clock.now(),
        ],
      );
      screening.report_summary = summary;
      screening.product_statuses = (summary.products as Record<string, unknown>) ?? {};
    } catch {
      /* serve cached summary */
    }
  }

  await auditAccess(client, {
    screeningId: screening.id,
    actorPartyId: input.viewerPartyId,
    actorOrgId: input.viewerOrgId,
    accessKind: 'summary_view',
    ip: input.ip,
    userAgent: input.userAgent,
    clock,
  });

  return toReviewDto(screening);
}

export async function downloadCheckrReportPdf(
  client: DbClient,
  input: {
    applicationId: string;
    viewerPartyId: string;
    viewerOrgId: string;
    role: 'landlord' | 'broker' | 'admin';
    ip?: string | null;
    userAgent?: string | null;
    clock?: Clock;
  },
): Promise<{ bytes: Buffer; screening: CheckrScreeningRow }> {
  const clock = input.clock ?? systemClock;
  const screening = await getCheckrScreeningForAuthorizedViewer(client, {
    applicationId: input.applicationId,
    viewerPartyId: input.viewerPartyId,
    viewerOrgId: input.viewerOrgId,
    role: input.role,
  });
  if (!screening?.checkr_report_id) {
    throw new AppError('report not available', 'checkr_report_unavailable', 404);
  }
  if (screening.status !== 'completed') {
    throw new AppError('report not complete', 'checkr_report_pending', 409);
  }

  const api = createCheckrTenantClientFromEnv();
  const bytes = await api.getReportPdf(screening.checkr_report_id);

  await auditAccess(client, {
    screeningId: screening.id,
    actorPartyId: input.viewerPartyId,
    actorOrgId: input.viewerOrgId,
    accessKind: 'pdf_download',
    ip: input.ip,
    userAgent: input.userAgent,
    clock,
  });

  return { bytes, screening };
}

function toReviewDto(screening: CheckrScreeningRow): CheckrReportReviewDto {
  const summary = screening.report_summary ?? {};
  const productsRaw =
    (summary.products as Record<string, unknown>) ?? screening.product_statuses ?? {};
  const products: CheckrReportReviewDto['products'] = {};
  let reviewRequired = false;

  for (const [key, val] of Object.entries(productsRaw)) {
    if (!val || typeof val !== 'object') continue;
    const v = val as {
      status?: string | null;
      result?: string | null;
      consider_reasons?: Array<{ category?: string | null; label?: string | null }>;
    };
    const result = v.result ?? null;
    if (result === 'consider') reviewRequired = true;
    products[key] = {
      status: v.status ?? null,
      result,
      consider_reasons: (v.consider_reasons ?? []).map((r) => ({
        category: r?.category ?? null,
        label: r?.label ?? null,
      })),
    };
  }

  const overall =
    (summary.result as string | null | undefined) ??
    (reviewRequired ? 'consider' : screening.status === 'completed' ? 'clear' : null);

  if (overall === 'consider') reviewRequired = true;

  return {
    screening_id: screening.id,
    application_id: screening.application_id,
    status: screening.status,
    environment: screening.environment,
    package_slug: screening.package_slug,
    checkr_order_id: screening.checkr_order_id,
    checkr_report_id: screening.checkr_report_id,
    application_url: screening.application_url,
    overall_result: overall,
    products,
    review_required: reviewRequired,
    completed_at: screening.completed_at?.toISOString() ?? null,
    updated_at: screening.updated_at.toISOString(),
  };
}

async function auditAccess(
  client: DbClient,
  input: {
    screeningId: string;
    actorPartyId: string;
    actorOrgId: string;
    accessKind: 'summary_view' | 'report_fetch' | 'pdf_download' | 'document_download' | 'documents_zip';
    ip?: string | null;
    userAgent?: string | null;
    clock: Clock;
  },
): Promise<void> {
  await client.query(
    `insert into checkr_report_access_audit (
       screening_id, actor_party_id, actor_org_id, access_kind,
       permissible_purpose, ip, user_agent, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.screeningId,
      input.actorPartyId,
      input.actorOrgId,
      input.accessKind,
      'tenant_screening_permissible_purpose',
      input.ip ?? null,
      input.userAgent ?? null,
      input.clock.now(),
    ],
  );
}
