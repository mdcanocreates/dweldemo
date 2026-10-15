/**
 * Provider-agnostic screening contract.
 * Application workflow depends on this interface — never on Certn/Checkr types.
 */

export type ScreeningProviderId = 'certn' | 'checkr_tenant';

export type ScreeningProviderSelection = ScreeningProviderId | 'disabled';

/** Normalized sub-status — orthogonal to application leasing status. */
export type NormalizedScreeningStatus =
  | 'not_requested'
  | 'awaiting_applicant'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled';

export type NormalizedProductResult = 'clear' | 'consider' | 'pending' | 'unavailable' | string;

export type ScreeningEnvironment = 'test' | 'live' | 'sandbox';

export type CreateScreeningRequestInput = {
  applicationId: string;
  partyId: string;
  packageHint?: string;
  idempotencyKey: string;
  /** Property address / listing context — adapters map to provider schemas. */
  property: {
    street: string;
    unit?: string | null;
    city: string;
    state: string;
    zipcode: string;
    name?: string | null;
  };
  applicant: {
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    /** Sandbox canned profiles only — never real SSN in production paths. */
    dob?: string;
    ssn?: string;
  };
  /** Platform original requester (report recipient) when supported. */
  originalRequester?: {
    externalId: string;
    type: 'individual' | 'business';
    name: string;
    email?: string;
  };
  correlationId: string;
};

export type CreateScreeningRequestResult = {
  provider: ScreeningProviderId;
  providerOrderId: string;
  providerReportId?: string | null;
  providerApplicantId?: string | null;
  providerPropertyId?: string | null;
  status: NormalizedScreeningStatus;
  applicationUrl?: string | null;
  environment: ScreeningEnvironment;
  productStatuses: Record<string, { status: string; result?: string | null }>;
  /** Sanitized provider-specific bag — never log raw. */
  providerMetadata: Record<string, unknown>;
};

export type ScreeningRequestStatus = {
  provider: ScreeningProviderId;
  providerOrderId: string;
  status: NormalizedScreeningStatus;
  applicationUrl?: string | null;
  providerMetadata: Record<string, unknown>;
};

export type ScreeningResults = {
  provider: ScreeningProviderId;
  providerOrderId: string;
  providerReportId: string | null;
  status: NormalizedScreeningStatus;
  /** Normalized overall — consider never implies auto-reject. */
  overallResult: NormalizedProductResult | null;
  products: Record<
    string,
    {
      status: string | null;
      result: NormalizedProductResult | null;
      considerReasons?: Array<{ category: string | null; label: string | null }>;
    }
  >;
  reviewRequired: boolean;
  /** Provider-specific sanitized metadata preserved separately. */
  providerMetadata: Record<string, unknown>;
  completedAt?: Date | null;
};

export type WebhookIngestInput = {
  rawBody: string;
  signatureHeader?: string | null;
  signingSecret: string;
  headers?: Record<string, string | string[] | undefined>;
};

export type WebhookIngestResult = {
  accepted: boolean;
  duplicate: boolean;
  probe: boolean;
  providerEventId: string | null;
  eventType: string | null;
  /** Parsed envelope for async processing — no secrets. */
  envelope?: Record<string, unknown>;
};

export interface ScreeningProvider {
  readonly providerId: ScreeningProviderId;
  readonly displayName: string;

  /** Infrastructure readiness (env/secrets) — independent of admin default. */
  isInfrastructureReady(): boolean;

  createScreeningRequest(
    input: CreateScreeningRequestInput,
  ): Promise<CreateScreeningRequestResult>;

  getRequestStatus(providerOrderId: string): Promise<ScreeningRequestStatus>;

  getScreeningResults(providerOrderId: string): Promise<ScreeningResults>;

  /** Hosted applicant URL when supported; null if not applicable. */
  getApplicationUrl(providerOrderId: string): Promise<string | null>;

  downloadReportPdf(providerReportId: string): Promise<Buffer>;

  verifyAndIngestWebhook(input: WebhookIngestInput): Promise<WebhookIngestResult>;

  /**
   * Map provider-specific status strings into normalized sub-status.
   * Used for out-of-band polls and webhook processing.
   */
  normalizeStatus(providerStatus: string): NormalizedScreeningStatus;
}
