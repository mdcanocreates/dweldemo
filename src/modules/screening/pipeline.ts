import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { InProcessSagaRunner, type SagaActivity } from '../../infra/workflows/index.js';
import { emitDomainEvent } from '../audit/index.js';
import { assertScreeningConsentRecorded, recordScreeningConsent } from './consent.js';
import {
  getVendorRegistry,
  DemoTenantScreening,
  type TenantScreening,
} from '../vendors/index.js';
import { isDemoModeEnabled } from '../demo/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import {
  archiveVendorRequest,
  archiveVendorResponse,
  hashPayload,
  recordVendorCost,
} from './archive.js';
import { recomputeBadge } from './badge.js';
import { ensureStandardPackage, getActivePackage } from './config.js';
import { evaluateFraudSignals } from './fraud.js';
import { recordIncomeVerification } from './income.js';
import { createScreeningOrder, transitionOrderStatus, type PayerKind } from './order.js';
import { runPrescreen } from './prescreen.js';
import { DEVICE_PRESCREEN_GENERIC_MESSAGE } from './device-prescreen.js';
import { setReportExpiryFromConfig } from './reports.js';
import { refreshOrderAndApplication } from './webhook.js';

/**
 * Per-order screening vendor resolution.
 * DemoTenantScreening ONLY when DWEL_DEMO_ENABLED and application.is_demo.
 * Normal applications never silently fall through to demo.
 */
export async function resolveTenantScreeningForOrder(
  client: DbClient,
  order: { application_id: string | null },
): Promise<TenantScreening> {
  if (isDemoModeEnabled() && order.application_id) {
    const { rows } = await client.query<{ is_demo: boolean }>(
      `select coalesce(is_demo, false) as is_demo from application where id = $1`,
      [order.application_id],
    );
    if (rows[0]?.is_demo) {
      return new DemoTenantScreening();
    }
  }
  return getVendorRegistry().tenantScreening();
}

export type PipelineInput = {
  partyId: string;
  renterProfileId: string;
  orgId: string;
  listingId?: string | null;
  unitId?: string | null;
  entryPoint?: 'renter_initiated' | 'landlord_invited';
  payerKind: PayerKind;
  payerPartyId?: string | null;
  payerOrgId?: string | null;
  deviceId?: string | null;
  statedMonthlyIncomeCents?: number | null;
  listingRentCents?: number | null;
  incomeMethod?: 'plaid_bank' | 'plaid_payroll' | 'vendor_payroll' | 'document' | 'stated';
  identityFingerprint?: string | null;
  clock?: Clock;
  /** Required before screening_authorized — records application-scoped consent. */
  screeningConsent?: {
    disclosureVersion: string;
    consentIp?: string | null;
  };
};

export type PipelineResult = {
  applicationId: string;
  orderId: string;
  workflowId: string;
  status: string;
  badgeState: string;
};

async function transitionApplication(
  client: DbClient,
  applicationId: string,
  from: string | null,
  to: string,
  clock: Clock,
  extra?: { screenedAt?: Date; screeningAuthorizedAt?: Date; closedAt?: Date },
): Promise<void> {
  const { rows } = await client.query<{ status: string }>(
    `select status from application where id = $1 for update`,
    [applicationId],
  );
  const row = rows[0];
  if (!row) throw new AppError('application not found', 'application_not_found', 404);
  if (from != null && row.status !== from) {
    throw new AppError(
      `application expected status ${from}, was ${row.status}`,
      'application_invalid_transition',
      409,
    );
  }
  if (row.status === 'closed' || row.status === 'withdrawn') {
    throw new AppError(
      `application terminal status ${row.status} cannot transition to ${to}`,
      'application_invalid_transition',
      409,
    );
  }

  const sets = [`status = $2`];
  const params: unknown[] = [applicationId, to];
  if (to === 'submitted') {
    params.push(clock.now());
    sets.push(`submitted_at = $${params.length}`);
  }
  if (extra?.screeningAuthorizedAt) {
    params.push(extra.screeningAuthorizedAt);
    sets.push(`screening_authorized_at = $${params.length}`);
  }
  if (extra?.screenedAt) {
    params.push(extra.screenedAt);
    sets.push(`screened_at = $${params.length}`);
  }
  if (extra?.closedAt) {
    params.push(extra.closedAt);
    sets.push(`closed_at = $${params.length}`);
  }
  await client.query(
    `update application set ${sets.join(', ')} where id = $1`,
    params,
  );
  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: applicationId,
    eventType: 'application.status_changed',
    payload: { from: from ?? row.status, to },
    actorKind: 'system',
    occurredAt: clock.now(),
  });
}

