import { createHash, randomUUID } from 'node:crypto';
import type {
  ESign,
  ESignRequest,
  ESignResult,
  IdentityVerification,
  IdentityVerificationRequest,
  IdentityVerificationResult,
  IncomeVerification,
  IncomeVerificationRequest,
  IncomeVerificationResult,
  PaymentRail,
  StripeBalanceTransaction,
  StripeChargeRequest,
  StripeChargeResult,
  StripeWebhookEnvelope,
  TenantScreening,
  TenantScreeningReportStatus,
  TenantScreeningSubmitRequest,
  TenantScreeningSubmitResult,
  VaultTokenizer,
  VaultTokenizeRequest,
  VaultTokenizeResult,
  VendorCallContext,
} from './types.js';

const PRODUCT_TO_KIND: Record<
  string,
  'identity' | 'credit' | 'criminal' | 'risk_insight' | 'income'
> = {
  oneid: 'identity',
  criminal_tier_1: 'criminal',
  credit_equifax: 'credit',
  risk_insight: 'risk_insight',
  income: 'income',
};

const PRODUCT_COST: Record<string, number> = {
  oneid: 299,
  criminal_tier_1: 1049,
  credit_equifax: 799,
  risk_insight: 799,
  income: 30,
};

/** In-memory report store for stub Completions / webhook simulation. */
const stubReportStore = new Map<
  string,
  {
    status: 'pending' | 'complete' | 'failed';
    derivedSummary: Record<string, unknown>;
    issuedAt?: Date;
    orderRef: string;
    reportKind: string;
  }
>();

/** In-memory Stripe balance txn fixture store for reconciliation tests. */
const stubStripeBalanceTxns: StripeBalanceTransaction[] = [];

export function resetVendorStubState(): void {
  stubReportStore.clear();
  stubStripeBalanceTxns.length = 0;
}

export function seedStubStripeBalanceTransactions(
  rows: StripeBalanceTransaction[],
): void {
  stubStripeBalanceTxns.push(...rows);
}

export function stubForceReportStatus(
  vendorReportId: string,
  status: 'pending' | 'complete' | 'failed',
  derivedSummary?: Record<string, unknown>,
): void {
  const existing = stubReportStore.get(vendorReportId);
  if (!existing) throw new Error(`unknown stub report ${vendorReportId}`);
  existing.status = status;
  if (derivedSummary) existing.derivedSummary = derivedSummary;
  if (status === 'complete') existing.issuedAt = new Date();
}

export function listStubReportIdsForOrder(orderRef: string): string[] {
  const ids: string[] = [];
  for (const [id, v] of stubReportStore) {
    if (v.orderRef === orderRef) ids.push(id);
  }
  return ids;
}

export class StubIdentityVerification implements IdentityVerification {
  readonly vendorName = 'stub_identity';

  async verify(
    req: IdentityVerificationRequest,
    _ctx: VendorCallContext,
  ): Promise<IdentityVerificationResult> {
    const vendorReportId = `stub-id-${randomUUID()}`;
    return {
      vendor: this.vendorName,
      vendorReportId,
      status: 'complete',
      verified: true,
      derivedSummary: {
        identity_verified: true,
        has_fingerprint: Boolean(req.identityFingerprint),
      },
      costCents: 299,
      syntheticIdentityFlag: false,
    };
  }
}

export class StubIncomeVerification implements IncomeVerification {
  readonly vendorName = 'stub_income';

  async verify(
    req: IncomeVerificationRequest,
    _ctx: VendorCallContext,
  ): Promise<IncomeVerificationResult> {
    const monthly =
      req.statedMonthlyIncomeCents ??
      (req.method === 'stated' ? 0 : 500000);
    return {
      vendor: this.vendorName,
      vendorRef: `stub-inc-${randomUUID()}`,
      method: req.method,
      status: 'complete',
      monthlyIncomeCents: monthly,
      confidence: 0, // filled by screening from config
      costCents: req.method.startsWith('plaid') ? 30 : 0,
    };
  }
}

/**
 * Optional Plaid-shaped adapter behind IncomeVerification (D-16).
 * Does not assume MSA; zero network — fixture responses only.
 */
