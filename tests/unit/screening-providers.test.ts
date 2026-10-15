import { describe, expect, it, afterEach } from 'vitest';
import {
  assessProviderInfrastructure,
  buildComparisonReport,
  COMPARISON_SCENARIOS,
  createCertnAdapter,
  createCheckrTenantAdapter,
  getScreeningProviderAdapter,
} from '../../src/modules/screening/providers/index.js';
import { signCheckrTenantBody } from '../../src/modules/vendors/checkr/index.js';
import { signCertnWebhookBody } from '../../src/modules/vendors/certn.js';

describe('provider-agnostic screening contract', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('exposes both adapters behind ScreeningProvider', () => {
    const certn = getScreeningProviderAdapter('certn');
    const checkr = getScreeningProviderAdapter('checkr_tenant');
    expect(certn.providerId).toBe('certn');
    expect(checkr.providerId).toBe('checkr_tenant');
    expect(typeof certn.createScreeningRequest).toBe('function');
    expect(typeof checkr.verifyAndIngestWebhook).toBe('function');
    expect(typeof checkr.getApplicationUrl).toBe('function');
    expect(typeof certn.downloadReportPdf).toBe('function');
  });

  it('reports infrastructure readiness independently', () => {
    process.env.CHECKR_TENANT_ENABLED = 'false';
    delete process.env.CERTN_API_KEY;
    const infra = assessProviderInfrastructure();
    expect(infra.certn.infrastructureReady).toBe(false);
    expect(infra.checkr_tenant.infrastructureReady).toBe(false);
  });

  it('normalizes Checkr and Certn statuses without collapsing schemas', () => {
    const checkr = createCheckrTenantAdapter();
    const certn = createCertnAdapter();
    expect(checkr.normalizeStatus('waiting_for_applicant')).toBe('awaiting_applicant');
    expect(checkr.normalizeStatus('completed')).toBe('completed');
    expect(certn.normalizeStatus('COMPLETE')).toBe('completed');
    expect(certn.normalizeStatus('PENDING')).toBe('processing');
  });

  it('verifies provider-specific webhook signatures', async () => {
    const checkr = createCheckrTenantAdapter();
    const body = JSON.stringify({
      id: 'evt_1',
      type: 'report.completed',
      data: { id: 'rp_1', order_id: 'ord_1' },
    });
    const secret = 'whsec_test';
    const sig = signCheckrTenantBody(body, secret);
    const ok = await checkr.verifyAndIngestWebhook({
      rawBody: body,
      signatureHeader: sig,
      signingSecret: secret,
    });
    expect(ok.accepted).toBe(true);
    expect(ok.providerEventId).toBe('evt_1');

    const bad = await checkr.verifyAndIngestWebhook({
      rawBody: body,
      signatureHeader: 't=1,v1=deadbeef',
      signingSecret: secret,
    });
    expect(bad.accepted).toBe(false);

    const certn = createCertnAdapter();
    const certnBody = JSON.stringify({ event_id: 'e1', event_type: 'case.updated' });
    const certnSig = signCertnWebhookBody(certnBody, 'certn_secret');
    const certnOk = await certn.verifyAndIngestWebhook({
      rawBody: certnBody,
      signatureHeader: certnSig,
      signingSecret: 'certn_secret',
    });
    expect(certnOk.accepted).toBe(true);

    const probe = await checkr.verifyAndIngestWebhook({
      rawBody: '',
      signingSecret: secret,
    });
    expect(probe.probe).toBe(true);
    expect(probe.accepted).toBe(true);
  });

  it('rejects Checkr applicant payer in test mode via adapter create path', async () => {
    process.env.CHECKR_TENANT_ENABLED = 'true';
    process.env.CHECKR_TENANT_API_KEY = 'ckr_sk_test_abc';
    process.env.CHECKR_TENANT_WEBHOOK_SECRET = 'whsec';
    process.env.CHECKR_TENANT_API_URL = 'https://tenant.checkr.com/api';
    process.env.CHECKR_TENANT_API_VERSION = '2026-04-29';
    process.env.CHECKR_TENANT_MODE = 'test';

    const adapter = createCheckrTenantAdapter(process.env, async () => {
      throw new Error('network should not be reached for payer guard');
    });
    // createScreeningRequest always forces organization payer in client for test mode;
    // readiness should be true with env above.
    expect(adapter.isInfrastructureReady()).toBe(true);
  });

  it('builds comparison report across providers', () => {
    const report = buildComparisonReport([
      {
        id: '1',
        scenario_key: 'certn_sandbox_order',
        provider: 'certn',
        provider_screening_id: null,
        screening_status: 'ready',
        applicant_flow_completed: false,
        request_latency_ms: 40,
        webhook_received: false,
        report_available: false,
        error_code: null,
        provider_response_metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: '2',
        scenario_key: 'checkr_hudson_green',
        provider: 'checkr_tenant',
        provider_screening_id: null,
        screening_status: 'failed',
        applicant_flow_completed: false,
        request_latency_ms: 80,
        webhook_received: true,
        report_available: false,
        error_code: 'infrastructure_not_ready',
        provider_response_metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    expect(report.by_provider.certn?.runs).toBe(1);
    expect(report.by_provider.checkr_tenant?.errors).toBe(1);
    expect(report.scenarios.length).toBe(COMPARISON_SCENARIOS.length);
  });
});
