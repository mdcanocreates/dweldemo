import { createHash, randomUUID } from 'node:crypto';
import type { DbClient } from '../../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { systemClock, type Clock } from '../../shared/clock.js';
import { emitDomainEvent } from '../../audit/index.js';
import { assertScreeningConsentRecorded } from '../consent.js';
import { createScreeningOrder } from '../order.js';
import { forceApplicationTransition } from '../pipeline.js';
import {
  assessCheckrAvailability,
  createCheckrTenantClientFromEnv,
  type CheckrPackageSlug,
  type CheckrOriginalRequesterInline,
} from '../../vendors/checkr/index.js';
import {
  getCheckrScreeningByApplication,
  type CheckrScreeningRow,
  type CheckrScreeningStatus,
} from './state.js';

const ALLOWED_PACKAGES: CheckrPackageSlug[] = ['starter', 'essential', 'complete'];

export type InitiateCheckrScreeningInput = {
  applicationId: string;
  /** Authenticated actor (home provider / system). */
  actorPartyId: string;
  actorOrgId: string;
  packageSlug?: CheckrPackageSlug;
  /**
   * Sandbox-only: canned applicant profile fields (never use real SSN in sandbox).
   * Production must omit dob/ssn so Checkr hosted UX collects them.
   */
  sandboxApplicantOverride?: {
    first_name: string;
    last_name: string;
    email?: string;
    dob?: string;
    ssn?: string;
  };
  clock?: Clock;
};

export type InitiateCheckrScreeningResult = {
  screeningId: string;
  applicationId: string;
  status: CheckrScreeningStatus;
  checkrOrderId: string | null;
  applicationUrl: string | null;
  environment: 'test' | 'live';
  duplicate: boolean;
};

/**
 * Authorized Checkr Tenant screening initiation.
 * Enforces application-level deduplication (Checkr test mode does not).
 */
