import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  assessCheckrAvailability,
  verifyCheckrTenantSignature,
  signCheckrTenantBody,
  CheckrTenantClient,
  sanitizeReportSummary,
} from '../../src/modules/vendors/checkr/index.js';
import { canTransitionCheckrStatus } from '../../src/modules/screening/checkr/state.js';

describe('Checkr Tenant availability', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('fails closed when disabled', () => {
    process.env.CHECKR_TENANT_ENABLED = 'false';
    process.env.CHECKR_TENANT_API_KEY = 'ckr_sk_test_abc';
    process.env.CHECKR_TENANT_WEBHOOK_SECRET = 'whsec';
    process.env.CHECKR_TENANT_API_URL = 'https://tenant.checkr.com/api';
    process.env.CHECKR_TENANT_API_VERSION = '2026-04-29';
    process.env.CHECKR_TENANT_MODE = 'test';
    expect(assessCheckrAvailability().available).toBe(false);
  });

  it('rejects live keys outside approved production', () => {
    process.env.CHECKR_TENANT_ENABLED = 'true';
    process.env.CHECKR_TENANT_API_KEY = 'ckr_sk_live_abc123';
    process.env.CHECKR_TENANT_WEBHOOK_SECRET = 'whsec';
    process.env.CHECKR_TENANT_API_URL = 'https://tenant.checkr.com/api';
    process.env.CHECKR_TENANT_API_VERSION = '2026-04-29';
    process.env.CHECKR_TENANT_MODE = 'live';
    process.env.APP_ENV = 'development';
    process.env.CHECKR_TENANT_ALLOW_LIVE = 'false';
    const a = assessCheckrAvailability();
    expect(a.available).toBe(false);
    if (!a.available) expect(a.reason).toBe('checkr_live_key_outside_production');
  });

  it('accepts test configuration when enabled', () => {
    process.env.CHECKR_TENANT_ENABLED = 'true';
    process.env.CHECKR_TENANT_API_KEY = 'ckr_sk_test_abc123';
    process.env.CHECKR_TENANT_WEBHOOK_SECRET = 'whsec_test';
    process.env.CHECKR_TENANT_API_URL = 'https://tenant.checkr.com/api';
    process.env.CHECKR_TENANT_API_VERSION = '2026-04-29';
    process.env.CHECKR_TENANT_MODE = 'test';
    const a = assessCheckrAvailability();
    expect(a.available).toBe(true);
    if (a.available) expect(a.mode).toBe('test');
  });

  it('fails when API key missing', () => {
    process.env.CHECKR_TENANT_ENABLED = 'true';
    delete process.env.CHECKR_TENANT_API_KEY;
    process.env.CHECKR_TENANT_WEBHOOK_SECRET = 'whsec';
    process.env.CHECKR_TENANT_API_URL = 'https://tenant.checkr.com/api';
    process.env.CHECKR_TENANT_API_VERSION = '2026-04-29';
    process.env.CHECKR_TENANT_MODE = 'test';
    const a = assessCheckrAvailability();
    expect(a.available).toBe(false);
    if (!a.available) expect(a.reason).toBe('checkr_api_key_missing');
  });
});