async function transitionToScreeningAuthorized(
  client: DbClient,
  applicationId: string,
  fromStatus: string,
  input: PipelineInput,
  clock: Clock,
): Promise<void> {
  // Consent must already be persisted (HTTP consent route) OR supplied inline
  // for in-process test pipelines. Never set screening_authorized_at without it.
  const { rows: existing } = await client.query<{ id: string }>(
    `select id from screening_consent where application_id = $1`,
    [applicationId],
  );
  if (!existing[0]) {
    if (!input.screeningConsent) {
      throw new AppError(
        'screening consent required before authorization',
        'screening_consent_required',
        422,
      );
    }
    await recordScreeningConsent(client, {
      applicationId,
      disclosureVersion: input.screeningConsent.disclosureVersion,
      consentIp: input.screeningConsent.consentIp ?? null,
      clock,
    });
  } else {
    await assertScreeningConsentRecorded(client, applicationId);
  }
  await transitionApplication(
    client,
    applicationId,
    fromStatus,
    'screening_authorized',
    clock,
    { screeningAuthorizedAt: clock.now() },
  );
}

/** Exported for invalid-transition tests / admin repair paths. */
export async function forceApplicationTransition(
  client: DbClient,
  applicationId: string,
  from: string | null,
  to: string,
  clock: Clock = systemClock,
): Promise<void> {
  return transitionApplication(client, applicationId, from, to, clock);
}

/**
 * Full application → prescreen → screening saga against vendor stubs (zero network).
 */
