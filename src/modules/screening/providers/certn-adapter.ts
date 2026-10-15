import {
  createCertnSandboxFromEnv,
  verifyCertnWebhookSignature,
  type CertnHttpFetch,
} from '../../vendors/certn.js';
import { assessCertnAvailability } from '../../vendors/certn-availability.js';
import { AppError } from '../../shared/errors.js';
import type {
  CreateScreeningRequestInput,
  CreateScreeningRequestResult,
  ScreeningProvider,
  ScreeningRequestStatus,
  ScreeningResults,
  WebhookIngestInput,
  WebhookIngestResult,
  NormalizedScreeningStatus,
} from './types.js';

/**
 * Certn adapter behind the provider-agnostic ScreeningProvider contract.
 * Preserves existing Certn sandbox behavior; does not invent SKU mappings.
 */
export class CertnAdapter implements ScreeningProvider {
  readonly providerId = 'certn' as const;
  readonly displayName = 'Certn';

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl?: CertnHttpFetch,
  ) {}

  isInfrastructureReady(): boolean {
    return assessCertnAvailability(this.env).available;
  }

  async createScreeningRequest(
    input: CreateScreeningRequestInput,
  ): Promise<CreateScreeningRequestResult> {
    if (!this.isInfrastructureReady()) {
      throw new AppError('Certn not configured', 'SCREENING_PROVIDER_UNAVAILABLE', 503);
    }
    const adapter = createCertnSandboxFromEnv(this.env, this.fetchImpl);
    const result = await adapter.submitOrder(
      {
        partyId: input.partyId,
        packageProductCodes: input.packageHint ? [input.packageHint] : ['oneid'],
      },
      {
        correlationId: input.correlationId,
        applicationId: input.applicationId,
        partyId: input.partyId,
      },
    );

    const productStatuses: CreateScreeningRequestResult['productStatuses'] = {};
    for (const p of result.products) {
      productStatuses[p.productCode] = { status: p.status, result: null };
    }

    return {
      provider: 'certn',
      providerOrderId: result.vendorOrderRef,
      providerReportId: result.products[0]?.vendorReportId ?? null,
      status: 'processing',
      applicationUrl: null, // CertnCentric invite path not exposed as hosted URL here
      environment: 'sandbox',
      productStatuses,
      providerMetadata: {
        vendor: result.vendor,
        product_count: result.products.length,
        // Never include applicant PII
      },
    };
  }

  async getRequestStatus(providerOrderId: string): Promise<ScreeningRequestStatus> {
    return {
      provider: 'certn',
      providerOrderId,
      status: 'processing',
      applicationUrl: null,
      providerMetadata: {},
    };
  }

  async getScreeningResults(providerOrderId: string): Promise<ScreeningResults> {
    if (!this.isInfrastructureReady()) {
      throw new AppError('Certn not configured', 'SCREENING_PROVIDER_UNAVAILABLE', 503);
    }
    const adapter = createCertnSandboxFromEnv(this.env, this.fetchImpl);
    // Certn reports are per-check; use order id as report key when polling packages.
    let status: 'pending' | 'complete' | 'failed' = 'pending';
    let summary: Record<string, unknown> = {};
    try {
      const report = await adapter.getReportStatus(providerOrderId, {
        correlationId: providerOrderId,
        partyId: 'unknown',
      });
      status = report.status;
      summary = report.derivedSummary;
    } catch {
      status = 'pending';
    }

    const normalized = status === 'complete' ? 'completed' : status === 'failed' ? 'failed' : 'processing';
    return {
      provider: 'certn',
      providerOrderId,
      providerReportId: providerOrderId,
      status: normalized,
      overallResult: status === 'complete' ? 'clear' : 'pending',
      products: {
        certn_case: {
          status,
          result: status === 'complete' ? 'clear' : 'pending',
        },
      },
      reviewRequired: false,
      providerMetadata: summary,
    };
  }

  async getApplicationUrl(_providerOrderId: string): Promise<string | null> {
    return null;
  }

  async downloadReportPdf(_providerReportId: string): Promise<Buffer> {
    throw new AppError(
      'Certn PDF download not available via this adapter',
      'certn_pdf_unsupported',
      501,
    );
  }

  async verifyAndIngestWebhook(input: WebhookIngestInput): Promise<WebhookIngestResult> {
    if (!input.rawBody.trim()) {
      return { accepted: true, duplicate: false, probe: true, providerEventId: null, eventType: null };
    }
    const valid = verifyCertnWebhookSignature(
      input.rawBody,
      input.signatureHeader,
      input.signingSecret,
    );
    if (!valid) {
      return {
        accepted: false,
        duplicate: false,
        probe: false,
        providerEventId: null,
        eventType: null,
      };
    }
    let eventId: string | null = null;
    let eventType: string | null = null;
    let envelope: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(input.rawBody) as Record<string, unknown>;
      envelope = parsed;
      eventId = String(parsed.event_id ?? parsed.id ?? '');
      eventType = String(parsed.event_type ?? parsed.type ?? 'unknown');
      if (!eventId) eventId = null;
    } catch {
      return {
        accepted: false,
        duplicate: false,
        probe: false,
        providerEventId: null,
        eventType: null,
      };
    }
    return {
      accepted: true,
      duplicate: false,
      probe: false,
      providerEventId: eventId,
      eventType,
      envelope,
    };
  }

  normalizeStatus(providerStatus: string): NormalizedScreeningStatus {
    const s = providerStatus.toUpperCase();
    if (s === 'COMPLETE' || s === 'COMPLETED' || s === 'CLEAR') return 'completed';
    if (s === 'FAILED' || s === 'ERROR') return 'failed';
    if (s === 'CANCELLED' || s === 'CANCELED') return 'canceled';
    if (s === 'PENDING' || s === 'IN_PROGRESS') return 'processing';
    return 'processing';
  }
}

export function createCertnAdapter(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: CertnHttpFetch,
): CertnAdapter {
  return new CertnAdapter(env, fetchImpl);
}
