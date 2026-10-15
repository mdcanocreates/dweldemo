import { AppError } from '../../shared/errors.js';
import { assessCheckrAvailability } from './availability.js';
import type {
  CheckrCreateOrderRequest,
  CheckrHttpFetch,
  CheckrOrder,
  CheckrReport,
  CheckrApiErrorBody,
} from './types.js';

export type CheckrTenantClientConfig = {
  apiKey: string;
  apiUrl: string;
  apiVersion: string;
  mode: 'test' | 'live';
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: CheckrHttpFetch;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactForLog(value: string): string {
  // Never log API keys or SSN-shaped values.
  return value
    .replace(/ckr_sk_(live|test)_[A-Za-z0-9]+/g, 'ckr_sk_***')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '***-**-****')
    .replace(/\b\d{9}\b/g, '*********');
}

/**
 * Server-side Checkr Tenant HTTP adapter.
 * Credentials never leave the process; fail closed on invalid config.
 */
export class CheckrTenantClient {
  readonly vendorName = 'checkr_tenant';
  private readonly cfg: CheckrTenantClientConfig;
  private readonly fetchImpl: CheckrHttpFetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(cfg: CheckrTenantClientConfig) {
    if (!cfg.apiKey) {
      throw new AppError('Checkr API key required', 'checkr_config_invalid', 503);
    }
    if (!cfg.apiUrl) {
      throw new AppError('Checkr API URL required', 'checkr_config_invalid', 503);
    }
    if (!cfg.apiVersion) {
      throw new AppError('Checkr API version required', 'checkr_config_invalid', 503);
    }
    if (cfg.mode === 'live' && !cfg.apiKey.startsWith('ckr_sk_live_')) {
      throw new AppError(
        'live mode requires a live Checkr key',
        'checkr_live_key_required',
        503,
      );
    }
    if (cfg.mode === 'test' && cfg.apiKey.startsWith('ckr_sk_live_')) {
      throw new AppError(
        'live Checkr keys rejected outside approved production',
        'checkr_live_key_rejected',
        503,
      );
    }
    this.cfg = cfg;
    this.fetchImpl = cfg.fetchImpl ?? (globalThis.fetch as CheckrHttpFetch);
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = cfg.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  get mode(): 'test' | 'live' {
    return this.cfg.mode;
  }

  async createOrder(
    body: CheckrCreateOrderRequest,
    opts: { idempotencyKey: string },
  ): Promise<CheckrOrder> {
    // Test mode does not support payer: applicant.
    if (this.cfg.mode === 'test' && body.order.payer === 'applicant') {
      throw new AppError(
        'payer applicant not supported in Checkr test mode',
        'checkr_validation_error',
        422,
      );
    }
    const payload: CheckrCreateOrderRequest = {
      order: {
        ...body.order,
        payer: this.cfg.mode === 'test' ? 'organization' : (body.order.payer ?? 'organization'),
      },
    };
    return this.requestJson<CheckrOrder>('POST', '/orders', {
      body: payload,
      idempotencyKey: opts.idempotencyKey,
      expectedStatus: 201,
    });
  }

  async getOrder(orderId: string, include?: string[]): Promise<CheckrOrder> {
    const qs =
      include && include.length > 0
        ? `?include=${encodeURIComponent(include.join(','))}`
        : '';
    return this.requestJson<CheckrOrder>('GET', `/orders/${encodeURIComponent(orderId)}${qs}`);
  }

  async getOrderReport(orderId: string): Promise<CheckrReport> {
    return this.requestJson<CheckrReport>(
      'GET',
      `/orders/${encodeURIComponent(orderId)}/report`,
    );
  }

  async getReport(reportId: string): Promise<CheckrReport> {
    return this.requestJson<CheckrReport>('GET', `/reports/${encodeURIComponent(reportId)}`);
  }

  async getReportPdf(reportId: string): Promise<Buffer> {
    return this.requestBinary('GET', `/reports/${encodeURIComponent(reportId)}/pdf`);
  }

  async getReportDocumentsZip(reportId: string): Promise<Buffer> {
    return this.requestBinary(
      'GET',
      `/reports/${encodeURIComponent(reportId)}/documents/zip`,
    );
  }

  async getReportDocument(reportId: string, documentId: string): Promise<Buffer> {
    return this.requestBinary(
      'GET',
      `/reports/${encodeURIComponent(reportId)}/documents/${encodeURIComponent(documentId)}/download`,
    );
  }

  private baseUrl(): string {
    return this.cfg.apiUrl.replace(/\/$/, '');
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      Accept: 'application/json',
      'Checkr-Tenant-Version': this.cfg.apiVersion,
      'User-Agent': 'DwelCheckrTenant/1',
    };
    if (idempotencyKey) {
      h['Idempotency-Key'] = idempotencyKey;
    }
    return h;
  }