export async function runApplicationPipeline(
  client: DbClient,
  input: PipelineInput,
): Promise<PipelineResult> {
  const clock = input.clock ?? systemClock;
  await ensureStandardPackage(client);

  const applicationId = randomUUID();
  await client.query(
    `insert into application (
       id, party_id, renter_profile_id, listing_id, unit_id, org_id,
       entry_point, status, device_id
     ) values ($1,$2,$3,$4,$5,$6,$7,'draft',$8)`,
    [
      applicationId,
      input.partyId,
      input.renterProfileId,
      input.listingId ?? null,
      input.unitId ?? null,
      input.orgId,
      input.entryPoint ?? 'renter_initiated',
      input.deviceId ?? null,
    ],
  );
  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: applicationId,
    eventType: 'application.created',
    payload: { status: 'draft', org_id: input.orgId },
    actorPartyId: input.partyId,
    actorKind: 'user',
    occurredAt: clock.now(),
  });

  await transitionApplication(client, applicationId, 'draft', 'submitted', clock);
  await transitionApplication(client, applicationId, 'submitted', 'prescreen', clock);

  const prescreen = await runPrescreen(
    client,
    {
      applicationId,
      partyId: input.partyId,
      orgId: input.orgId,
      listingRentCents: input.listingRentCents,
      statedMonthlyIncomeCents: input.statedMonthlyIncomeCents,
      deviceId: input.deviceId,
    },
    clock,
  );

  if (!prescreen.passed) {
    await transitionApplication(client, applicationId, 'prescreen', 'prescreen_failed', clock);

    if (prescreen.deviceGate?.failed) {
      // Stay at prescreen_failed for review queue — do not close, do not call vendors.
      throw new AppError(
        DEVICE_PRESCREEN_GENERIC_MESSAGE,
        'prescreen_failed',
        422,
      );
    }

    await transitionApplication(client, applicationId, 'prescreen_failed', 'closed', clock, {
      closedAt: clock.now(),
    });
    throw new AppError('prescreen failed', 'prescreen_failed', 422);
  }

  await evaluateFraudSignals(client, {
    partyId: input.partyId,
    applicationId,
    deviceId: input.deviceId,
    clock,
  });

  await transitionApplication(
    client,
    applicationId,
    'prescreen',
    'awaiting_landlord_interest',
    clock,
  );
  await transitionToScreeningAuthorized(
    client,
    applicationId,
    'awaiting_landlord_interest',
    input,
    clock,
  );

  // Income verification (cheap half) before/alongside screening package
  await recordIncomeVerification(client, {
    partyId: input.partyId,
    method: input.incomeMethod ?? 'plaid_bank',
    monthlyIncomeCents: input.statedMonthlyIncomeCents ?? 500000,
    applicationId,
    clock,
    useVendor: true,
  });

  const { orderId } = await createScreeningOrder(client, {
    partyId: input.partyId,
    applicationId,
    payerKind: input.payerKind,
    payerPartyId: input.payerPartyId ?? input.partyId,
    payerOrgId: input.payerOrgId ?? input.orgId,
    clock,
  });

  await transitionApplication(
    client,
    applicationId,
    'screening_authorized',
    'screening_running',
    clock,
  );

  const runner = createScreeningSagaRunner();
  const { workflowId } = await runner.startScreeningSaga(client, { screeningOrderId: orderId });

  // Drive submit step
  await runner.runToIdle(client, workflowId);

  const badgeState = await recomputeBadge(client, input.partyId, clock);
  const { rows: apps } = await client.query<{ status: string }>(
    `select status from application where id = $1`,
    [applicationId],
  );

  return {
    applicationId,
    orderId,
    workflowId,
    status: apps[0]!.status,
    badgeState,
  };
}

/**
 * After admin clearPrescreenAndResume — continue from status=prescreen without re-running device gate.
 */
export async function resumeApplicationFromPrescreen(
  client: DbClient,
  input: PipelineInput & { applicationId: string; skipDeviceGate?: boolean },
): Promise<PipelineResult> {
  const clock = input.clock ?? systemClock;
  await ensureStandardPackage(client);

  const { rows: apps0 } = await client.query<{ status: string }>(
    `select status from application where id = $1 for update`,
    [input.applicationId],
  );
  if (!apps0[0] || apps0[0].status !== 'prescreen') {
    throw new AppError(
      `resume requires status prescreen, was ${apps0[0]?.status ?? 'missing'}`,
      'application_invalid_state',
      409,
    );
  }

  if (!input.skipDeviceGate && input.deviceId) {
    const prescreen = await runPrescreen(
      client,
      {
        applicationId: input.applicationId,
        partyId: input.partyId,
        orgId: input.orgId,
        listingRentCents: input.listingRentCents,
        statedMonthlyIncomeCents: input.statedMonthlyIncomeCents,
        deviceId: input.deviceId,
      },
      clock,
    );
    if (!prescreen.passed) {
      await transitionApplication(
        client,
        input.applicationId,
        'prescreen',
        'prescreen_failed',
        clock,
      );
      throw new AppError(DEVICE_PRESCREEN_GENERIC_MESSAGE, 'prescreen_failed', 422);
    }
  }

  await evaluateFraudSignals(client, {
    partyId: input.partyId,
    applicationId: input.applicationId,
    deviceId: input.deviceId,
    clock,
  });

  await transitionApplication(
    client,
    input.applicationId,
    'prescreen',
    'awaiting_landlord_interest',
    clock,
  );
  await transitionToScreeningAuthorized(
    client,
    input.applicationId,
    'awaiting_landlord_interest',
    input,
    clock,
  );

  await recordIncomeVerification(client, {
    partyId: input.partyId,
    method: input.incomeMethod ?? 'plaid_bank',
    monthlyIncomeCents: input.statedMonthlyIncomeCents ?? 500000,
    applicationId: input.applicationId,
    clock,
    useVendor: true,
  });

  const { orderId } = await createScreeningOrder(client, {
    partyId: input.partyId,
    applicationId: input.applicationId,
    payerKind: input.payerKind,
    payerPartyId: input.payerPartyId ?? input.partyId,
    payerOrgId: input.payerOrgId ?? input.orgId,
    clock,
  });

  await transitionApplication(
    client,
    input.applicationId,
    'screening_authorized',
    'screening_running',
    clock,
  );

  const runner = createScreeningSagaRunner();
  const { workflowId } = await runner.startScreeningSaga(client, { screeningOrderId: orderId });
  await runner.runToIdle(client, workflowId);

  const badgeState = await recomputeBadge(client, input.partyId, clock);
  const { rows: apps } = await client.query<{ status: string }>(
    `select status from application where id = $1`,
    [input.applicationId],
  );

  return {
    applicationId: input.applicationId,
    orderId,
    workflowId,
    status: apps[0]!.status,
    badgeState,
  };
}

