/**
 * Regression: Netlify demo builds must never invoke production auth/API side effects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isNetlifyDemoMode,
  shouldBlockOutboundApi,
  startNetlifyDemoSession,
  stopNetlifyDemoSession,
} from './netlify-demo';
import { tryUiPreviewRequest } from './ui-preview-api';
import { api, getSessionToken } from '../api/client';

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
  Object.defineProperty(globalThis, 'localStorage', {
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

describe('netlify demo outbound API regression', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_DWEL_NETLIFY_DEMO', 'true');
    installMemorySessionStorage();
    stopNetlifyDemoSession();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    stopNetlifyDemoSession();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('enables demo mode and outbound block when flag is set', () => {
    expect(isNetlifyDemoMode()).toBe(true);
    expect(shouldBlockOutboundApi()).toBe(true);
  });

  it('never calls fetch for magic-link, me, listings, or payments', async () => {
    startNetlifyDemoSession('info@rbitfinancial.com', 'renter');
    expect(getSessionToken()).toBe('netlify-demo-session');

    await expect(api.magicLink('info@rbitfinancial.com', 'sign_in')).rejects.toMatchObject({
      status: 403,
    });
    await expect(api.me()).resolves.toMatchObject({
      email: 'info@rbitfinancial.com',
      session_id: 'netlify-demo-session',
    });
    const listings = tryUiPreviewRequest('/v1/listings?limit=10', { method: 'GET' });
    expect(listings?.status).toBe(200);

    const pay = tryUiPreviewRequest('/v1/payments/stripe/checkout', { method: 'POST' });
    expect(pay?.status).toBe(403);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed if an unsimulated mutation is requested', () => {
    startNetlifyDemoSession('addison@rbitfinancial.com', 'broker');
    const blocked = tryUiPreviewRequest('/v1/some/unknown/mutate', { method: 'POST' });
    expect(blocked?.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