export class PlaidIncomeAdapter implements IncomeVerification {
  readonly vendorName = 'plaid';

  async verify(
    req: IncomeVerificationRequest,
    _ctx: VendorCallContext,
  ): Promise<IncomeVerificationResult> {
    if (req.method !== 'plaid_bank' && req.method !== 'plaid_payroll') {
      throw new Error('PlaidIncomeAdapter only supports plaid_* methods');
    }
    return {
      vendor: this.vendorName,
      vendorRef: `plaid-fix-${randomUUID()}`,
      method: req.method,
      status: 'complete',
      monthlyIncomeCents: req.statedMonthlyIncomeCents ?? 450000,
      confidence: 0,
      costCents: req.method === 'plaid_payroll' ? 610 : 30,
    };
  }
}

export class StubTenantScreening implements TenantScreening {
  readonly vendorName = 'certn_stub';

  async submitOrder(
    req: TenantScreeningSubmitRequest,
    _ctx: VendorCallContext,
  ): Promise<TenantScreeningSubmitResult> {
    const vendorOrderRef = `certn-order-${randomUUID()}`;
    const products = req.packageProductCodes.map((code) => {
      const reportKind = PRODUCT_TO_KIND[code] ?? 'identity';
      const vendorReportId = `certn-rpt-${code}-${randomUUID()}`;
      stubReportStore.set(vendorReportId, {
        status: 'pending',
        derivedSummary: {},
        orderRef: vendorOrderRef,
        reportKind,
      });
      return {
        productCode: code,
        reportKind,
        vendorReportId,
        status: 'pending' as const,
        costCents: PRODUCT_COST[code] ?? 0,
      };
    });
    return {
      vendor: this.vendorName,
      vendorOrderRef,
      products,
      totalCostCents: products.reduce((s, p) => s + p.costCents, 0),
    };
  }

