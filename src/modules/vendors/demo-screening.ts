/**
 * Meeting-demo screening provider.
 * Used ONLY when DWEL_DEMO_ENABLED=true AND the application is marked is_demo.
 * Never calls Certn, Stripe, SES, S3, or external webhooks.
 */
import { randomUUID } from 'node:crypto';
import type {
  TenantScreening,
  TenantScreeningReportStatus,
  TenantScreeningSubmitRequest,
  TenantScreeningSubmitResult,
  VendorCallContext,
} from './types.js';

const DEMO_REPORT_STORE = new Map<
  string,
  {
    status: 'pending' | 'complete' | 'failed';
    derivedSummary: Record<string, unknown>;
    issuedAt?: Date;
  }
>();

export function resetDemoScreeningState(): void {
  DEMO_REPORT_STORE.clear();
}

export function completeDemoReport(
  vendorReportId: string,
  summary?: Record<string, unknown>,
): void {
  const row = DEMO_REPORT_STORE.get(vendorReportId);
  if (!row) return;
  row.status = 'complete';
  row.issuedAt = new Date();
  row.derivedSummary = {
    ...row.derivedSummary,
    ...summary,
    is_demo: true,
    label: 'DEMO RESULT',
    disclaimer: 'No real background check was performed.',
  };
}

export function completeAllDemoReportsForOrder(orderRef: string): string[] {
  const ids: string[] = [];
  for (const [id, row] of DEMO_REPORT_STORE) {
    if ((row.derivedSummary.demo_order_ref as string | undefined) === orderRef) {
      completeDemoReport(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Synthetic tenant screening for demo applications only.
 * Results are clearly marked is_demo — not a consumer report.
 */
export class DemoTenantScreening implements TenantScreening {
  readonly vendorName = 'demo';

  async submitOrder(
    req: TenantScreeningSubmitRequest,
    ctx: VendorCallContext,
  ): Promise<TenantScreeningSubmitResult> {
    const orderRef = `demo-case-${ctx.screeningOrderId ?? randomUUID()}`;
    const products = (req.packageProductCodes.length
      ? req.packageProductCodes
      : ['oneid', 'criminal_tier_1']
    ).map((productCode, i) => {
      const reportKind =
        productCode.includes('criminal') || productCode.includes('softcheck')
          ? ('criminal' as const)
          : productCode.includes('credit')
            ? ('credit' as const)
            : productCode.includes('income')
              ? ('income' as const)
              : productCode.includes('risk')
                ? ('risk_insight' as const)
                : ('identity' as const);
      const vendorReportId = `demo-report-${orderRef}-${i}`;
      DEMO_REPORT_STORE.set(vendorReportId, {
        status: 'pending',
        derivedSummary: {
          is_demo: true,
          demo_order_ref: orderRef,
          product: productCode,
          title: reportKind === 'identity' ? 'Identity check' : 'Background screening',
          status_label: 'Demo in progress',
          disclaimer: 'No real background check was performed.',
        },
      });
      return {
        productCode,
        reportKind,
        vendorReportId,
        status: 'pending' as const,
        costCents: 0,
      };
    });

    return {
      vendor: this.vendorName,
      vendorOrderRef: orderRef,
      products,
      totalCostCents: 0,
    };
  }

  async getReportStatus(
    vendorReportId: string,
    _ctx: VendorCallContext,
  ): Promise<TenantScreeningReportStatus> {
    const row = DEMO_REPORT_STORE.get(vendorReportId);
    if (!row) {
      return {
        vendorReportId,
        status: 'failed',
        derivedSummary: {
          is_demo: true,
          disclaimer: 'No real background check was performed.',
          error: 'unknown_demo_report',
        },
      };
    }
    return {
      vendorReportId,
      status: row.status,
      derivedSummary: row.derivedSummary,
      issuedAt: row.issuedAt,
    };
  }
}
