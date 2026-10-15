import { createHash, randomUUID } from 'node:crypto';
import type { DbClient } from '../../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { systemClock, type Clock } from '../../shared/clock.js';
import { emitDomainEvent } from '../../audit/index.js';
import { assertScreeningConsentRecorded } from '../consent.js';
import { createScreeningOrder } from '../order.js';
import { forceApplicationTransition } from '../pipeline.js';
import { resolveProviderForNewScreening } from './selection.js';
import { getScreeningProviderAdapter } from './registry.js';
import type {
  NormalizedScreeningStatus,
  ScreeningProviderId,
  ScreeningResults,
} from './types.js';

export type InitiateProviderScreeningInput = {
  applicationId: string;
  actorPartyId: string;
  actorOrgId: string;
  /** Optional override for comparison dashboard — must still be infrastructure-ready. */
  providerOverride?: ScreeningProviderId;
  packageHint?: string;
  sandboxApplicantOverride?: {
    first_name: string;
    last_name: string;
    email?: string;
    dob?: string;
    ssn?: string;
  };
  clock?: Clock;
};

export type InitiateProviderScreeningResult = {
  screeningId: string;
  applicationId: string;
  provider: ScreeningProviderId;
  status: NormalizedScreeningStatus;
  providerOrderId: string | null;
  applicationUrl: string | null;
  environment: string;
  duplicate: boolean;
};