  async getReportStatus(
    vendorReportId: string,
    _ctx: VendorCallContext,
  ): Promise<TenantScreeningReportStatus> {
    const row = stubReportStore.get(vendorReportId);
    if (!row) {
      return {
        vendorReportId,
        status: 'failed',
        derivedSummary: { error: 'unknown_report' },
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

/** Second TenantScreening impl for config-only vendor swap tests. */
export class AlternateTenantScreening implements TenantScreening {
  readonly vendorName = 'alternate_screening';

  async submitOrder(
    req: TenantScreeningSubmitRequest,
    _ctx: VendorCallContext,
  ): Promise<TenantScreeningSubmitResult> {
    const vendorOrderRef = `alt-order-${randomUUID()}`;
    const products = req.packageProductCodes.map((code) => {
      const reportKind = PRODUCT_TO_KIND[code] ?? 'identity';
      const vendorReportId = `alt-rpt-${code}-${randomUUID()}`;
      stubReportStore.set(vendorReportId, {
        status: 'complete',
        derivedSummary: { vendor: 'alternate', product: code },
        issuedAt: new Date(),
        orderRef: vendorOrderRef,
        reportKind,
      });
      return {
        productCode: code,
        reportKind,
        vendorReportId,
        status: 'complete' as const,
        costCents: PRODUCT_COST[code] ?? 0,
      };
    });
    return {
      vendor: this.vendorName,
      vendorOrderRef,
      products,
      totalCostCents: products.reduce((s, p) => s + p.costCents, 0),
    };
  }

  async getReportStatus(
    vendorReportId: string,
    _ctx: VendorCallContext,
  ): Promise<TenantScreeningReportStatus> {
    const row = stubReportStore.get(vendorReportId);
    if (!row) {
      return { vendorReportId, status: 'failed', derivedSummary: {} };
    }
    return {
      vendorReportId,
      status: row.status,
      derivedSummary: row.derivedSummary,
      issuedAt: row.issuedAt,
    };
  }
}

export class StubESign implements ESign {
  readonly vendorName = 'stub_esign';

  async send(req: ESignRequest, _ctx: VendorCallContext): Promise<ESignResult> {
    const envelopeId = `env-${createHash('sha256').update(req.documentRef).digest('hex').slice(0, 16)}`;
    if (req.completeImmediately) {
      return {
        vendor: this.vendorName,
        envelopeId,
        status: 'completed',
        completedDocumentBytes: Buffer.from(
          `signed-doc:${req.documentRef}:signer:${req.signerPartyId}`,
          'utf8',
        ),
        auditCertificateBytes: Buffer.from(
          `audit-cert:${envelopeId}:${req.signerPartyId}`,
          'utf8',
        ),
      };
    }
    return {
      vendor: this.vendorName,
      envelopeId,
      status: 'sent',
    };
  }
}

/** D-14 — stub only; no Skyflow/Basis Theory choice. */
export class StubVaultTokenizer implements VaultTokenizer {
  readonly vendorName = 'vault_stub';

  async acceptAlias(req: VaultTokenizeRequest): Promise<VaultTokenizeResult> {
    if (!req.aliasToken || req.aliasToken.length < 8) {
      throw new Error('invalid vault alias token');
    }
    // Deterministic fingerprint from alias — never reverse to SSN.
    const identityFingerprint = createHash('sha256')
      .update(`vault-alias:${req.aliasToken}`)
      .digest('hex');
    return { identityFingerprint };
  }
}

/** P10 — Stripe stub; zero network. */
export class StubStripePaymentRail implements PaymentRail {
  readonly vendorName = 'stripe_stub';

  async createCharge(req: StripeChargeRequest): Promise<StripeChargeResult> {
    if (req.forceFailure) {
      return {
        provider: 'stripe',
        chargeId: `ch_fail_${createHash('sha256').update(req.idempotencyKey).digest('hex').slice(0, 12)}`,
        amountCents: req.amountCents,
        feeCents: 0,
        status: 'failed',
        failureCode: 'card_declined',
      };
    }
    const chargeId = `ch_${createHash('sha256').update(req.idempotencyKey).digest('hex').slice(0, 24)}`;
    const feeCents = Math.max(30, Math.round(req.amountCents * 0.029) + 30);
    const txn: StripeBalanceTransaction = {
      id: `txn_${chargeId}`,
      chargeId,
      amountCents: req.amountCents,
      feeCents,
      netCents: req.amountCents - feeCents,
      createdAt: new Date(),
      type: 'charge',
    };
    stubStripeBalanceTxns.push(txn);
    return {
      provider: 'stripe',
      chargeId,
      amountCents: req.amountCents,
      feeCents,
      status: 'succeeded',
    };
  }

  async createPayoutDestination(req: {
    partyId: string;
    destinationToken: string;
  }): Promise<string> {
    return `pm_${createHash('sha256')
      .update(`${req.partyId}:${req.destinationToken}`)
      .digest('hex')
      .slice(0, 24)}`;
  }

  async createPayout(req: {
    amountCents: number;
    payoutMethodRef: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
    forceFailure?: boolean;
  }): Promise<{
    provider: 'stripe';
    payoutId: string;
    amountCents: number;
    status: 'paid' | 'failed';
    failureCode?: string;
  }> {
    if (req.forceFailure) {
      return {
        provider: 'stripe',
        payoutId: `po_fail_${createHash('sha256').update(req.idempotencyKey).digest('hex').slice(0, 12)}`,
        amountCents: req.amountCents,
        status: 'failed',
        failureCode: 'payout_failed',
      };
    }
    const payoutId = `po_${createHash('sha256').update(req.idempotencyKey).digest('hex').slice(0, 24)}`;
    return {
      provider: 'stripe',
      payoutId,
      amountCents: req.amountCents,
      status: 'paid',
    };
  }

  verifyWebhookSignature(envelope: StripeWebhookEnvelope, secret: string): boolean {
    const expected = createHash('sha256')
      .update(`${secret}:${envelope.providerEventId}:${envelope.eventType}`)
      .digest('hex');
    return envelope.signature === expected || envelope.signature === 'stub-valid';
  }

  async listBalanceTransactions(
    periodStart: Date,
    periodEnd: Date,
  ): Promise<StripeBalanceTransaction[]> {
    return stubStripeBalanceTxns.filter(
      (t) => t.createdAt >= periodStart && t.createdAt < periodEnd,
    );
  }
}