  private async requestJson<T>(
    method: string,
    path: string,
    opts?: {
      body?: unknown;
      idempotencyKey?: string;
      expectedStatus?: number;
    },
  ): Promise<T> {
    const raw = await this.requestRaw(method, path, {
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      idempotencyKey: opts?.idempotencyKey,
      contentType: 'application/json',
    });
    if (opts?.expectedStatus != null && raw.status !== opts.expectedStatus && raw.ok) {
      // Some endpoints return 200 for create in edge cases — accept 2xx.
    }
    if (!raw.ok) {
      throw this.mapError(raw.status, raw.text);
    }
    try {
      return JSON.parse(raw.text) as T;
    } catch {
      throw new AppError('Checkr returned invalid JSON', 'checkr_invalid_response', 502);
    }
  }

  private async requestBinary(method: string, path: string): Promise<Buffer> {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= this.maxRetries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(`${this.baseUrl()}${path}`, {
          method,
          headers: {
            ...this.headers(),
            Accept: 'application/pdf, application/zip, application/octet-stream',
          },
          signal: controller.signal,
        });
        if (res.status === 429 || res.status >= 500) {
          attempt += 1;
          if (attempt > this.maxRetries) {
            throw this.mapError(res.status, await res.text());
          }
          await sleep(200 * 2 ** (attempt - 1));
          continue;
        }
        if (!res.ok) {
          throw this.mapError(res.status, await res.text());
        }
        const buf = Buffer.from(await res.arrayBuffer());
        return buf;
      } catch (err) {
        lastErr = err;
        if (err instanceof AppError) throw err;
        attempt += 1;
        if (attempt > this.maxRetries) break;
        await sleep(200 * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timer);
      }
    }
    void lastErr;
    throw new AppError('Checkr request failed or timed out', 'checkr_unavailable', 502);
  }

  private async requestRaw(
    method: string,
    path: string,
    opts: {
      body?: string;
      idempotencyKey?: string;
      contentType?: string;
    },
  ): Promise<{ ok: boolean; status: number; text: string }> {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= this.maxRetries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers = this.headers(opts.idempotencyKey);
        if (opts.contentType && opts.body !== undefined) {
          headers['Content-Type'] = opts.contentType;
        }
        const res = await this.fetchImpl(`${this.baseUrl()}${path}`, {
          method,
          headers,
          body: opts.body,
          signal: controller.signal,
        });
        const text = await res.text();
        // Retry transient failures (not 4xx except 429).
        if (res.status === 429 || res.status >= 500) {
          attempt += 1;
          if (attempt > this.maxRetries) {
            return { ok: false, status: res.status, text };
          }
          await sleep(200 * 2 ** (attempt - 1));
          continue;
        }
        return { ok: res.ok, status: res.status, text };
      } catch (err) {
        lastErr = err;
        attempt += 1;
        if (attempt > this.maxRetries) break;
        await sleep(200 * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timer);
      }
    }
    void redactForLog(String(lastErr ?? ''));
    throw new AppError('Checkr request failed or timed out', 'checkr_unavailable', 502);
  }

  private mapError(status: number, raw: string): AppError {
    let type = 'checkr_api_error';
    let message = `Checkr API error (${status})`;
    try {
      const parsed = JSON.parse(raw) as CheckrApiErrorBody;
      const err = parsed.error ?? parsed.errors?.[0];
      if (err?.type) type = `checkr_${err.type}`;
      if (err?.message) message = err.message;
    } catch {
      /* keep defaults — do not echo raw body (may contain PII) */
    }
    const httpStatus =
      status === 401 || status === 403
        ? 502
        : status === 404
          ? 404
          : status === 422
            ? 422
            : status === 402
              ? 402
              : 502;
    return new AppError(message, type, httpStatus);
  }
}

export function createCheckrTenantClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: CheckrHttpFetch,
): CheckrTenantClient {
  const availability = assessCheckrAvailability(env);
  if (!availability.available) {
    throw new AppError(
      `Checkr not available: ${availability.reason}`,
      'SCREENING_PROVIDER_UNAVAILABLE',
      503,
    );
  }
  return new CheckrTenantClient({
    apiKey: env.CHECKR_TENANT_API_KEY!.trim(),
    apiUrl: (env.CHECKR_TENANT_API_URL ?? 'https://tenant.checkr.com/api').trim(),
    apiVersion: (env.CHECKR_TENANT_API_VERSION ?? '2026-04-29').trim(),
    mode: availability.mode,
    fetchImpl,
  });
}