export async function initiateProviderScreening(
  client: DbClient,
  input: InitiateProviderScreeningInput,
): Promise<InitiateProviderScreeningResult> {
  const clock = input.clock ?? systemClock;

  const { rows: apps } = await client.query<{
    id: string;
    party_id: string;
    org_id: string;
    listing_id: string | null;
    status: string;
  }>(
    `select id, party_id, org_id, listing_id, status
     from application where id = $1 for update`,
    [input.applicationId],
  );
  const app = apps[0];
  if (!app) throw new AppError('application not found', 'application_not_found', 404);
  if (app.org_id !== input.actorOrgId) {
    throw new AppError('not authorized for this application', 'screening_forbidden', 403);
  }

  const permitted = new Set([
    'awaiting_consent',
    'screening_authorized',
    'interested',
    'info_requested',
    'screening_running',
  ]);
  if (!permitted.has(app.status)) {
    throw new AppError(
      `cannot initiate screening from status ${app.status}`,
      'application_invalid_state',
      409,
    );
  }

  // App-level dedup across providers — one active screening per application.
  const { rows: existing } = await client.query<{
    id: string;
    provider: ScreeningProviderId;
    status: NormalizedScreeningStatus;
    provider_order_id: string | null;
    application_url: string | null;
    environment: string;
    idempotency_key: string;
  }>(
    `select id, provider, status, provider_order_id, application_url, environment, idempotency_key
     from provider_screening
     where application_id = $1
     order by created_at desc
     limit 1`,
    [app.id],
  );
  const prior = existing[0];
  if (
    prior &&
    (prior.status === 'awaiting_applicant' ||
      prior.status === 'processing' ||
      prior.status === 'completed')
  ) {
    return {
      screeningId: prior.id,
      applicationId: app.id,
      provider: prior.provider,
      status: prior.status,
      providerOrderId: prior.provider_order_id,
      applicationUrl: prior.application_url,
      environment: prior.environment,
      duplicate: true,
    };
  }

  await assertScreeningConsentRecorded(client, app.id);

  const providerId =
    input.providerOverride ?? (await resolveProviderForNewScreening(client));
  const adapter = getScreeningProviderAdapter(providerId);
  if (!adapter.isInfrastructureReady()) {
    throw new AppError(
      `provider ${providerId} not ready`,
      'SCREENING_PROVIDER_UNAVAILABLE',
      503,
    );
  }

  const ctx = await loadContext(client, app, input);

  const screeningId =
    prior && prior.provider === providerId && prior.status !== 'completed'
      ? prior.id
      : randomUUID();
  const orderIdempotencyKey =
    prior && prior.provider === providerId
      ? prior.idempotency_key
      : createHash('sha256')
          .update(`provider_screening:${app.id}:${providerId}:${screeningId}`)
          .digest('hex')
          .slice(0, 48);

  if (!prior || prior.id !== screeningId) {
    await client.query(
      `insert into provider_screening (
         id, application_id, provider, environment, status, idempotency_key,
         property_id, listing_id, applicant_party_id, requester_party_id, requester_org_id
       ) values ($1,$2,$3,$4,'not_requested',$5,$6,$7,$8,$9,$10)`,
      [
        screeningId,
        app.id,
        providerId,
        providerId === 'certn' ? 'sandbox' : 'test',
        orderIdempotencyKey,
        ctx.propertyId,
        app.listing_id,
        app.party_id,
        input.actorPartyId,
        input.actorOrgId,
      ],
    );
  }

  const { orderId } = await createScreeningOrder(client, {
    partyId: app.party_id,
    applicationId: app.id,
    payerKind: 'landlord',
    payerPartyId: input.actorPartyId,
    payerOrgId: input.actorOrgId,
    clock,
  });
  await client.query(
    `update screening_order set provider = $2 where id = $1`,
    [orderId, providerId],
  );
  await client.query(
    `update provider_screening set screening_order_id = $2, updated_at = $3 where id = $1`,
    [screeningId, orderId, clock.now()],
  );

  let created;
  try {
    created = await adapter.createScreeningRequest({
      applicationId: app.id,
      partyId: app.party_id,
      packageHint: input.packageHint,
      idempotencyKey: orderIdempotencyKey,
      property: ctx.property,
      applicant: ctx.applicant,
      originalRequester: ctx.originalRequester,
      correlationId: randomUUID(),
    });
  } catch (err) {
    await client.query(
      `update provider_screening
       set status = 'failed', last_error_code = $2, updated_at = $3
       where id = $1`,
      [screeningId, err instanceof AppError ? err.code : 'provider_create_failed', clock.now()],
    );
    throw err;
  }

  await client.query(
    `update provider_screening
     set status = $2,
         provider_order_id = $3,
         provider_report_id = $4,
         application_url = $5,
         environment = $6,
         product_statuses = $7::jsonb,
         provider_metadata = $8::jsonb,
         updated_at = $9,
         completed_at = case when $2 = 'completed' then $9 else completed_at end
     where id = $1`,
    [
      screeningId,
      created.status,
      created.providerOrderId,
      created.providerReportId ?? null,
      created.applicationUrl ?? null,
      created.environment,
      JSON.stringify(created.productStatuses),
      JSON.stringify(created.providerMetadata),
      clock.now(),
    ],
  );

  await client.query(
    `update screening_order set vendor_order_ref = $2, status = 'submitted' where id = $1`,
    [orderId, created.providerOrderId],
  );

  await advanceApplicationTowardScreening(client, app, input.actorPartyId, clock);

  await emitDomainEvent(client, {
    aggregateType: 'provider_screening',
    aggregateId: screeningId,
    eventType: 'provider_screening.initiated',
    payload: {
      application_id: app.id,
      provider: providerId,
      provider_order_id: created.providerOrderId,
      status: created.status,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
    occurredAt: clock.now(),
  });

  return {
    screeningId,
    applicationId: app.id,
    provider: providerId,
    status: created.status,
    providerOrderId: created.providerOrderId,
    applicationUrl: created.applicationUrl ?? null,
    environment: created.environment,
    duplicate: false,
  };
}

async function advanceApplicationTowardScreening(
  client: DbClient,
  app: { id: string; status: string },
  actorPartyId: string,
  clock: Clock,
): Promise<void> {
  if (app.status === 'awaiting_consent' || app.status === 'screening_authorized') {
    if (app.status === 'awaiting_consent') {
      await forceApplicationTransition(
        client,
        app.id,
        'awaiting_consent',
        'screening_authorized',
        clock,
      );
    }
    await forceApplicationTransition(
      client,
      app.id,
      'screening_authorized',
      'screening_running',
      clock,
    );
  } else if (app.status === 'interested' || app.status === 'info_requested') {
    await client.query(`update application set status = 'screening_running' where id = $1`, [
      app.id,
    ]);
    await emitDomainEvent(client, {
      aggregateType: 'application',
      aggregateId: app.id,
      eventType: 'application.status_changed',
      payload: { from: app.status, to: 'screening_running', via: 'provider_screening' },
      actorPartyId,
      actorKind: 'user',
      occurredAt: clock.now(),
    });
  }
}

async function loadContext(
  client: DbClient,
  app: { id: string; party_id: string; org_id: string; listing_id: string | null },
  input: InitiateProviderScreeningInput,
): Promise<{
  propertyId: string | null;
  property: {
    street: string;
    unit?: string | null;
    city: string;
    state: string;
    zipcode: string;
    name?: string | null;
  };
  applicant: {
    email: string;
    firstName?: string;
    lastName?: string;
    dob?: string;
    ssn?: string;
  };
  originalRequester: {
    externalId: string;
    type: 'business';
    name: string;
  };
}> {
  let propertyId: string | null = null;
  let street = 'Unknown';
  let city = 'Unknown';
  let state = 'XX';
  let zipcode = '00000';
  let unitLabel: string | null = null;

  if (app.listing_id) {
    const { rows } = await client.query<{
      property_id: string;
      line1: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      unit_label: string | null;
    }>(
      `select p.id as property_id, a.line1, a.city, a.state, a.postal_code, u.unit_label
       from listing l
       join unit u on u.id = l.unit_id
       join property p on p.id = u.property_id
       join address a on a.id = p.address_id
       where l.id = $1`,
      [app.listing_id],
    );
    const row = rows[0];
    if (row) {
      propertyId = row.property_id;
      street = row.line1?.trim() || 'Unknown';
      city = row.city?.trim() || 'Unknown';
      state = (row.state?.trim() || 'XX').slice(0, 2).toUpperCase();
      zipcode = row.postal_code?.trim() || '00000';
      unitLabel = row.unit_label;
    }
  }

  const { rows: profiles } = await client.query<{
    given_name: string | null;
    family_name: string | null;
    email: string | null;
  }>(`select given_name, family_name, email from renter_profile where party_id = $1`, [
    app.party_id,
  ]);
  const profile = profiles[0];
  let email = profile?.email?.trim() ?? null;
  let firstName = profile?.given_name?.trim() || 'Applicant';
  let lastName = profile?.family_name?.trim() || 'Unknown';
  if (!email) {
    throw new AppError(
      'applicant email required before screening',
      'screening_applicant_email_required',
      422,
    );
  }

  const override = input.sandboxApplicantOverride;
  if (override) {
    firstName = override.first_name;
    lastName = override.last_name;
    if (override.email) email = override.email;
  }

  const { rows: orgs } = await client.query<{ name: string }>(
    `select name from org where id = $1`,
    [app.org_id],
  );

  return {
    propertyId,
    property: { street, unit: unitLabel, city, state, zipcode },
    applicant: {
      email,
      firstName,
      lastName,
      ...(override?.dob ? { dob: override.dob } : {}),
      ...(override?.ssn ? { ssn: override.ssn } : {}),
    },
    originalRequester: {
      externalId: app.org_id,
      type: 'business',
      name: orgs[0]?.name?.trim() || 'Home Provider',
    },
  };
}

export async function getProviderScreeningForViewer(
  client: DbClient,
  input: {
    applicationId: string;
    viewerPartyId: string;
    viewerOrgId: string | null;
    role: 'renter' | 'landlord' | 'broker' | 'admin';
  },
): Promise<{
  id: string;
  provider: ScreeningProviderId;
  status: NormalizedScreeningStatus;
  application_url: string | null;
  environment: string;
  provider_order_id: string | null;
  provider_report_id: string | null;
  product_statuses: Record<string, unknown>;
  result_summary: Record<string, unknown> | null;
  updated_at: Date;
  completed_at: Date | null;
} | null> {
  const { rows } = await client.query(
    `select id, provider, status, application_url, environment,
            provider_order_id, provider_report_id, product_statuses,
            result_summary, applicant_party_id, requester_org_id,
            updated_at, completed_at
     from provider_screening
     where application_id = $1
     order by created_at desc
     limit 1`,
    [input.applicationId],
  );
  const row = rows[0] as
    | {
        id: string;
        provider: ScreeningProviderId;
        status: NormalizedScreeningStatus;
        application_url: string | null;
        environment: string;
        provider_order_id: string | null;
        provider_report_id: string | null;
        product_statuses: Record<string, unknown>;
        result_summary: Record<string, unknown> | null;
        applicant_party_id: string;
        requester_org_id: string;
        updated_at: Date;
        completed_at: Date | null;
      }
    | undefined;
  if (!row) return null;

  if (input.role === 'renter' && row.applicant_party_id !== input.viewerPartyId) {
    throw new AppError('forbidden', 'screening_forbidden', 403);
  }
  if ((input.role === 'landlord' || input.role === 'broker') && input.viewerOrgId) {
    const { rows: apps } = await client.query<{ org_id: string }>(
      `select org_id from application where id = $1`,
      [input.applicationId],
    );
    if (apps[0]?.org_id !== input.viewerOrgId && row.requester_org_id !== input.viewerOrgId) {
      throw new AppError('forbidden', 'screening_forbidden', 403);
    }
  }
  return row;
}

export async function refreshProviderScreeningResults(
  client: DbClient,
  screeningId: string,
  clock: Clock = systemClock,
): Promise<ScreeningResults | null> {
  const { rows } = await client.query<{
    id: string;
    provider: ScreeningProviderId;
    provider_order_id: string | null;
  }>(`select id, provider, provider_order_id from provider_screening where id = $1`, [
    screeningId,
  ]);
  const row = rows[0];
  if (!row?.provider_order_id) return null;

  // Historical provider remains bound even if disabled for new orders.
  const adapter = getScreeningProviderAdapter(row.provider);
  if (!adapter.isInfrastructureReady()) {
    throw new AppError(
      'historical provider credentials unavailable',
      'SCREENING_PROVIDER_UNAVAILABLE',
      503,
    );
  }
  const results = await adapter.getScreeningResults(row.provider_order_id);
  await client.query(
    `update provider_screening
     set status = $2,
         provider_report_id = coalesce($3, provider_report_id),
         product_statuses = $4::jsonb,
         result_summary = $5::jsonb,
         updated_at = $6,
         completed_at = case when $2 = 'completed' then coalesce(completed_at, $6) else completed_at end
     where id = $1`,
    [
      screeningId,
      results.status,
      results.providerReportId,
      JSON.stringify(results.products),
      JSON.stringify({
        overall_result: results.overallResult,
        review_required: results.reviewRequired,
        products: results.products,
      }),
      clock.now(),
    ],
  );
  return results;
}
