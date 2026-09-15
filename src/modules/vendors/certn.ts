import {
  createHmac,
  createHash,
  timingSafeEqual,
  randomBytes,
} from 'node:crypto';
import type {
  TenantScreening,
  TenantScreeningReportStatus,
  TenantScreeningSubmitRequest,
  TenantScreeningSubmitResult,
  VendorCallContext,
} from './types.js';
import { AppError } from '../shared/errors.js';

export type CertnHttpFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type CertnSandboxConfig = {
  apiKey: string;
  baseUrl: string;
  /** Sandbox-only check types. Never invent RS-tier → SKU mapping here. */
  checkTypes: string[];
  timeoutMs?: number;
  fetchImpl?: CertnHttpFetch;
  /** Optional applicant email for invite path; tests inject. */
  resolveApplicantEmail?: (
    req: TenantScreeningSubmitRequest,
    ctx: VendorCallContext,
  ) => Promise<string> | string;
};

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Live CertnCentric sandbox adapter behind TenantScreening.
 * Product/SKU selection is env/config only — not RS-tier business logic.
 */
export class CertnSandboxTenantScreening implements TenantScreening {
  readonly vendorName = 'certn';
  private readonly cfg: CertnSandboxConfig;
  private readonly fetchImpl: CertnHttpFetch;
  private readonly timeoutMs: number;

  constructor(cfg: CertnSandboxConfig) {
    if (!cfg.apiKey) {
      throw new Error('CERTN_API_KEY required for certn sandbox adapter');
    }
    if (!cfg.baseUrl) {
      throw new Error('CERTN_BASE_URL required for certn sandbox adapter');
    }
    if (!cfg.checkTypes.length) {
      throw new Error(
        'CERTN_SANDBOX_CHECK_TYPES required — do not invent RS-tier→Certn SKU mapping',
      );
    }
    this.cfg = cfg;
    this.fetchImpl = cfg.fetchImpl ?? (globalThis.fetch as CertnHttpFetch);
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async submitOrder(
    req: TenantScreeningSubmitRequest,
    ctx: VendorCallContext,
  ): Promise<TenantScreeningSubmitResult> {
    const email =
      (await this.cfg.resolveApplicantEmail?.(req, ctx)) ??
      `applicant+${req.partyId.slice(0, 8)}@sandbox.rbit.invalid`;

    const check_types_with_arguments: Record<string, Record<string, never>> = {};
    for (const t of this.cfg.checkTypes) {
      check_types_with_arguments[t] = {};
    }

    const body = {
      email_address: email,
      send_invite_email: false,
      external_id: ctx.applicationId ?? ctx.screeningOrderId ?? ctx.correlationId,
      check_types_with_arguments,
    };

    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/public/cases/order/`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let raw: string;
    let status: number;
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Api-Key ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      status = res.status;
      raw = await res.text();
      if (!res.ok) {
        throw new AppError(
          `certn sandbox order failed (${status})`,
          'certn_order_failed',
          502,
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        'certn sandbox request failed or timed out',
        'certn_unavailable',
        502,
      );
    } finally {
      clearTimeout(timer);
    }

    let parsed: {
      id?: string;
      checks?: Array<{ id: string; type?: string; status?: string }>;
    };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      throw new AppError('certn sandbox returned invalid JSON', 'certn_invalid_response', 502);
    }
    if (!parsed.id) {
      throw new AppError('certn sandbox response missing case id', 'certn_invalid_response', 502);
    }

    const products = (parsed.checks ?? this.cfg.checkTypes.map((t, i) => ({
      id: `${parsed.id}-check-${i}`,
      type: t,
      status: 'PENDING',
    }))).map((check, i) => ({
      productCode: req.packageProductCodes[i] ?? check.type ?? this.cfg.checkTypes[i]!,
      reportKind: mapReportKind(check.type ?? this.cfg.checkTypes[i] ?? 'unknown'),
      vendorReportId: check.id,
      status: 'pending' as const,
      costCents: 0,
    }));

    return {
      vendor: this.vendorName,
      vendorOrderRef: parsed.id,
      products,
      totalCostCents: products.reduce((s, p) => s + p.costCents, 0),
    };
  }

  async getReportStatus(
    vendorReportId: string,
    _ctx: VendorCallContext,
  ): Promise<TenantScreeningReportStatus> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/public/checks/${vendorReportId}/`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Api-Key ${this.cfg.apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new AppError(
          `certn sandbox report status failed (${res.status})`,
          'certn_status_failed',
          502,
        );
      }
      const parsed = JSON.parse(raw) as { status?: string };
      return {
        vendorReportId,
        status: mapCertnStatus(parsed.status),
        derivedSummary: { vendor_status: parsed.status ?? null },
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        'certn sandbox status request failed or timed out',
        'certn_unavailable',
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function mapCertnStatus(status?: string): 'pending' | 'complete' | 'failed' {
  const s = (status ?? '').toUpperCase();
  if (s === 'COMPLETE' || s === 'COMPLETED' || s === 'CLEAR') return 'complete';
  if (s === 'FAILED' || s === 'CANCELLED' || s === 'ERROR') return 'failed';
  return 'pending';
}

function mapReportKind(
  checkType: string,
): 'identity' | 'credit' | 'criminal' | 'risk_insight' | 'income' {
  const t = checkType.toUpperCase();
  if (t.includes('CREDIT')) return 'credit';
  if (t.includes('CRIMINAL') || t.includes('SOFTCHECK')) return 'criminal';
  if (t.includes('INCOME')) return 'income';
  if (t.includes('RISK')) return 'risk_insight';
  return 'identity';
}

/**
 * CertnCentric webhook signature: HMAC-SHA256 hex of raw body, header X-Signature.
 */
export function verifyCertnWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.trim().toLowerCase();
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Test helper — produce a valid X-Signature for a raw body. */
export function signCertnWebhookBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function createCertnSandboxFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: CertnHttpFetch,
): CertnSandboxTenantScreening {
  const checkTypes = (env.CERTN_SANDBOX_CHECK_TYPES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new CertnSandboxTenantScreening({
    apiKey: env.CERTN_API_KEY ?? '',
    baseUrl: env.CERTN_BASE_URL ?? 'https://api.sandbox.certn.co',
    checkTypes,
    fetchImpl,
  });
}

/** Unused helpers kept private-tree free of lint noise for token entropy tests. */
export function randomOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
