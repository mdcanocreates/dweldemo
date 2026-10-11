/**
 * Demo screening orchestration — complete synthetic results without Certn webhooks.
 */
import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { emitDomainEvent } from '../audit/index.js';
import { isDemoModeEnabled } from '../demo/index.js';
import {
  completeAllDemoReportsForOrder,
  DemoTenantScreening,
} from '../vendors/index.js';
import { transitionOrderStatus } from './order.js';
import { recomputeBadge } from './badge.js';
import { forceApplicationTransition } from './pipeline.js';

export async function assertDemoApplication(
  client: DbClient,
  applicationId: string,
): Promise<{ id: string; party_id: string; status: string; is_demo: boolean }> {
  if (!isDemoModeEnabled()) {
    throw new AppError('demo mode disabled', 'demo_disabled', 404);
  }
  const { rows } = await client.query<{
    id: string;
    party_id: string;
    status: string;
    is_demo: boolean;
  }>(
    `select id, party_id, status, coalesce(is_demo, false) as is_demo
     from application where id = $1 for update`,
    [applicationId],
  );
  const app = rows[0];
  if (!app) throw new AppError('application not found', 'application_not_found', 404);
  if (!app.is_demo) {
    throw new AppError(
      'demo actions are only allowed on demo applications',
      'demo_application_required',
      403,
    );
  }
  return app;
}

/**
 * Mark all demo reports complete and advance application → screened (ready for review).
 * Does not call Certn; mutates only demo-marked rows.
 */
export async function completeDemoScreening(
  client: DbClient,
  applicationId: string,
  clock: Clock = systemClock,
): Promise<{
  applicationId: string;
  orderId: string;
  status: string;
  demoResult: Record<string, unknown>;
}> {
  const app = await assertDemoApplication(client, applicationId);

  const { rows: orders } = await client.query<{
    id: string;
    vendor_order_ref: string | null;
    status: string;
  }>(
    `select id, vendor_order_ref, status from screening_order
     where application_id = $1
     order by created_at desc
     limit 1
     for update`,
    [applicationId],
  );
  const order = orders[0];
  if (!order) {
    throw new AppError('demo screening order not found', 'screening_order_missing', 404);
  }

  const orderRef = order.vendor_order_ref ?? `demo-case-${order.id}`;
  // Ensure in-memory demo reports exist even after process restart.
  const screening = new DemoTenantScreening();
  const { rows: reports } = await client.query<{
    id: string;
    vendor_report_id: string;
    status: string;
    report_kind: string;
  }>(
    `select id, vendor_report_id, status, report_kind
     from screening_report where screening_order_id = $1 for update`,
    [order.id],
  );

  if (reports.length === 0) {
    const submitted = await screening.submitOrder(
      { partyId: app.party_id, packageProductCodes: ['oneid', 'criminal_tier_1'] },
      {
        correlationId: order.id,
        partyId: app.party_id,
        screeningOrderId: order.id,
        applicationId,
      },
    );
    for (const p of submitted.products) {
      await client.query(
        `insert into screening_report (
           id, screening_order_id, party_id, vendor, vendor_report_id,
           report_kind, cost_cents, status, derived_summary
         ) values (gen_random_uuid(),$1,$2,'demo',$3,$4,0,'pending',$5::jsonb)`,
        [
          order.id,
          app.party_id,
          p.vendorReportId,
          p.reportKind,
          JSON.stringify({
            is_demo: true,
            title: p.reportKind === 'identity' ? 'Identity check' : 'Background screening',
            status_label: 'Demo in progress',
            disclaimer: 'No real background check was performed.',
          }),
        ],
      );
    }
    await client.query(
      `update screening_order set vendor_order_ref = $2 where id = $1`,
      [order.id, submitted.vendorOrderRef],
    );
  }

  completeAllDemoReportsForOrder(orderRef);

  const demoSummary = {
    is_demo: true,
    label: 'DEMO RESULT',
    disclaimer: 'No real background check was performed.',
    identity: { title: 'Identity check', status: 'Demo complete' },
    background: { title: 'Background screening', status: 'Demo complete' },
    overall: 'Ready for provider review',
  };

  await client.query(
    `update screening_report
     set status = 'complete',
         issued_at = coalesce(issued_at, $2),
         derived_summary = coalesce(derived_summary, '{}'::jsonb) || $3::jsonb
     where screening_order_id = $1`,
    [order.id, clock.now(), JSON.stringify(demoSummary)],
  );

  if (order.status !== 'complete') {
    await transitionOrderStatus(client, order.id, 'complete', clock);
  }

  if (app.status !== 'screened') {
    await forceApplicationTransition(client, applicationId, app.status, 'screened', clock);
  }

  await recomputeBadge(client, app.party_id, clock);

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: applicationId,
    eventType: 'demo.screening_completed',
    payload: { screening_order_id: order.id, ...demoSummary },
    actorKind: 'system',
    occurredAt: clock.now(),
  });

  return {
    applicationId,
    orderId: order.id,
    status: 'screened',
    demoResult: demoSummary,
  };
}