export async function initiateCheckrScreening(
  client: DbClient,
  input: InitiateCheckrScreeningInput,
): Promise<InitiateCheckrScreeningResult> {
  const clock = input.clock ?? systemClock;
  const availability = assessCheckrAvailability();
  if (!availability.available) {
    throw new AppError(
      'Checkr Tenant screening is not available',
      'SCREENING_PROVIDER_UNAVAILABLE',
      503,
    );
  }

  const packageSlug = (input.packageSlug ?? 'essential') as CheckrPackageSlug;
  if (!ALLOWED_PACKAGES.includes(packageSlug)) {
    throw new AppError('invalid screening package', 'checkr_invalid_package', 422);
  }

  const { rows: apps } = await client.query<{
    id: string;
    party_id: string;
    org_id: string;
    listing_id: string | null;
    unit_id: string | null;
    status: string;
  }>(
    `select id, party_id, org_id, listing_id, unit_id, status
     from application where id = $1 for update`,
    [input.applicationId],
  );
  const app = apps[0];
  if (!app) {
    throw new AppError('application not found', 'application_not_found', 404);
  }

  // Requester org must own the application (home provider org).
  if (app.org_id !== input.actorOrgId) {
    throw new AppError(
      'not authorized to initiate screening for this application',
      'checkr_forbidden',
      403,
    );
  }

  const permittedStatuses = new Set([
    'awaiting_consent',
    'screening_authorized',
    'interested',
    'info_requested',
    'screening_running',
  ]);
  if (!permittedStatuses.has(app.status)) {
    throw new AppError(
      `cannot initiate Checkr screening from status ${app.status}`,
      'application_invalid_state',
      409,
    );
  }

  // App-level dedup — return existing active/completed screening.
  const existing = await getCheckrScreeningByApplication(client, app.id);
  if (existing) {
    if (
      existing.status === 'awaiting_applicant' ||
      existing.status === 'processing' ||
      existing.status === 'completed'
    ) {
      return {
        screeningId: existing.id,
        applicationId: app.id,
        status: existing.status,
        checkrOrderId: existing.checkr_order_id,
        applicationUrl: existing.application_url,
        environment: existing.environment as 'test' | 'live',
        duplicate: true,
      };
    }
    if (existing.status === 'not_requested' && existing.checkr_order_id) {
      return {
        screeningId: existing.id,
        applicationId: app.id,
        status: existing.status,
        checkrOrderId: existing.checkr_order_id,
        applicationUrl: existing.application_url,
        environment: existing.environment as 'test' | 'live',
        duplicate: true,
      };
    }
  }

  await assertScreeningConsentRecorded(client, app.id);

  const ctx = await loadOrderContext(client, app, input);
  const idempotencyKey =
    existing?.idempotency_key ??
    createHash('sha256')
      .update(`checkr:${app.id}:${packageSlug}:${availability.mode}`)
      .digest('hex')
      .slice(0, 48);

  const screeningId = existing?.id ?? randomUUID();
  if (!existing) {
    await client.query(
      `insert into checkr_tenant_screening (
         id, application_id, property_id, listing_id, applicant_party_id,
         requester_party_id, requester_org_id, package_slug, payer,
         environment, status, idempotency_key
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,'organization',$9,'not_requested',$10)`,
      [
        screeningId,
        app.id,
        ctx.propertyId,
        app.listing_id,
        app.party_id,
        input.actorPartyId,
        input.actorOrgId,
        packageSlug,
        availability.mode,
        idempotencyKey,
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
    `update checkr_tenant_screening set screening_order_id = $2, updated_at = $3 where id = $1`,
    [screeningId, orderId, clock.now()],
  );

  const checkr = createCheckrTenantClientFromEnv();
  let order;
  try {
    order = await checkr.createOrder(
      {
        order: {
          package: packageSlug,
          payer: 'organization',
          property: ctx.property,
          applicant: ctx.applicant,
          ...(ctx.originalRequester
            ? { original_requester: ctx.originalRequester }
            : {}),
        },
      },
      { idempotencyKey },
    );
  } catch (err) {
    await client.query(
      `update checkr_tenant_screening
       set status = 'failed', last_error_code = $2, updated_at = $3
       where id = $1`,
      [
        screeningId,
        err instanceof AppError ? err.code : 'checkr_order_failed',
        clock.now(),
      ],
    );
    throw err;
  }

  const nextStatus: CheckrScreeningStatus =
    order.status === 'waiting_for_applicant' || order.application_url
      ? 'awaiting_applicant'
      : order.status === 'completed'
        ? 'completed'
        : order.status === 'canceled'
          ? 'canceled'
          : 'processing';

  await client.query(
    `update checkr_tenant_screening
     set status = $2,
         checkr_order_id = $3,
         checkr_applicant_id = $4,
         checkr_property_id = $5,
         application_url = $6,
         updated_at = $7,
         completed_at = case when $2 = 'completed' then $7 else completed_at end
     where id = $1`,
    [
      screeningId,
      nextStatus,
      order.id,
      order.applicant_id,
      order.property_id,
      order.application_url ?? null,
      clock.now(),
    ],
  );

  await client.query(
    `update screening_order set vendor_order_ref = $2, status = 'submitted' where id = $1`,
    [orderId, order.id],
  );

  // Advance application leasing status without inventing new statuses.
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
  } else if (
    app.status === 'interested' ||
    app.status === 'info_requested'
  ) {
    // HP may initiate after interest if consent already recorded.
    await client.query(
      `update application set status = 'screening_running' where id = $1`,
      [app.id],
    );
    await emitDomainEvent(client, {
      aggregateType: 'application',
      aggregateId: app.id,
      eventType: 'application.status_changed',
      payload: { from: app.status, to: 'screening_running', via: 'checkr_initiate' },
      actorPartyId: input.actorPartyId,
      actorKind: 'user',
      occurredAt: clock.now(),
    });
  }

  await emitDomainEvent(client, {
    aggregateType: 'checkr_tenant_screening',
    aggregateId: screeningId,
    eventType: 'checkr_screening.initiated',
    payload: {
      application_id: app.id,
      checkr_order_id: order.id,
      status: nextStatus,
      environment: availability.mode,
      // Never include applicant PII / SSN
      package: packageSlug,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
    occurredAt: clock.now(),
  });

  return {
    screeningId,
    applicationId: app.id,
    status: nextStatus,
    checkrOrderId: order.id,
    applicationUrl: order.application_url ?? null,
    environment: availability.mode,
    duplicate: false,
  };
}

async function loadOrderContext(
  client: DbClient,
  app: {
    id: string;
    party_id: string;
    org_id: string;
    listing_id: string | null;
    unit_id: string | null;
  },
  input: InitiateCheckrScreeningInput,
): Promise<{
  propertyId: string | null;
  property: {
    name?: string | null;
    street: string;
    unit?: string | null;
    city: string;
    state: string;
    zipcode: string;
  };
  applicant: {
    email: string;
    first_name?: string;
    last_name?: string;
    dob?: string;
    ssn?: string;
  };
  originalRequester: CheckrOriginalRequesterInline;
}> {
  // Property from listing → unit → property → address (reuse Dwel catalog — no second catalog).
  let propertyId: string | null = null;
  let street = 'Unknown';
  let city = 'Unknown';
  let state = 'XX';
  let zipcode = '00000';
  let unitLabel: string | null = null;
  let propertyName: string | null = null;

  if (app.listing_id) {
    const { rows } = await client.query<{
      property_id: string;
      line1: string | null;
      line2: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      unit_label: string | null;
    }>(
      `select p.id as property_id,
              a.line1, a.line2, a.city, a.state, a.postal_code,
              u.unit_label
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
      unitLabel = row.unit_label ?? row.line2;
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
      'applicant email required before Checkr screening',
      'checkr_applicant_email_required',
      422,
    );
  }

  const override = input.sandboxApplicantOverride;
  if (override) {
    const mode = assessCheckrAvailability();
    if (!mode.available || mode.mode !== 'test') {
      throw new AppError(
        'sandbox applicant overrides are test-mode only',
        'checkr_sandbox_override_forbidden',
        403,
      );
    }
    firstName = override.first_name;
    lastName = override.last_name;
    if (override.email) email = override.email;
  }

  const { rows: orgs } = await client.query<{ name: string }>(
    `select name from org where id = $1`,
    [app.org_id],
  );
  const orgName = orgs[0]?.name?.trim() || 'Home Provider';

  const originalRequester: CheckrOriginalRequesterInline = {
    external_id: app.org_id,
    type: 'business',
    name: orgName,
  };

  return {
    propertyId,
    property: {
      name: propertyName,
      street,
      unit: unitLabel,
      city,
      state,
      zipcode,
    },
    applicant: {
      email,
      first_name: firstName,
      last_name: lastName,
      ...(override?.dob ? { dob: override.dob } : {}),
      ...(override?.ssn ? { ssn: override.ssn } : {}),
    },
    originalRequester,
  };
}

export async function getCheckrScreeningForAuthorizedViewer(
  client: DbClient,
  input: {
    applicationId: string;
    viewerPartyId: string;
    viewerOrgId: string | null;
    role: 'renter' | 'landlord' | 'broker' | 'admin';
  },
): Promise<CheckrScreeningRow | null> {
  const screening = await getCheckrScreeningByApplication(client, input.applicationId);
  if (!screening) return null;

  if (input.role === 'renter') {
    if (screening.applicant_party_id !== input.viewerPartyId) {
      throw new AppError('forbidden', 'checkr_forbidden', 403);
    }
    return screening;
  }

  if (input.role === 'landlord' || input.role === 'broker') {
    if (!input.viewerOrgId || screening.requester_org_id !== input.viewerOrgId) {
      // Also allow if application.org_id matches viewer org.
      const { rows } = await client.query<{ org_id: string }>(
        `select org_id from application where id = $1`,
        [input.applicationId],
      );
      if (!rows[0] || rows[0].org_id !== input.viewerOrgId) {
        throw new AppError('forbidden', 'checkr_forbidden', 403);
      }
    }
    return screening;
  }

  if (input.role === 'admin') return screening;
  throw new AppError('forbidden', 'checkr_forbidden', 403);
}
