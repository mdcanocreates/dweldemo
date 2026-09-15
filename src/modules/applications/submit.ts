import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { emitDomainEvent } from '../audit/index.js';
import {
  assertScreeningConsentRecorded,
  createScreeningOrder,
  createScreeningSagaRunner,
  DEVICE_PRESCREEN_GENERIC_MESSAGE,
  ensureStandardPackage,
  evaluateFraudSignals,
  forceApplicationTransition,
  recomputeBadge,
  recordIncomeVerification,
  runPrescreen,
  type PipelineResult,
} from '../screening/index.js';

/**
 * Submit screening for an existing draft application that already has consent.
 * Does not redesign landlord-interest — uses the same transition seam as the
 * existing pipeline (including the unresolved auto-skip of awaiting_landlord_interest).
 */
export async function submitScreeningForApplication(
  client: DbClient,
  input: {
    applicationId: string;
    payerKind?: 'applicant' | 'landlord' | 'broker';
    statedMonthlyIncomeCents?: number | null;
    listingRentCents?: number | null;
    deviceId?: string | null;
    clock?: Clock;
  },
): Promise<PipelineResult> {
  const clock = input.clock ?? systemClock;
  await ensureStandardPackage(client);
  await assertScreeningConsentRecorded(client, input.applicationId);

  const { rows } = await client.query<{
    id: string;
    party_id: string;
    org_id: string;
    listing_id: string | null;
    unit_id: string | null;
    status: string;
    device_id: string | null;
  }>(
    `select id, party_id, org_id, listing_id, unit_id, status, device_id
     from application where id = $1 for update`,
    [input.applicationId],
  );
  const app = rows[0];
  if (!app) throw new AppError('application not found', 'application_not_found', 404);

  if (app.status === 'screening_running' || app.status === 'screened') {
    const { rows: orders } = await client.query<{ id: string }>(
      `select id from screening_order where application_id = $1 order by created_at desc limit 1`,
      [app.id],
    );
    if (!orders[0]) {
      throw new AppError(
        'screening order missing for running application',
        'screening_order_missing',
        500,
      );
    }
    const badgeState = await recomputeBadge(client, app.party_id, clock);
    return {
      applicationId: app.id,
      orderId: orders[0].id,
      workflowId: '',
      status: app.status,
      badgeState,
    };
  }

  if (app.status !== 'draft' && app.status !== 'submitted' && app.status !== 'prescreen') {
    throw new AppError(
      `cannot submit screening from status ${app.status}`,
      'application_invalid_state',
      409,
    );
  }

  let listingRent = input.listingRentCents ?? null;
  if (listingRent == null && app.listing_id) {
    const { rows: listing } = await client.query<{ rent_amount_cents: number }>(
      `select rent_amount_cents from listing where id = $1`,
      [app.listing_id],
    );
    listingRent = listing[0]?.rent_amount_cents ?? null;
  }

  if (app.status === 'draft') {
    await forceApplicationTransition(client, app.id, 'draft', 'submitted', clock);
    await forceApplicationTransition(client, app.id, 'submitted', 'prescreen', clock);
  } else if (app.status === 'submitted') {
    await forceApplicationTransition(client, app.id, 'submitted', 'prescreen', clock);
  }

  const prescreen = await runPrescreen(
    client,
    {
      applicationId: app.id,
      partyId: app.party_id,
      orgId: app.org_id,
      listingRentCents: listingRent,
      statedMonthlyIncomeCents: input.statedMonthlyIncomeCents,
      deviceId: input.deviceId ?? app.device_id,
    },
    clock,
  );

  if (!prescreen.passed) {
    await forceApplicationTransition(client, app.id, 'prescreen', 'prescreen_failed', clock);
    if (prescreen.deviceGate?.failed) {
      throw new AppError(DEVICE_PRESCREEN_GENERIC_MESSAGE, 'prescreen_failed', 422);
    }
    await forceApplicationTransition(client, app.id, 'prescreen_failed', 'closed', clock);
    throw new AppError('prescreen failed', 'prescreen_failed', 422);
  }

  await evaluateFraudSignals(client, {
    partyId: app.party_id,
    applicationId: app.id,
    deviceId: input.deviceId ?? app.device_id,
    clock,
  });

  // Unresolved product decision: auto-skip of awaiting_landlord_interest remains.
  await forceApplicationTransition(client, app.id, 'prescreen', 'awaiting_landlord_interest', clock);
  await client.query(
    `update application
     set status = 'screening_authorized', screening_authorized_at = $2
     where id = $1 and status = 'awaiting_landlord_interest'`,
    [app.id, clock.now()],
  );
  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: app.id,
    eventType: 'application.status_changed',
    payload: { from: 'awaiting_landlord_interest', to: 'screening_authorized' },
    actorKind: 'system',
    occurredAt: clock.now(),
  });

  await recordIncomeVerification(client, {
    partyId: app.party_id,
    method: 'stated',
    monthlyIncomeCents: input.statedMonthlyIncomeCents ?? 500000,
    applicationId: app.id,
    clock,
    useVendor: true,
  });

  const { orderId } = await createScreeningOrder(client, {
    partyId: app.party_id,
    applicationId: app.id,
    payerKind: input.payerKind ?? 'applicant',
    payerPartyId: app.party_id,
    payerOrgId: app.org_id,
    clock,
  });

  await forceApplicationTransition(client, app.id, 'screening_authorized', 'screening_running', clock);

  const runner = createScreeningSagaRunner();
  const { workflowId } = await runner.startScreeningSaga(client, { screeningOrderId: orderId });
  await runner.runToIdle(client, workflowId);

  const badgeState = await recomputeBadge(client, app.party_id, clock);
  const { rows: apps } = await client.query<{ status: string }>(
    `select status from application where id = $1`,
    [app.id],
  );

  return {
    applicationId: app.id,
    orderId,
    workflowId,
    status: apps[0]!.status,
    badgeState,
  };
}

export async function getApplicationStatusSafe(
  client: DbClient,
  applicationId: string,
): Promise<{
  application_id: string;
  status: string;
  screening: { status: string | null; order_id: string | null };
}> {
  const { rows } = await client.query<{ id: string; status: string }>(
    `select id, status from application where id = $1`,
    [applicationId],
  );
  const app = rows[0];
  if (!app) throw new AppError('application not found', 'application_not_found', 404);

  const { rows: orders } = await client.query<{ id: string; status: string }>(
    `select id, status from screening_order
     where application_id = $1
     order by created_at desc
     limit 1`,
    [applicationId],
  );

  return {
    application_id: app.id,
    status: app.status,
    screening: {
      status: orders[0]?.status ?? null,
      order_id: orders[0]?.id ?? null,
    },
  };
}
