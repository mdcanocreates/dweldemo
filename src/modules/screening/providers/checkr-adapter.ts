import {
  createCheckrTenantClientFromEnv,
  sanitizeReportSummary,
  verifyCheckrTenantSignature,
  type CheckrHttpFetch,
  type CheckrPackageSlug,
} from '../../vendors/checkr/index.js';
import { assessCheckrAvailability } from '../../vendors/checkr/availability.js';
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
 * Checkr Tenant adapter behind the provider-agnostic ScreeningProvider contract.
 */
export class CheckrTenantAdapter implements ScreeningProvider {
  readonly providerId = 'checkr_tenant' as const;
  readonly displayName = 'Checkr Tenant';

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl?: CheckrHttpFetch,
  ) {}

  isInfrastructureReady(): boolean {
    return assessCheckrAvailability(this.env).available;
  }

  async createScreeningRequest(
    input: CreateScreeningRequestInput,
  ): Promise<CreateScreeningRequestResult> {
    if (!this.isInfrastructureReady()) {
      throw new AppError('Checkr not configured', 'SCREENING_PROVIDER_UNAVAILABLE', 503);
    }
    const availability = assessCheckrAvailability(this.env);
    if (!availability.available) {
      throw new AppError('Checkr not configured', 'SCREENING_PROVIDER_UNAVAILABLE', 503);
    }
    const client = createCheckrTenantClientFromEnv(this.env, this.fetchImpl);
    const pkg = (input.packageHint as CheckrPackageSlug | undefined) ?? 'essential';
    const order = await client.createOrder(
      {
        order: {
          package: ['starter', 'essential', 'complete'].includes(pkg) ? pkg : 'essential',
          payer: 'organization',
          property: {
            name: input.property.name,
            street: input.property.street,
            unit: input.property.unit,
            city: input.property.city,
            state: input.property.state,
            zipcode: input.property.zipcode,
          },
          applicant: {
            email: input.applicant.email,
            ...(input.applicant.firstName
              ? { first_name: input.applicant.firstName, last_name: input.applicant.lastName ?? 'Unknown' }
              : {}),
            ...(input.applicant.dob ? { dob: input.applicant.dob } : {}),
            ...(input.applicant.ssn ? { ssn: input.applicant.ssn } : {}),
            ...(input.applicant.phone ? { phone_number: input.applicant.phone } : {}),
          },
          ...(input.originalRequester
            ? {
                original_requester: {
                  external_id: input.originalRequester.externalId,
                  type: input.originalRequester.type,
                  name: input.originalRequester.name,
                  email: input.originalRequester.email,
                },
              }
            : {}),
        },
      },
      { idempotencyKey: input.idempotencyKey },
    );

    const status = this.normalizeStatus(order.status);
    return {
      provider: 'checkr_tenant',
      providerOrderId: order.id,
      providerReportId: null,
      providerApplicantId: order.applicant_id,
      providerPropertyId: order.property_id,
      status:
        order.application_url || order.status === 'waiting_for_applicant'
          ? 'awaiting_applicant'
          : status,
      applicationUrl: order.application_url ?? null,
      environment: availability.mode === 'live' ? 'live' : 'test',
      productStatuses: {},
      providerMetadata: {
        live_mode: order.live_mode,
        package: order.package,
        payer: order.payer,
      },
    };
  }

  async getRequestStatus(providerOrderId: string): Promise<ScreeningRequestStatus> {
    const client = createCheckrTenantClientFromEnv(this.env, this.fetchImpl);
    const order = await client.getOrder(providerOrderId);
    return {
      provider: 'checkr_tenant',
      providerOrderId: order.id,
      status: this.normalizeStatus(order.status),
      applicationUrl: order.application_url ?? null,
      providerMetadata: { live_mode: order.live_mode, package: order.package },
    };
  }

  async getScreeningResults(providerOrderId: string): Promise<ScreeningResults> {
    const client = createCheckrTenantClientFromEnv(this.env, this.fetchImpl);
    let report;
    try {
      report = await client.getOrderReport(providerOrderId);
    } catch (err) {
      if (err instanceof AppError && err.status === 404) {
        return {
          provider: 'checkr_tenant',
          providerOrderId,
          providerReportId: null,
          status: 'processing',
          overallResult: 'pending',
          products: {},
          reviewRequired: false,
          providerMetadata: {},
        };
      }
      throw err;
    }
    const summary = sanitizeReportSummary(report as Record<string, unknown>);
    const productsRaw = (summary.products as Record<string, unknown>) ?? {};
    const products: ScreeningResults['products'] = {};
    let reviewRequired = false;
    for (const [k, v] of Object.entries(productsRaw)) {
      if (!v || typeof v !== 'object') continue;
      const item = v as {
        status?: string | null;
        result?: string | null;
        consider_reasons?: Array<{ category?: string | null; label?: string | null }>;
      };
      if (item.result === 'consider') reviewRequired = true;
      products[k] = {
        status: item.status ?? null,
        result: item.result ?? null,
        considerReasons: (item.consider_reasons ?? []).map((r) => ({
          category: r?.category ?? null,
          label: r?.label ?? null,
        })),
      };
    }
    const overall =
      (summary.result as string | null | undefined) ??
      (reviewRequired ? 'consider' : 'clear');
    if (overall === 'consider') reviewRequired = true;

    return {
      provider: 'checkr_tenant',
      providerOrderId,
      providerReportId: String(report.id ?? ''),
      status: 'completed',
      overallResult: overall,
      products,
      reviewRequired,
      providerMetadata: { report_id: report.id, order_id: report.order_id },
      completedAt: report.completed_at ? new Date(String(report.completed_at)) : null,
    };
  }

  async getApplicationUrl(providerOrderId: string): Promise<string | null> {
    const status = await this.getRequestStatus(providerOrderId);
    return status.applicationUrl ?? null;
  }

  async downloadReportPdf(providerReportId: string): Promise<Buffer> {
    const client = createCheckrTenantClientFromEnv(this.env, this.fetchImpl);
    return client.getReportPdf(providerReportId);
  }

  async verifyAndIngestWebhook(input: WebhookIngestInput): Promise<WebhookIngestResult> {
    if (!input.rawBody.trim()) {
      return { accepted: true, duplicate: false, probe: true, providerEventId: null, eventType: null };
    }
    const verified = verifyCheckrTenantSignature(
      input.rawBody,
      input.signatureHeader,
      input.signingSecret,
    );
    if (!verified.valid) {
      return {
        accepted: false,
        duplicate: false,
        probe: false,
        providerEventId: null,
        eventType: null,
      };
    }
    try {
      const parsed = JSON.parse(input.rawBody) as {
        id?: string;
        type?: string;
        data?: Record<string, unknown>;
      };
      return {
        accepted: true,
        duplicate: false,
        probe: false,
        providerEventId: parsed.id ?? null,
        eventType: parsed.type ?? null,
        envelope: parsed as Record<string, unknown>,
      };
    } catch {
      return {
        accepted: false,
        duplicate: false,
        probe: false,
        providerEventId: null,
        eventType: null,
      };
    }
  }

  normalizeStatus(providerStatus: string): NormalizedScreeningStatus {
    switch (providerStatus) {
      case 'waiting_for_applicant':
        return 'awaiting_applicant';
      case 'pending':
        return 'processing';
      case 'completed':
        return 'completed';
      case 'canceled':
      case 'cancelled':
        return 'canceled';
      default:
        return 'processing';
    }
  }
}

export function createCheckrTenantAdapter(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: CheckrHttpFetch,
): CheckrTenantAdapter {
  return new CheckrTenantAdapter(env, fetchImpl);
}
