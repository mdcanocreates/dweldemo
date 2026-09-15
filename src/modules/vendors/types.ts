/**
 * P10 — Vendor capability interfaces. No vendor SDK type crosses this boundary.
 */

export type VendorCallContext = {
  correlationId: string;
  applicationId?: string;
  screeningOrderId?: string;
  partyId: string;
  requestId?: string;
};

export type IdentityVerificationRequest = {
  partyId: string;
  /** Vendor-hosted Path A subject; never an SSN. */
  vendorSubjectId?: string;
  /** Vault alias token only (Path B); never raw SSN. */
  identityFingerprint?: string;
};

export type IdentityVerificationResult = {
  vendor: string;
  vendorReportId: string;
  status: 'pending' | 'complete' | 'failed';
  verified: boolean;
  derivedSummary: Record<string, unknown>;
  costCents: number;
  syntheticIdentityFlag?: boolean;
};

export interface IdentityVerification {
  readonly vendorName: string;
  verify(
    req: IdentityVerificationRequest,
    ctx: VendorCallContext,
  ): Promise<IdentityVerificationResult>;
}

export type IncomeVerificationRequest = {
  partyId: string;
  method: 'plaid_bank' | 'plaid_payroll' | 'vendor_payroll' | 'document' | 'stated';
  /** Opaque vendor link / token — never account numbers in our logs. */
  vendorLinkRef?: string;
  statedMonthlyIncomeCents?: number;
};

export type IncomeVerificationResult = {
  vendor: string;
  vendorRef: string;
  method: IncomeVerificationRequest['method'];
  status: 'pending' | 'complete' | 'failed';
  monthlyIncomeCents: number | null;
  confidence: number;
  costCents: number;
};

export interface IncomeVerification {
  readonly vendorName: string;
  verify(
    req: IncomeVerificationRequest,
    ctx: VendorCallContext,
  ): Promise<IncomeVerificationResult>;
}

export type ScreeningProductCode =
  | 'oneid'
  | 'criminal_tier_1'
  | 'credit_equifax'
  | 'risk_insight'
  | 'income';

export type TenantScreeningSubmitRequest = {
  partyId: string;
  packageProductCodes: string[];
  vendorSubjectId?: string;
  identityFingerprint?: string;
};

export type TenantScreeningSubmitResult = {
  vendor: string;
  vendorOrderRef: string;
  products: Array<{
    productCode: string;
    reportKind: 'identity' | 'credit' | 'criminal' | 'risk_insight' | 'income';
    vendorReportId: string;
    status: 'pending' | 'complete' | 'failed';
    costCents: number;
  }>;
  totalCostCents: number;
};

export type TenantScreeningReportStatus = {
  vendorReportId: string;
  status: 'pending' | 'complete' | 'failed';
  derivedSummary: Record<string, unknown>;
  issuedAt?: Date;
};

export interface TenantScreening {
  readonly vendorName: string;
  submitOrder(
    req: TenantScreeningSubmitRequest,
    ctx: VendorCallContext,
  ): Promise<TenantScreeningSubmitResult>;
  getReportStatus(
    vendorReportId: string,
    ctx: VendorCallContext,
  ): Promise<TenantScreeningReportStatus>;
}

export type ESignRequest = {
  documentRef: string;
  signerPartyId: string;
  /** When true, stub completes immediately with document + audit certificate bytes. */
  completeImmediately?: boolean;
};

export type ESignResult = {
  vendor: string;
  envelopeId: string;
  status: 'sent' | 'completed' | 'declined' | 'voided';
  /** Opaque completed document bytes — stored via Documents module, never logged. */
  completedDocumentBytes?: Buffer;
  /** Audit certificate bytes — stored as a separate document. */
  auditCertificateBytes?: Buffer;
};

export interface ESign {
  readonly vendorName: string;
  send(req: ESignRequest, ctx: VendorCallContext): Promise<ESignResult>;
}

/**
 * D-14 BLOCKED — Skyflow vs Basis Theory unresolved.
 * Interface + stub only; no vendor choice in code.
 */
export type VaultTokenizeRequest = {
  /** Browser-side vault SDK would send SSN to vault; we only ever receive aliases. */
  aliasToken: string;
};

export type VaultTokenizeResult = {
  identityFingerprint: string;
};

export interface VaultTokenizer {
  readonly vendorName: string;
  /**
   * Accepts a pre-minted alias from the vault JS SDK (Path B).
   * RBIT never receives raw SSN and has no detokenization path.
   */
  acceptAlias(req: VaultTokenizeRequest): Promise<VaultTokenizeResult>;
}

/** P10 — Stripe payment rail. No Stripe SDK types cross module boundaries. */
export type StripeChargeRequest = {
  amountCents: number;
  currency?: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
  /** Test harness: force failure without network. */
  forceFailure?: boolean;
};

export type StripeChargeResult = {
  provider: 'stripe';
  chargeId: string;
  amountCents: number;
  feeCents: number;
  status: 'succeeded' | 'failed';
  failureCode?: string;
};

export type StripeBalanceTransaction = {
  id: string;
  chargeId: string | null;
  amountCents: number;
  feeCents: number;
  netCents: number;
  createdAt: Date;
  type: string;
};

export type StripeWebhookEnvelope = {
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  signature: string;
};

/** Opaque payout destination — collected at payout time, never at intake (§7.8 / §13.6). */
export type StripePayoutDestinationRequest = {
  partyId: string;
  destinationToken: string;
};

export type StripePayoutRequest = {
  amountCents: number;
  payoutMethodRef: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
  forceFailure?: boolean;
};

export type StripePayoutResult = {
  provider: 'stripe';
  payoutId: string;
  amountCents: number;
  status: 'paid' | 'failed';
  failureCode?: string;
};

export interface PaymentRail {
  readonly vendorName: string;
  createCharge(req: StripeChargeRequest): Promise<StripeChargeResult>;
  createPayoutDestination(req: StripePayoutDestinationRequest): Promise<string>;
  createPayout(req: StripePayoutRequest): Promise<StripePayoutResult>;
  verifyWebhookSignature(envelope: StripeWebhookEnvelope, secret: string): boolean;
  /** Stub/fixture pull — never live network in CI. */
  listBalanceTransactions(periodStart: Date, periodEnd: Date): Promise<StripeBalanceTransaction[]>;
}
