import type {
  TenantScreening,
  TenantScreeningReportStatus,
  TenantScreeningSubmitRequest,
  TenantScreeningSubmitResult,
  VendorCallContext,
} from '../types.js';
import { AppError } from '../../shared/errors.js';
import { CheckrTenantClient, createCheckrTenantClientFromEnv } from './client.js';
import type {
  CheckrApplicantInline,
  CheckrHttpFetch,
  CheckrOriginalRequesterInline,
  CheckrPackageSlug,
  CheckrPropertyAddress,
} from './types.js';

export type CheckrOrderContext = {
  packageSlug?: CheckrPackageSlug;
  property: CheckrPropertyAddress;
  applicant: CheckrApplicantInline;
  originalRequester?: CheckrOriginalRequesterInline;
  /** Dwel-enforced idempotency — Checkr test mode does not dedupe. */
  idempotencyKey: string;
};

export type CheckrTenantScreeningConfig = {
  client: CheckrTenantClient;
  /**
   * Resolve property/applicant/requester for an order.
   * Must not return raw SSN for production traffic — omit dob/ssn so hosted
   * applicant experience collects them. Sandbox tests may supply canned profiles.
   */
  resolveOrderContext: (
    req: TenantScreeningSubmitRequest,
    ctx: VendorCallContext,
  ) => Promise<CheckrOrderContext>;
};

/**
 * Checkr Tenant adapter behind TenantScreening.
 * Sensitive identity collection stays on Checkr's hosted applicant experience.
 */
export class CheckrTenantScreening implements TenantScreening {
  readonly vendorName = 'checkr_tenant';
  private readonly cfg: CheckrTenantScreeningConfig;

  constructor(cfg: CheckrTenantScreeningConfig) {
    this.cfg = cfg;
  }

  async submitOrder(
    req: TenantScreeningSubmitRequest,
    ctx: VendorCallContext,
  ): Promise<TenantScreeningSubmitResult> {
    const orderCtx = await this.cfg.resolveOrderContext(req, ctx);
    const order = await this.cfg.client.createOrder(
      {
        order: {
          package: orderCtx.packageSlug ?? 'essential',
          payer: 'organization',
          property: orderCtx.property,
          applicant: orderCtx.applicant,
          ...(orderCtx.originalRequester
            ? { original_requester: orderCtx.originalRequester }
            : {}),
        },
      },
      { idempotencyKey: orderCtx.idempotencyKey },
    );

    // Map Checkr products into existing report_kind slots for saga compatibility.
    const products: TenantScreeningSubmitResult['products'] = [
      {
        productCode: 'criminal_history',
        reportKind: 'criminal',
        vendorReportId: `${order.id}:criminal_history`,
        status: 'pending',
        costCents: 0,
      },
      {
        productCode: 'credit_report',
        reportKind: 'credit',
        vendorReportId: `${order.id}:credit_report`,
        status: 'pending',
        costCents: 0,
      },
      {
        productCode: 'eviction_history',
        reportKind: 'risk_insight',
        vendorReportId: `${order.id}:eviction_history`,
        status: 'pending',
        costCents: 0,
      },
      {
        productCode: 'income_verification',
        reportKind: 'income',
        vendorReportId: `${order.id}:income_verification`,
        status: 'pending',
        costCents: 0,
      },
      {
        productCode: 'identity_verification',
        reportKind: 'identity',
        vendorReportId: `${order.id}:identity_verification`,
        status: 'pending',
        costCents: 0,
      },
    ];

    // If order already completed (canned test profiles that skip applicant UX),
    // leave products pending — webhooks / getReportStatus will finalize.
    return {
      vendor: this.vendorName,
      vendorOrderRef: order.id,
      products,
      totalCostCents: 0,
    };
  }

  async getReportStatus(
    vendorReportId: string,
    _ctx: VendorCallContext,
  ): Promise<TenantScreeningReportStatus> {
    // vendorReportId format: `${orderId}:${product}` or raw report id `rp_…`
    const orderId = vendorReportId.includes(':')
      ? vendorReportId.split(':')[0]!
      : vendorReportId.startsWith('ord')
        ? vendorReportId
        : null;

    if (vendorReportId.startsWith('rp')) {
      try {
        const report = await this.cfg.client.getReport(vendorReportId);
        const complete =
          report.status === 'complete' ||
          report.status === 'completed' ||
          Boolean(report.completed_at);
        return {
          vendorReportId,
          status: complete ? 'complete' : 'pending',
          derivedSummary: sanitizeReportSummary(report),
          issuedAt: report.completed_at ? new Date(report.completed_at) : undefined,
        };
      } catch (err) {
        if (err instanceof AppError && err.status === 404) {
          return { vendorReportId, status: 'pending', derivedSummary: {} };
        }
        throw err;
      }
    }

    if (!orderId) {
      return { vendorReportId, status: 'pending', derivedSummary: {} };
    }

    try {
      const report = await this.cfg.client.getOrderReport(orderId);
      const productKey = vendorReportId.includes(':')
        ? vendorReportId.split(':').slice(1).join(':')
        : null;
      const product = productKey
        ? (report[productKey] as { status?: string; result?: string } | null | undefined)
        : null;
      const productDone =
        product &&
        (product.status === 'complete' ||
          product.status === 'completed' ||
          product.result === 'clear' ||
          product.result === 'consider');
      const orderDone =
        report.status === 'complete' ||
        report.status === 'completed' ||
        Boolean(report.completed_at);

      return {
        vendorReportId,
        status: productDone || orderDone ? 'complete' : 'pending',
        derivedSummary: sanitizeReportSummary(report),
        issuedAt: report.completed_at ? new Date(report.completed_at) : undefined,
      };
    } catch (err) {
      if (err instanceof AppError && err.status === 404) {
        return { vendorReportId, status: 'pending', derivedSummary: {} };
      }
      throw err;
    }
  }
}

/** Strip PII-heavy fields before anything lands in derived_summary / logs. */
export function sanitizeReportSummary(report: Record<string, unknown>): Record<string, unknown> {
  const products = [
    'criminal_history',
    'credit_report',
    'eviction_history',
    'identity_verification',
    'income_verification',
    'sex_offender_registry',
    'global_watchlist',
  ] as const;

  const out: Record<string, unknown> = {
    report_id: report.id ?? null,
    order_id: report.order_id ?? null,
    status: report.status ?? null,
    result: report.result ?? null,
    completed_at: report.completed_at ?? null,
    products: {} as Record<string, unknown>,
  };

  const productMap = out.products as Record<string, unknown>;
  for (const key of products) {
    const item = report[key] as
      | { status?: string; result?: string; consider_reasons?: unknown }
      | null
      | undefined;
    if (!item || typeof item !== 'object') continue;
    productMap[key] = {
      status: item.status ?? null,
      result: item.result ?? null,
      consider_reasons: Array.isArray(item.consider_reasons)
        ? item.consider_reasons.map((r) => {
            if (r && typeof r === 'object') {
              const o = r as { category?: string; label?: string };
              return { category: o.category ?? null, label: o.label ?? null };
            }
            return null;
          })
        : [],
    };
  }
  return out;
}

export function createCheckrTenantScreeningFromEnv(
  resolveOrderContext: CheckrTenantScreeningConfig['resolveOrderContext'],
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: CheckrHttpFetch,
): CheckrTenantScreening {
  return new CheckrTenantScreening({
    client: createCheckrTenantClientFromEnv(env, fetchImpl),
    resolveOrderContext,
  });
}
