/**
 * Privacy-first product analytics. Disabled until both the flag and a
 * PostHog project key are present. Never sends secrets or contact fields.
 */

export type AnalyticsProduct = 'lumis' | 'dwel' | 'admin';

const DENY = new Set([
  'email',
  'phone',
  'otp',
  'code',
  'password',
  'token',
  'authorization',
  'cookie',
  'ssn',
  'address',
  'name',
  'secret',
  'session',
]);

export function sanitizeProps(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!input) return out;
  for (const [key, value] of Object.entries(input)) {
    const normalized = key.trim().toLowerCase();
    if (DENY.has(normalized) || normalized.includes('token') || normalized.includes('email')) {
      continue;
    }
    if (typeof value === 'string') {
      if (value.includes('@') || value.length > 120) continue;
      out[key] = value.slice(0, 80);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

/** Drop query strings and hashes so redeem tokens never leave the browser. */
export function safePath(href: string): string {
  try {
    const url = new URL(href, 'https://rbit.local');
    return url.pathname || '/';
  } catch {
    return '/';
  }
}

type Capture = {
  event: string;
  product: AnalyticsProduct;
  properties?: Record<string, unknown>;
};

let enabled = false;
let apiKey = '';
let host = 'https://us.i.posthog.com';
let product: AnalyticsProduct = 'admin';
const queue: Capture[] = [];

export function configureAnalytics(input: {
  enabled: boolean;
  apiKey?: string;
  host?: string;
  product: AnalyticsProduct;
}): void {
  enabled = Boolean(input.enabled && input.apiKey && input.apiKey.startsWith('phc_'));
  apiKey = enabled ? input.apiKey!.trim() : '';
  host = (input.host || 'https://us.i.posthog.com').replace(/\/$/, '');
  product = input.product;
}

export function analyticsIsEnabled(): boolean {
  return enabled;
}

export function track(event: string, properties?: Record<string, unknown>): void {
  if (!enabled || !event) return;
  const payload: Capture = {
    event,
    product,
    properties: sanitizeProps({
      product,
      environment: 'production',
      ...properties,
    }),
  };
  queue.push(payload);
  void flush(payload);
}

async function flush(payload: Capture): Promise<void> {
  try {
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        event: payload.event,
        properties: {
          ...payload.properties,
          distinct_id: anonymousId(),
          $process_person_profile: false,
        },
      }),
      keepalive: true,
    });
  } catch {
    /* analytics must never block the product */
  }
}

function anonymousId(): string {
  const key = 'rbit_anon_id';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return 'anonymous';
  }
}

export function trackPageview(href: string): void {
  track('$pageview', { path: safePath(href) });
}