export function createScreeningSagaRunner(): InProcessSagaRunner {
  const activities = new Map<string, SagaActivity>();

  activities.set('submit', async (client, ctx) => {
    const clock = systemClock;
    const { rows: orders } = await client.query<{
      id: string;
      party_id: string;
      application_id: string | null;
      package_id: string;
      status: string;
    }>(`select id, party_id, application_id, package_id, status from screening_order where id = $1`, [
      ctx.screeningOrderId,
    ]);
    const order = orders[0];
    if (!order) return { failed: true };

    const pkg = await getActivePackage(client);
    // Demo apps use DemoTenantScreening only when DWEL_DEMO_ENABLED + is_demo.
    // Normal apps keep the boot registry (Certn sandbox or unavailable) — never silent demo fallback.
    const screening = await resolveTenantScreeningForOrder(client, order);
    const correlationId = randomUUID();

    await archiveVendorRequest(client, {
      vendor: screening.vendorName,
      capability: 'tenant_screening',
      correlationId,
      screeningOrderId: order.id,
      applicationId: order.application_id,
      requestPayload: {
        party_id: order.party_id,
        product_codes: pkg.product_codes,
        // Never archive SSN — only fingerprint presence
        has_identity_fingerprint: Boolean(ctx.state.identityFingerprint),
      },
    });

    const result = await screening.submitOrder(
      {
        partyId: order.party_id,
        packageProductCodes: pkg.product_codes,
        identityFingerprint: ctx.state.identityFingerprint as string | undefined,
      },
      {
        correlationId,
        partyId: order.party_id,
        screeningOrderId: order.id,
        applicationId: order.application_id ?? undefined,
      },
    );

    await archiveVendorResponse(client, {
      vendor: screening.vendorName,
      capability: 'tenant_screening',
      correlationId,
      screeningOrderId: order.id,
      applicationId: order.application_id,
      responsePayload: {
        vendor_order_ref: result.vendorOrderRef,
        products: result.products.map((p) => ({
          product_code: p.productCode,
          report_kind: p.reportKind,
          vendor_report_id: p.vendorReportId,
          status: p.status,
          cost_cents: p.costCents,
        })),
        total_cost_cents: result.totalCostCents,
      },
    });

    await client.query(
      `update screening_order set vendor_order_ref = $2, status = 'submitted' where id = $1`,
      [order.id, result.vendorOrderRef],
    );
    await emitDomainEvent(client, {
      aggregateType: 'screening_order',
      aggregateId: order.id,
      eventType: 'screening_order.status_changed',
      payload: { from: order.status, to: 'submitted', vendor_order_ref: result.vendorOrderRef },
      actorKind: 'system',
      occurredAt: clock.now(),
    });

    for (const p of result.products) {
      const reportId = randomUUID();
      await client.query(
        `insert into screening_report (
           id, screening_order_id, party_id, vendor, vendor_report_id,
           report_kind, cost_cents, status, payload_hash
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          reportId,
          order.id,
          order.party_id,
          result.vendor,
          p.vendorReportId,
          p.reportKind,
          p.costCents,
          p.status,
          hashPayload({ vendor_report_id: p.vendorReportId }),
        ],
      );
      await emitDomainEvent(client, {
        aggregateType: 'screening_report',
        aggregateId: reportId,
        eventType: 'screening_report.created',
        payload: {
          report_kind: p.reportKind,
          status: p.status,
          vendor_report_id: p.vendorReportId,
        },
        actorKind: 'system',
        occurredAt: clock.now(),
      });

      // Alternate vendor may complete immediately
      if (p.status === 'complete') {
        await client.query(
          `update screening_report set issued_at = $2, derived_summary = $3::jsonb where id = $1`,
          [reportId, clock.now(), JSON.stringify({ vendor: result.vendor })],
        );
        await setReportExpiryFromConfig(client, reportId, clock.now(), clock);
        await recordVendorCost(client, {
          vendor: result.vendor,
          capability: `screening:${p.reportKind}`,
          amountCents: p.costCents,
          screeningOrderId: order.id,
          applicationId: order.application_id,
          correlationId,
          occurredAt: clock.now(),
          note: reportId,
        });
      }
    }

    await refreshOrderAndApplication(client, order.id, order.party_id, clock);

    const { rows: pending } = await client.query<{ n: string }>(
      `select count(*)::text as n from screening_report
       where screening_order_id = $1 and status = 'pending'`,
      [order.id],
    );
    if (Number(pending[0]?.n ?? 0) === 0) {
      return { completed: true, payload: { vendor_order_ref: result.vendorOrderRef } };
    }
    return {
      nextStep: 'await_products',
      payload: { vendor_order_ref: result.vendorOrderRef },
    };
  });

  activities.set('await_products', async (client, ctx) => {
    // External webhooks drive product completion; stay idle until all resolved.
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from screening_report
       where screening_order_id = $1 and status = 'pending'`,
      [ctx.screeningOrderId],
    );
    if (Number(rows[0]?.n ?? 0) === 0) {
      return { completed: true };
    }
    return { nextStep: 'await_products' };
  });

  return new InProcessSagaRunner(activities);
}

/**
 * Complete all pending products via simulated Certn webhooks (test helper).
 */
export async function completeAllProductsViaWebhooks(
  client: DbClient,
  orderId: string,
  clock: Clock = systemClock,
  opts?: {
    skipKinds?: string[];
    summaries?: Record<string, Record<string, unknown>>;
  },
): Promise<void> {
  const { ingestAndProcessCertnWebhook } = await import('./webhook.js');
  const { rows: order } = await client.query<{ vendor_order_ref: string | null }>(
    `select vendor_order_ref from screening_order where id = $1`,
    [orderId],
  );
  const { rows: reports } = await client.query<{
    vendor_report_id: string;
    report_kind: string;
    cost_cents: number | null;
    status: string;
  }>(
    `select vendor_report_id, report_kind, cost_cents, status
     from screening_report where screening_order_id = $1`,
    [orderId],
  );

  for (const r of reports) {
    if (opts?.skipKinds?.includes(r.report_kind)) continue;
    if (r.status === 'complete') continue;
    await ingestAndProcessCertnWebhook(
      client,
      {
        event_id: `evt-${r.vendor_report_id}-complete`,
        event_type: 'report.completed',
        vendor_order_ref: order[0]?.vendor_order_ref ?? orderId,
        vendor_report_id: r.vendor_report_id,
        report_kind: r.report_kind,
        status: 'complete',
        derived_summary: opts?.summaries?.[r.report_kind] ?? {
          report_kind: r.report_kind,
          clear: true,
        },
        cost_cents: r.cost_cents ?? 0,
      },
      clock,
    );
  }
}
