import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isNetlifyDemoEmailAllowed,
  isNetlifyDemoMode,
  isNetlifyDemoSessionActive,
  NETLIFY_DEMO_EMAILS,
  NETLIFY_DEMO_ROLE_ENTRY,
  netlifyDemoHomeForRole,
  shouldBlockOutboundApi,
  startNetlifyDemoSession,
  setNetlifyDemoRole,
  stopNetlifyDemoSession,
  getNetlifyDemoRole,
} from './netlify-demo';
import { tryUiPreviewRequest } from './ui-preview-api';

function installMemorySessionStorage() {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: store,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: { hash: '' },
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    configurable: true,
  });
}

describe('netlify demo email gate', () => {
  it('allows the four designated RBIT emails', () => {
    for (const email of NETLIFY_DEMO_EMAILS) {
      expect(isNetlifyDemoEmailAllowed(email)).toBe(true);
      expect(isNetlifyDemoEmailAllowed(email.toUpperCase())).toBe(true);
    }
  });

  it('rejects non-allowlisted emails', () => {
    expect(isNetlifyDemoEmailAllowed('stranger@example.com')).toBe(false);
    expect(isNetlifyDemoEmailAllowed('mdcano@gmail.com')).toBe(false);
  });
});

describe('netlify demo roles', () => {
  it('maps roles to production portal homes', () => {
    expect(netlifyDemoHomeForRole('renter')).toBe('/home');
    expect(netlifyDemoHomeForRole('broker')).toBe('/broker/dashboard');
    expect(netlifyDemoHomeForRole('landlord')).toBe('/dashboard');
    expect(NETLIFY_DEMO_ROLE_ENTRY.landlord.label).toBe('Home Provider');
  });
});

describe('netlify demo session + offline API', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DWEL_NETLIFY_DEMO', 'true');
    installMemorySessionStorage();
    stopNetlifyDemoSession();
  });

  afterEach(() => {
    stopNetlifyDemoSession();
    vi.unstubAllEnvs();
  });

  it('starts session only for allowlisted emails', () => {
    expect(isNetlifyDemoMode()).toBe(true);
    expect(shouldBlockOutboundApi()).toBe(true);
    expect(startNetlifyDemoSession('nope@example.com', 'renter').ok).toBe(false);
    expect(isNetlifyDemoSessionActive()).toBe(false);

    expect(startNetlifyDemoSession('addison@rbitfinancial.com', 'broker').ok).toBe(true);
    expect(isNetlifyDemoSessionActive()).toBe(true);
    expect(getNetlifyDemoRole()).toBe('broker');

    setNetlifyDemoRole('landlord');
    expect(getNetlifyDemoRole()).toBe('landlord');
  });

  it('blocks magic-link, payments, and screening provider calls', () => {
    startNetlifyDemoSession('info@rbitfinancial.com', 'renter');

    const magic = tryUiPreviewRequest('/v1/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email: 'info@rbitfinancial.com' }),
    });
    expect(magic?.status).toBe(403);
    expect(String((magic?.body as { error?: string }).error)).toMatch(/demo|preview/);

    const stripe = tryUiPreviewRequest('/v1/payments/stripe/checkout', { method: 'POST' });
    expect(stripe?.status).toBe(403);

    const certn = tryUiPreviewRequest('/v1/screening/certn/start', { method: 'POST' });
    expect(certn?.status).toBe(403);

    const checkr = tryUiPreviewRequest('/v1/vendors/checkr/invite', { method: 'POST' });
    expect(checkr?.status).toBe(403);
  });

  it('serves synthetic me and listings without network', () => {
    startNetlifyDemoSession('mdcano@rbitfinancial.com', 'renter');
    const me = tryUiPreviewRequest('/v1/auth/me', { method: 'GET' });
    expect(me?.status).toBe(200);
    expect((me?.body as { email?: string }).email).toBe('mdcano@rbitfinancial.com');

    const listings = tryUiPreviewRequest('/v1/listings', { method: 'GET' });
    expect(listings?.status).toBe(200);
    expect(Array.isArray((listings?.body as { listings?: unknown[] }).listings)).toBe(true);
  });
});

describe('production build flag off', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DWEL_NETLIFY_DEMO', '');
    installMemorySessionStorage();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not enable demo adapters or outbound block', () => {
    expect(isNetlifyDemoMode()).toBe(false);
    expect(shouldBlockOutboundApi()).toBe(false);
    expect(startNetlifyDemoSession('info@rbitfinancial.com', 'renter').ok).toBe(false);
    expect(tryUiPreviewRequest('/v1/auth/magic-link', { method: 'POST' })).toBeNull();
  });
});
