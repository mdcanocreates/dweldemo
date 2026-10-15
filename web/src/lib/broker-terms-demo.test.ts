import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BROKER_TERMS_VERSION } from './demo-store';
import {
  clearDemoBrokerTermsAccepted,
  readDemoBrokerTermsAccepted,
  writeDemoBrokerTermsAccepted,
} from './broker-terms-demo';
import { tryUiPreviewRequest } from './ui-preview-api';
import { resetNetlifyDemoClientState } from './netlify-demo';

function installMemoryStorage() {
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
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: store, configurable: true });
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

const ALL_ACKS = {
  terms_version: BROKER_TERMS_VERSION,
  compensation_cap_ack: true,
  non_circumvention_ack: true,
  licensing_ack: true,
  platform_role_ack: true,
};

describe('broker acknowledgment demo persistence', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DWEL_NETLIFY_DEMO', 'true');
    installMemoryStorage();
    clearDemoBrokerTermsAccepted();
  });

  afterEach(() => {
    clearDemoBrokerTermsAccepted();
    vi.unstubAllEnvs();
  });

  it('starts incomplete so the modal should appear', () => {
    expect(readDemoBrokerTermsAccepted()).toBe(false);
    const status = tryUiPreviewRequest('/v1/broker/terms', { method: 'GET' });
    expect(status?.status).toBe(200);
    expect((status?.body as { accepted?: boolean }).accepted).toBe(false);
  });

  it('rejects incomplete POST acknowledgments', () => {
    const res = tryUiPreviewRequest('/v1/broker/terms', {
      method: 'POST',
      body: JSON.stringify({
        terms_version: BROKER_TERMS_VERSION,
        compensation_cap_ack: true,
        // missing other required boxes
      }),
    });
    expect(res?.status).toBe(400);
    expect(readDemoBrokerTermsAccepted()).toBe(false);
  });

  it('accepts complete acknowledgments and persists locally', () => {
    const res = tryUiPreviewRequest('/v1/broker/terms', {
      method: 'POST',
      body: JSON.stringify(ALL_ACKS),
    });
    expect(res?.status).toBe(200);
    expect((res?.body as { accepted?: boolean }).accepted).toBe(true);
    expect(readDemoBrokerTermsAccepted()).toBe(true);

    const again = tryUiPreviewRequest('/v1/broker/terms', { method: 'GET' });
    expect((again?.body as { accepted?: boolean }).accepted).toBe(true);
  });

  it('survives a simulated refresh via storage re-read', () => {
    writeDemoBrokerTermsAccepted();
    expect(readDemoBrokerTermsAccepted()).toBe(true);
    const status = tryUiPreviewRequest('/v1/broker/terms', { method: 'GET' });
    expect((status?.body as { accepted?: boolean }).accepted).toBe(true);
  });

  it('reset clears acknowledgment so the modal returns', () => {
    writeDemoBrokerTermsAccepted();
    expect(readDemoBrokerTermsAccepted()).toBe(true);
    resetNetlifyDemoClientState();
    expect(readDemoBrokerTermsAccepted()).toBe(false);
    const status = tryUiPreviewRequest('/v1/broker/terms', { method: 'GET' });
    expect((status?.body as { accepted?: boolean }).accepted).toBe(false);
  });

  it('does not enable demo adapters when Netlify flag is off (production unchanged)', () => {
    vi.stubEnv('VITE_DWEL_NETLIFY_DEMO', '');
    // Without ui-preview or netlify flag, offline fixture gate is closed.
    expect(tryUiPreviewRequest('/v1/broker/terms', { method: 'GET' })).toBeNull();
  });
});
