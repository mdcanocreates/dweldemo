import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import { withTenantContext } from '../db/tenant.js';
import type { DbPool } from '../db/pool.js';
import { issueApplicationAccessToken } from '../modules/auth/index.js';
import {
  checkApplicationCreationRateLimit,
  createPublicApplication,
} from '../modules/applications/index.js';
import { payAndRecordConsent } from '../modules/applications/pay-consent.js';
import {
  assertInterestScreeningGate,
  getLatestValidNyReport,
  getRenterIntake,
  getRenterProfile,
  getApplicationIntakeDetail,
  isIntakeComplete,
  MOVE_IN_URGENCY,
  recordApplicantPurchasedReport,
  recordApplicantSuppliedReport,
  resolveFcraConsentCopy,
  screeningFeeForState,
  snapshotIntakeOnApplication,
  upsertRenterIntake,
  upsertRenterProfile,
} from '../modules/renter/index.js';
import { computeAndStoreRulesMatchScore } from '../modules/matching/rules-match-score.js';
import { AppError } from '../modules/shared/errors.js';
import { requireSession } from './session-auth.js';
import { requireApplicationAccess } from './application-auth.js';
import { getClientIp, getUserAgent, readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';

export type RenterHandlerDeps = {
  pool: DbPool;
};

const profileSchema = z.object({
  given_name: z.string().min(1).max(100),
  family_name: z.string().min(1).max(100),
  phone: z.string().min(7).max(32),
  email: z.string().email().max(320),
  annual_income_cents: z.number().int().nonnegative(),
  move_in_urgency: z.enum(MOVE_IN_URGENCY),
  bedrooms_min: z.number().nonnegative(),
  rent_max_cents: z.number().int().positive(),
  state: z.string().min(2).max(2),
  has_pets: z.boolean(),
  household_size: z.number().int().positive(),
});

const nyUploadSchema = z.object({
  completed_at: z.string().datetime({ offset: true }).or(z.string().date()),
  original_filename: z.string().min(1).max(260).optional(),
  content_type: z.string().min(3).max(120).optional(),
  /** DEV: opaque storage key / data-URL stand-in until S3 upload adapter is wired for reports */
  storage_key: z.string().min(1).max(2000).optional(),
});

const payConsentSchema = z.object({
  agreed: z.literal(true),
  /** @deprecated Ignored — server charges PaymentRail; never authorizes payment. */
  payment_confirmed: z.boolean().optional(),
  ny_path2: z.boolean().optional(),
  payment_intent_id: z.string().min(3).max(200).optional(),
});

export async function handleGetRenterProfile(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const profile = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId },
      (client) => getRenterProfile(client, identity.partyId),
    );
    if (!profile) {
      sendJson(res, 404, { error: 'profile_not_found', message: 'renter profile not found' });
      return;
    }
    sendJson(res, 200, { profile });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleUpsertRenterProfile(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const body = profileSchema.parse(await readJsonBody(req));
    const profile = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId },
      (client) =>
        upsertRenterProfile(client, identity.partyId, {
          givenName: body.given_name,
          familyName: body.family_name,
          phoneE164: body.phone,
          email: body.email,
          annualIncomeCents: body.annual_income_cents,
          moveInUrgency: body.move_in_urgency,
          bedroomsMin: body.bedrooms_min,
          rentMaxCents: body.rent_max_cents,
          preferredState: body.state,
          hasPets: body.has_pets,
          householdSize: body.household_size,
        }),
    );
    sendJson(res, 200, { profile });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleGetScreeningFee(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://local');
    const state = url.searchParams.get('state');
    let resolvedState = state;
    try {
      const identity = await requireSession(deps.pool, req);
      if (!resolvedState) {
        const profile = await withTenantContext(
          deps.pool,
          { partyId: identity.partyId },
          (client) => getRenterProfile(client, identity.partyId),
        );
        resolvedState = profile?.preferred_state ?? null;
      }
    } catch {
      // public fee lookup by ?state= is allowed
    }
    const fee = await withSystemBypass(deps.pool, (client) =>
      screeningFeeForState(client, resolvedState),
    );
    sendJson(res, 200, { fee });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleGetConsentCopy(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const copy = await withSystemBypass(deps.pool, (client) => resolveFcraConsentCopy(client));
    sendJson(res, 200, { consent: copy });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleListMyApplications(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const rows = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId },
      async (client) => {
        const { rows: apps } = await client.query<{
          id: string;
          status: string;
          listing_id: string | null;
          created_at: Date;
          city: string | null;
          state: string | null;
          line1: string | null;
          rent_amount_cents: number | null;
        }>(
          `select a.id, a.status, a.listing_id, a.created_at,
                  addr.city, addr.state, addr.line1, l.rent_amount_cents
           from application a
           left join listing l on l.id = a.listing_id
           left join unit u on u.id = a.unit_id
           left join property p on p.id = u.property_id
           left join address addr on addr.id = p.address_id
           where a.party_id = $1
           order by a.created_at desc
           limit 100`,
          [identity.partyId],
        );
        return apps;
      },
    );
    sendJson(res, 200, {
      applications: rows.map((a) => ({
        application_id: a.id,
        status: a.status,
        listing_id: a.listing_id,
        created_at: a.created_at.toISOString(),
        listing: a.listing_id
          ? {
              line1: a.line1,
              city: a.city,
              state: a.state,
              rent_amount_cents: a.rent_amount_cents,
            }
          : null,
      })),
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleCreateInterestApplication(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const body = z
      .object({ listing_id: z.string().uuid(), device_id: z.string().max(256).optional() })
      .parse(await readJsonBody(req));
    const ip = getClientIp(req);
    checkApplicationCreationRateLimit({ ip, listingId: body.listing_id });

    const listingOrg = await withTenantContext(deps.pool, {}, async (client) => {
      const { rows } = await client.query<{ org_id: string; status: string }>(
        `select org_id, status from listing where id = $1`,
        [body.listing_id],
      );
      const row = rows[0];
      if (!row) throw new AppError('listing not found', 'listing_not_found', 404);
      if (row.status !== 'active') {
        throw new AppError('listing not available', 'listing_not_available', 409);
      }
      return row.org_id;
    });

    const created = await withTenantContext(
      deps.pool,
      { orgId: listingOrg, partyId: identity.partyId },
      async (client) => {
        const profile = await getRenterProfile(client, identity.partyId);
        if (!(await isIntakeComplete(client, identity.partyId))) {
          throw new AppError(
            'complete rental application intake before expressing interest',
            'intake_required',
            409,
          );
        }
        const gate = await assertInterestScreeningGate(
          client,
          identity.partyId,
          profile?.preferred_state ?? null,
        );
        if (!gate.ok) {
          throw new AppError(
            gate.reason === 'ny_report_expired'
              ? 'NY screening report expired'
              : 'NY screening report required',
            gate.reason,
            409,
          );
        }

        const app = await createPublicApplication(client, {
          listingId: body.listing_id,
          deviceId: body.device_id ?? null,
          ip,
          partyId: identity.partyId,
          initialStatus: 'awaiting_landlord_interest',
        });
        if (!app.reused) {
          await snapshotIntakeOnApplication(client, app.applicationId, identity.partyId);
        }
        const score = await computeAndStoreRulesMatchScore(client, app.applicationId);
        await client.query(`select set_config('rbit.current_party_id', $1, true)`, [
          identity.partyId,
        ]);
        const token = await issueApplicationAccessToken(client, {
          applicationId: app.applicationId,
          ip,
        });
        return { app, token, score };
      },
    );

    sendJson(res, created.app.reused ? 200 : 201, {
      application_id: created.app.applicationId,
      listing_id: created.app.listingId,
      status: created.app.status,
      access_token: created.token.token,
      access_token_expires_at: created.token.expiresAt.toISOString(),
      reused: created.app.reused,
      match_score_value: created.score.match_score_value,
      match_score_version: created.score.match_score_version,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleNyScreeningChoiceStatus(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const result = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId },
      async (client) => {
        const profile = await getRenterProfile(client, identity.partyId);
        const report = await getLatestValidNyReport(client, identity.partyId);
        const fee = await screeningFeeForState(client, 'NY');
        return { profile, report, fee };
      },
    );
    sendJson(res, 200, {
      state: result.profile?.preferred_state ?? null,
      report: result.report,
      path2_fee: result.fee,
      path2_tag: 'interim_v1',
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleNyUploadReport(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const body = nyUploadSchema.parse(await readJsonBody(req));
    const completedAt = new Date(body.completed_at);
    const report = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId },
      (client) =>
        recordApplicantSuppliedReport(client, {
          partyId: identity.partyId,
          completedAt,
          stateJurisdiction: 'NY',
          storageKey: body.storage_key ?? `dev-upload:${identity.partyId}:${Date.now()}`,
          originalFilename: body.original_filename ?? null,
          contentType: body.content_type ?? null,
        }),
    );
    sendJson(res, 201, { report });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handlePayAndConsent(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const body = payConsentSchema.parse(await readJsonBody(req));
    const ip = getClientIp(req);

    let partyId: string;
    let orgId: string;

    try {
      const session = await requireSession(deps.pool, req);
      const owned = await withSystemBypass(deps.pool, async (client) => {
        const { rows } = await client.query<{ org_id: string }>(
          `select org_id from application where id = $1 and party_id = $2`,
          [applicationId, session.partyId],
        );
        return rows[0] ?? null;
      });
      if (!owned) {
        throw new AppError('forbidden', 'auth_forbidden', 403);
      }
      partyId = session.partyId;
      orgId = owned.org_id;
    } catch (sessionErr) {
      if (sessionErr instanceof AppError && sessionErr.code === 'auth_forbidden') {
        throw sessionErr;
      }
      const auth = await withSystemBypass(deps.pool, (client) =>
        requireApplicationAccess(client, req, applicationId),
      );
      partyId = auth.partyId;
      orgId = auth.orgId;
    }

    const result = await withTenantContext(
      deps.pool,
      { orgId, partyId },
      (client) =>
        payAndRecordConsent(client, {
          applicationId,
          partyId,
          orgId,
          consentIp: ip,
          consentUserAgent: getUserAgent(req),
          nyPath2: body.ny_path2,
          paymentIntentId: body.payment_intent_id ?? null,
        }),
    );
    sendJson(res, 201, {
      application_id: applicationId,
      ...result,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

/** NY Path 2 — purchase screening through RBIT (interim_v1), no application required. */
export async function handleNyPath2Purchase(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const body = z
      .object({
        agreed: z.literal(true),
        /** @deprecated Ignored — server charges PaymentRail. */
        payment_confirmed: z.boolean().optional(),
      })
      .parse(await readJsonBody(req));
    void body;
    const identity = await requireSession(deps.pool, req);
    const result = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId },
      async (client) => {
        const profile = await getRenterProfile(client, identity.partyId);
        if ((profile?.preferred_state ?? '').toUpperCase() !== 'NY') {
          throw new AppError('Path 2 is NY-only', 'validation_error', 400);
        }
        const fee = await screeningFeeForState(client, 'NY');
        const { getVendorRegistry } = await import('../modules/vendors/index.js');
        const { postLedgerTransaction } = await import('../modules/ledger/index.js');
        const rail = getVendorRegistry().paymentRail();
        const charge = await rail.createCharge({
          amountCents: fee.amount_cents,
          currency: 'usd',
          idempotencyKey: `ny_path2:${identity.partyId}:${new Date().toISOString().slice(0, 10)}`,
          metadata: { kind: 'ny_path2_screening', party_id: identity.partyId },
        });
        if (charge.status === 'failed') {
          throw new AppError('payment failed', 'payment_failed', 402);
        }
        await postLedgerTransaction(client, {
          kind: 'applicant_screening_fee',
          idempotencyKey: `ledger:ny_path2:${identity.partyId}:${charge.chargeId}`,
          memo: 'NY Path 2 interim_v1 applicant_screening_fee',
          lines: [
            {
              accountCode: 'asset:cash:stripe',
              direction: 'dr',
              amountCents: fee.amount_cents,
              counterpartyPartyId: identity.partyId,
            },
            {
              accountCode: 'revenue:rbit_screening_revenue',
              direction: 'cr',
              amountCents: fee.amount_cents,
            },
          ],
        });
        const report = await recordApplicantPurchasedReport(client, {
          partyId: identity.partyId,
          stateJurisdiction: 'NY',
        });
        return {
          fee_cents: fee.amount_cents,
          charge_id: charge.chargeId,
          report,
          tag: 'interim_v1' as const,
        };
      },
    );
    sendJson(res, 201, result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleGetRenterIntake(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const result = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId },
      async (client) => {
        const intake = await getRenterIntake(client, identity.partyId);
        const profile = await getRenterProfile(client, identity.partyId);
        return {
          intake,
          complete: Boolean(intake && intake.completed_at),
          profile,
        };
      },
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleUpsertRenterIntake(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const body = z
      .object({
        current_address_line1: z.string().max(200).optional(),
        current_address_city: z.string().max(100).optional(),
        current_address_state: z.string().max(2).optional(),
        current_address_postal: z.string().max(20).optional(),
        current_address_move_in: z.string().date().optional(),
        employer_name: z.string().max(200).optional(),
        job_title: z.string().max(120).optional(),
        employer_phone: z.string().max(40).optional(),
        employment_length_months: z.number().int().nonnegative().optional(),
        monthly_gross_income_cents: z.number().int().nonnegative().optional(),
        occupants: z.array(z.record(z.unknown())).optional(),
        pets: z.array(z.record(z.unknown())).optional(),
        emergency_contact: z.record(z.unknown()).nullable().optional(),
        vehicle: z.record(z.unknown()).nullable().optional(),
        mark_complete: z.boolean().optional(),
      })
      .parse(await readJsonBody(req));

    const saved = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId },
      (client) => upsertRenterIntake(client, identity.partyId, body),
    );
    sendJson(res, 200, { intake: saved });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleGetApplicationIntakeDetail(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const detail = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId },
      (client) =>
        getApplicationIntakeDetail(client, {
          applicationId,
          partyId: identity.partyId,
        }),
    );
    sendJson(res, 200, detail);
  } catch (err) {
    sendError(res, err);
  }
}
