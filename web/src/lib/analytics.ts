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
      const lower = value.toLowerCase();
      if (
        value.includes('@') ||
        value.includes('?') ||
        value.includes('#') ||
        value.length > 120 ||
        lower.includes('token') ||
        lower.includes('bearer') ||
        lower.startsWith('http')
      ) {
        continue;
      }
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
    const path = url.pathname
      .split('/')
      .map((segment) => {
        if (!segment) return segment;
        if (
          segment.length >= 16 ||
          /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(segment)
        ) {
          return ':id';
        }
        return segment;
      })
      .join('/');
    return path || '/';
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
const CONSENT_KEY = 'rbit_analytics_consent';

export function analyticsConsentGranted(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'granted';
  } catch {
    return false;
  }
}

/** Defaults to denied. Collection stays off until a person grants consent. */
export function setAnalyticsConsent(granted: boolean): void {
  try {
    localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'denied');
  } catch {
    /* storage unavailable */
  }
}

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
  if (!enabled || !event || !analyticsConsentGranted()) return;
  const payload: Capture = {
    event,
    product,
    properties: sanitizeProps({
      product,
      environment: 'production',
      ...properties,
    }),
  };
  void flush(payload);
}

export function startEngagementTracking(): void {
  if (typeof document === 'undefined') return;
  let visibleSince = document.visibilityState === 'visible' ? Date.now() : 0;
  let accumulated = 0;
  const flushEngaged = () => {
    if (visibleSince) {
      accumulated += Date.now() - visibleSince;
      visibleSince = 0;
    }
    const seconds = Math.min(1800, Math.round(accumulated / 1000));
    accumulated = 0;
    if (seconds > 0) track('page_engaged', { path: safePath(window.location.href), seconds });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEngaged();
    else visibleSince = Date.now();
  });
  window.addEventListener('pagehide', flushEngaged);
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