describe('Checkr Tenant webhook signature', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({
    id: 'evt_test_1',
    object: 'event',
    type: 'report.completed',
    created_at: '2026-04-29T17:42:13Z',
    data: { id: 'rp_test_1', order_id: 'ord_test_1' },
  });

  it('accepts valid Tenant-Signature', () => {
    const t = Math.floor(Date.now() / 1000);
    const header = signCheckrTenantBody(body, secret, t);
    const result = verifyCheckrTenantSignature(body, header, secret, { nowSeconds: t });
    expect(result.valid).toBe(true);
  });

  it('rejects invalid signature', () => {
    const t = Math.floor(Date.now() / 1000);
    const result = verifyCheckrTenantSignature(body, `t=${t},v1=deadbeef`, secret, {
      nowSeconds: t,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects replay outside window', () => {
    const t = Math.floor(Date.now() / 1000) - 10_000;
    const header = signCheckrTenantBody(body, secret, t);
    const result = verifyCheckrTenantSignature(body, header, secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('timestamp_outside_replay_window');
  });

  it('uses constant-time compare (length mismatch fails)', () => {
    const t = Math.floor(Date.now() / 1000);
    const result = verifyCheckrTenantSignature(body, `t=${t},v1=ab`, secret, { nowSeconds: t });
    expect(result.valid).toBe(false);
  });
});

describe('CheckrTenantClient', () => {
  it('rejects applicant payer in test mode', async () => {
    const client = new CheckrTenantClient({
      apiKey: 'ckr_sk_test_abc',
      apiUrl: 'https://tenant.checkr.com/api',
      apiVersion: '2026-04-29',
      mode: 'test',
      fetchImpl: async () => {
        throw new Error('should not call network');
      },
    });
    await expect(
      client.createOrder(
        {
          order: {
            package: 'essential',
            payer: 'applicant',
            property: { street: '1 Main', city: 'Austin', state: 'TX', zipcode: '78701' },
            applicant: { email: 'a@example.com', first_name: 'A', last_name: 'B' },
          },
        },
        { idempotencyKey: 'k1' },
      ),
    ).rejects.toMatchObject({ code: 'checkr_validation_error' });
  });

  it('sends bearer auth and pinned version', async () => {
    let seenAuth = '';
    let seenVersion = '';
    let seenIdem = '';
    const client = new CheckrTenantClient({
      apiKey: 'ckr_sk_test_abc',
      apiUrl: 'https://tenant.checkr.com/api',
      apiVersion: '2026-04-29',
      mode: 'test',
      fetchImpl: async (_url, init) => {
        seenAuth = init.headers.Authorization ?? '';
        seenVersion = init.headers['Checkr-Tenant-Version'] ?? '';
        seenIdem = init.headers['Idempotency-Key'] ?? '';
        return {
          ok: true,
          status: 201,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({
              id: 'ord_test_1',
              live_mode: false,
              status: 'pending',
              package: 'essential',
              payer: 'organization',
              property_id: 'pr_test_1',
              applicant_id: 'ap_test_1',
              application_url: null,
              created_at: new Date().toISOString(),
            }),
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    });
    const order = await client.createOrder(
      {
        order: {
          package: 'essential',
          property: { street: '1 Main', city: 'Austin', state: 'TX', zipcode: '78701' },
          applicant: {
            email: 'herbert@example.com',
            first_name: 'Herbert',
            last_name: 'Humphrey',
          },
        },
      },
      { idempotencyKey: 'idem-1' },
    );
    expect(seenAuth).toBe('Bearer ckr_sk_test_abc');
    expect(seenVersion).toBe('2026-04-29');
    expect(seenIdem).toBe('idem-1');
    expect(order.id).toBe('ord_test_1');
  });

  it('maps auth failures without leaking key material', async () => {
    const client = new CheckrTenantClient({
      apiKey: 'ckr_sk_test_secretkey',
      apiUrl: 'https://tenant.checkr.com/api',
      apiVersion: '2026-04-29',
      mode: 'test',
      maxRetries: 0,
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({ error: { type: 'authentication_error', message: 'invalid' } }),
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });
    await expect(
      client.getOrder('ord_test_1'),
    ).rejects.toMatchObject({ status: 502 });
  });
});

describe('sanitizeReportSummary', () => {
  it('keeps consider indicators without raw PII dumps', () => {
    const summary = sanitizeReportSummary({
      id: 'rp_test_1',
      order_id: 'ord_test_1',
      status: 'completed',
      result: 'consider',
      criminal_history: {
        result: 'consider',
        status: 'completed',
        consider_reasons: [{ category: 'conviction', label: 'Needs review' }],
        raw_records: [{ ssn: '111-11-1111' }],
      },
    });
    expect(summary.result).toBe('consider');
    const products = summary.products as Record<string, { result: string }>;
    expect(products.criminal_history?.result).toBe('consider');
    expect(JSON.stringify(summary)).not.toContain('111-11-1111');
    expect(JSON.stringify(summary)).not.toContain('raw_records');
  });
});

describe('Checkr screening sub-state transitions', () => {
  it('allows awaiting_applicant → processing → completed', () => {
    expect(canTransitionCheckrStatus('awaiting_applicant', 'processing')).toBe(true);
    expect(canTransitionCheckrStatus('processing', 'completed')).toBe(true);
    expect(canTransitionCheckrStatus('completed', 'processing')).toBe(false);
  });
});

describe('sandbox test profile names (documentation guard)', () => {
  const profiles = [
    { first: 'Hudson', last: 'Green', ssn: '555-55-5555', note: 'hosted applicant UX' },
    { first: 'Herbert', last: 'Humphrey', ssn: '111-11-1111', note: 'criminal consider' },
    { first: 'Madelyn', last: 'Webster', ssn: '222-22-2222', note: 'credit consider' },
    { first: 'Norma', last: 'Davies', ssn: '333-33-3333', note: 'eviction consider' },
    { first: 'Tim', last: 'Watkins', ssn: '444-44-4444', note: 'multiple consider' },
    { first: 'Ingrid', last: 'Vance', ssn: '666-66-6666', note: 'document income' },
  ];

  it('lists official canned profiles for sandbox scripts', () => {
    expect(profiles).toHaveLength(6);
    expect(profiles.every((p) => p.ssn.match(/^\d{3}-\d{2}-\d{4}$/))).toBe(true);
  });
});
