import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import { withTenantContext } from '../db/tenant.js';
import type { DbPool } from '../db/pool.js';
import { issueApplicationAccessToken } from '../modules/auth/index.js';
import {
  buildApplicationProgress,
  checkApplicationCreationRateLimit,
  createPublicApplication,
  payAndRecordConsent,
} from '../modules/applications/index.js';
import {
  acknowledgeLeaseDocument,
  listRenterLeaseDocuments,
  signGetUrlForRenter,
} from '../modules/lease/index.js';
import { snapshotApplicationAttribution } from '../modules/attribution/index.js';
import { findReusableScreening } from '../modules/screening/reuse.js';
import {
  assertInterestScreeningGate,
  getLatestValidNyReport,
  getRenterIntake,
  getRenterProfile,
  getApplicationIntakeDetail,
  getScreeningCenter,
  isIntakeComplete,
  listSavedListings,
  addSavedListing,
  removeSavedListing,
  respondToMissingInfo,
  uploadMissingInfoDocument,
  signMissingInfoDocumentUrl,
  MOVE_IN_URGENCY,
  recordApplicantPurchasedReport,
  recordApplicantSuppliedReport,
  resolveFcraConsentCopy,
  screeningFeeForState,
  snapshotIntakeOnApplication,
  upsertRenterIntake,
  upsertRenterProfile,
} from '../modules/renter/index.js';
import {
  createSupportCase,
  listSupportCases,
  SUPPORT_CATEGORIES,
} from '../modules/support/index.js';
import { listCashbackForParty } from '../modules/cashback/index.js';
import { freezeCriteriaOnInterest } from '../modules/listings/criteria.js';
import { computeAndStoreRulesMatchScore } from '../modules/matching/rules-match-score.js';
import { AppError } from '../modules/shared/errors.js';
import { requireSession } from './session-auth.js';
import { requireApplicationAccess } from './application-auth.js';
import { getClientIp, getUserAgent, readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';
import { resolveActivePreviewContext } from './preview-context.js';
import type { SessionIdentity } from '../modules/auth/session.js';

export type RenterHandlerDeps = {
  pool: DbPool;
};

/** Preview as renter uses seeded renter party — never mutates signed-in party_role. */
async function effectiveRenterPartyId(
  pool: DbPool,
  req: IncomingMessage,
  identity: SessionIdentity,
): Promise<{ partyId: string; preview: boolean }> {
  const preview = await resolveActivePreviewContext(pool, req);
  if (preview?.role === 'renter' && preview.previewPartyId) {
    return { partyId: preview.previewPartyId, preview: true };
  }
  return { partyId: identity.partyId, preview: false };
}

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
  preferred_lease_term_months: z.number().int().positive().max(60).optional().nullable(),
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
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const profile = await withTenantContext(
      deps.pool,
      { partyId },
      (client) => getRenterProfile(client, partyId),
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
          preferredLeaseTermMonths: body.preferred_lease_term_months,
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
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const rows = await withTenantContext(
      deps.pool,
      { partyId },
      async (client) => {
        // Charter tables may be absent until 0064/0065 — degrade gracefully.
        const { rows: caps } = await client.query<{ lease: string | null; cash: string | null }>(
          `select to_regclass('public.lease_document')::text as lease,
                  to_regclass('public.cashback_eligibility')::text as cash`,
        );
        const hasLease = Boolean(caps[0]?.lease);
        const hasCash = Boolean(caps[0]?.cash);
        const leaseExpr = hasLease
          ? `(select ld.workflow_status from lease_document ld
                where ld.application_id = a.id
                order by ld.created_at desc limit 1)`
          : `null::text`;
        const cashExpr = hasCash
          ? `(select ce.status from cashback_eligibility ce
                where ce.application_id = a.id
                order by ce.created_at desc limit 1)`
          : `null::text`;
        const { rows: apps } = await client.query<{
          id: string;
          status: string;
          listing_id: string | null;
          created_at: Date;
          move_forward_at: Date | null;
          passed_at: Date | null;
          info_requested_at: Date | null;
          screening_authorized_at: Date | null;
          screened_at: Date | null;
          closed_at: Date | null;
          contact_revealed_at: Date | null;
          city: string | null;
          state: string | null;
          line1: string | null;
          rent_amount_cents: number | null;
          reuse_grant: string | null;
          fee_paid: string | null;
          lease_workflow: string | null;
          cashback_status: string | null;
        }>(
          `select a.id, a.status, a.listing_id, a.created_at,
                  a.move_forward_at, a.passed_at, a.info_requested_at,
                  a.screening_authorized_at, a.screened_at, a.closed_at,
                  a.contact_revealed_at,
                  addr.city, addr.state, addr.line1, l.rent_amount_cents,
                  (select sra.id::text from screening_report_access sra
                    where sra.application_id = a.id limit 1) as reuse_grant,
                  (select lt.id::text from ledger_transaction lt
                    where lt.idempotency_key in (
                      'ledger:screening_fee:' || a.id::text,
                      'ledger:preview_screening_fee:' || a.id::text
                    ) limit 1) as fee_paid,
                  ${leaseExpr} as lease_workflow,
                  ${cashExpr} as cashback_status
           from application a
           left join listing l on l.id = a.listing_id
           left join unit u on u.id = a.unit_id
           left join property p on p.id = u.property_id
           left join address addr on addr.id = p.address_id
           where a.party_id = $1
           order by a.created_at desc
           limit 100`,
          [partyId],
        );
        return apps;
      },
    );

    const appsWithMir = await withTenantContext(
      deps.pool,
      { partyId },
      async (client) => {
        const { rows: hasMir } = await client.query<{ t: string | null }>(
          `select to_regclass('public.missing_info_request')::text as t`,
        );
        if (!hasMir[0]?.t) {
          return rows.map((a) => ({ app: a, missing: null as null | Record<string, unknown> }));
        }
        const out = [];
        for (const a of rows) {
          const { rows: sprint2 } = await client.query<{ c: string | null }>(
            `select to_regclass('public.missing_info_request_document')::text as c`,
          );
          const hasSprint2 = Boolean(sprint2[0]?.c);
          const { rows: mir } = await client.query<{
            id: string;
            status: string;
            categories: string[];
            message: string | null;
            required_document_types: string[] | null;
            review_note: string | null;
            response_version: number | null;
            renter_response: string | null;
            responded_at: Date | null;
          }>(
            hasSprint2
              ? `select id, status, categories, message,
                      coalesce(required_document_types, '{}') as required_document_types,
                      review_note, coalesce(response_version, 0) as response_version,
                      renter_response, responded_at
               from missing_info_request
               where application_id = $1
                 and status in ('open', 'returned', 'responded', 'accepted')
               order by created_at desc
               limit 1`
              : `select id, status, categories, message,
                      '{}'::text[] as required_document_types,
                      null::text as review_note, 0 as response_version,
                      renter_response, responded_at
               from missing_info_request
               where application_id = $1
                 and status in ('open', 'responded', 'cancelled')
               order by created_at desc
               limit 1`,
            [a.id],
          );
          const m = mir[0];
          out.push({
            app: a,
            missing: m
              ? {
                  id: m.id,
                  status: m.status,
                  categories: m.categories,
                  message: m.message,
                  required_document_types: m.required_document_types ?? [],
                  review_note: m.review_note,
                  response_version: m.response_version ?? 0,
                  renter_response: m.renter_response,
                  responded_at: m.responded_at?.toISOString() ?? null,
                }
              : null,
          });
        }
        return out;
      },
    );

    sendJson(res, 200, {
      applications: appsWithMir.map(({ app: a, missing }) => {
        const created = a.created_at.toISOString();
        const progress = buildApplicationProgress({
          status: a.status,
          created_at: created,
          move_forward_at: a.move_forward_at?.toISOString() ?? null,
          passed_at: a.passed_at?.toISOString() ?? null,
          info_requested_at: a.info_requested_at?.toISOString() ?? null,
          screening_authorized_at: a.screening_authorized_at?.toISOString() ?? null,
          screened_at: a.screened_at?.toISOString() ?? null,
          closed_at: a.closed_at?.toISOString() ?? null,
          contact_revealed_at: a.contact_revealed_at?.toISOString() ?? null,
          reused_report: Boolean(a.reuse_grant),
          fee_paid: Boolean(a.fee_paid),
          lease_workflow_status: a.lease_workflow,
          cashback_status: a.cashback_status,
        });
        return {
          application_id: a.id,
          status: a.status,
          listing_id: a.listing_id,
          created_at: created,
          move_forward_at: a.move_forward_at?.toISOString() ?? null,
          passed_at: a.passed_at?.toISOString() ?? null,
          info_requested_at: a.info_requested_at?.toISOString() ?? null,
          screening_authorized_at: a.screening_authorized_at?.toISOString() ?? null,
          screened_at: a.screened_at?.toISOString() ?? null,
          closed_at: a.closed_at?.toISOString() ?? null,
          contact_revealed_at: a.contact_revealed_at?.toISOString() ?? null,
          progress,
          open_missing_info: missing,
          listing: a.listing_id
            ? {
                line1: a.line1,
                city: a.city,
                state: a.state,
                rent_amount_cents: a.rent_amount_cents,
              }
            : null,
        };
      }),
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
          await snapshotApplicationAttribution(client, app.applicationId, identity.partyId);
        }
        // Freeze active criteria + prequal snapshot (idempotent if already frozen)
        await freezeCriteriaOnInterest(client, app.applicationId);
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
    let preview = false;

    try {
      const session = await requireSession(deps.pool, req);
      const effective = await effectiveRenterPartyId(deps.pool, req, session);
      partyId = effective.partyId;
      preview = effective.preview;

      const owned = await withSystemBypass(deps.pool, async (client) => {
        const { rows } = await client.query<{ org_id: string }>(
          `select org_id from application where id = $1 and party_id = $2`,
          [applicationId, partyId],
        );
        return rows[0] ?? null;
      });
      if (!owned) {
        throw new AppError('forbidden', 'auth_forbidden', 403);
      }
      orgId = owned.org_id;
    } catch (sessionErr) {
      if (sessionErr instanceof AppError && sessionErr.code === 'auth_forbidden') {
        throw sessionErr;
      }
      // Application-access token path (no session) — never applies preview overlay.
      const auth = await withSystemBypass(deps.pool, (client) =>
        requireApplicationAccess(client, req, applicationId),
      );
      partyId = auth.partyId;
      orgId = auth.orgId;
      preview = false;
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
          paymentIntentId: preview ? null : (body.payment_intent_id ?? null),
          preview,
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
        preferred_lease_term_months: z.number().int().positive().max(60).optional().nullable(),
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

/** Whether a new screening fee is required vs reuse of an eligible prior report. */
export async function handleScreeningEligibility(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const result = await withTenantContext(
      deps.pool,
      { partyId },
      async (client) => {
        const { rows } = await client.query<{ id: string; party_id: string }>(
          `select id, party_id from application where id = $1`,
          [applicationId],
        );
        const app = rows[0];
        if (!app || app.party_id !== partyId) {
          throw new AppError('application not found', 'application_not_found', 404);
        }
        const profile = await getRenterProfile(client, partyId);
        const fee = await screeningFeeForState(client, profile?.preferred_state ?? null);
        const reuse = await findReusableScreening(client, {
          partyId,
          applicationId,
          feeCentsIfNew: fee.amount_cents,
        });
        return {
          application_id: applicationId,
          reusable: reuse.reusable,
          fee_cents: reuse.fee_cents_if_required,
          fee_cents_if_new: fee.amount_cents,
          reason: reuse.reason,
          expires_at: reuse.expires_at,
          message: reuse.reusable
            ? 'An eligible prior screening can be reused. You still must authorize this Home Provider. No additional fee.'
            : `A screening fee of ${(fee.amount_cents / 100).toFixed(2)} USD applies for your first eligible report.`,
        };
      },
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

/** Create a tracked deletion request — does not wipe retained records. */
export async function handleRequestAccountDeletion(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const body = z
      .object({
        confirm: z.literal(true),
        reason: z.string().max(2000).optional(),
      })
      .parse(await readJsonBody(req));
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const created = await withTenantContext(
      deps.pool,
      { partyId },
      async (client) => {
        const { rows: existing } = await client.query<{ id: string; status: string }>(
          `select id, status from account_deletion_request
           where party_id = $1 and status in ('pending', 'in_review')
           order by created_at desc limit 1`,
          [partyId],
        );
        if (existing[0]) {
          return { id: existing[0].id, status: existing[0].status, reused: true };
        }
        const { rows } = await client.query<{ id: string; status: string }>(
          `insert into account_deletion_request (party_id, status, reason)
           values ($1, 'pending', $2)
           returning id, status`,
          [partyId, body.reason ?? null],
        );
        return { id: rows[0]!.id, status: rows[0]!.status, reused: false };
      },
    );
    sendJson(res, 201, {
      request_id: created.id,
      status: created.status,
      message:
        'Deletion request received. Legally required financial, screening, and compliance records may be retained. This is not an instant wipe.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'confirmation required' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleGetAccountDeletionRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const row = await withTenantContext(
      deps.pool,
      { partyId },
      async (client) => {
        const { rows } = await client.query<{
          id: string;
          status: string;
          created_at: Date;
        }>(
          `select id, status, created_at from account_deletion_request
           where party_id = $1
           order by created_at desc limit 1`,
          [partyId],
        );
        return rows[0] ?? null;
      },
    );
    sendJson(res, 200, {
      request: row
        ? {
            id: row.id,
            status: row.status,
            created_at: row.created_at.toISOString(),
          }
        : null,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleListSavedListings(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const listings = await withTenantContext(
      deps.pool,
      { partyId },
      (client) => listSavedListings(client, partyId),
    );
    sendJson(res, 200, { saved: listings });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAddSavedListing(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const body = z.object({ listing_id: z.string().uuid() }).parse(await readJsonBody(req));
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const saved = await withTenantContext(
      deps.pool,
      { partyId },
      (client) => addSavedListing(client, { partyId, listingId: body.listing_id }),
    );
    sendJson(res, 201, saved);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleRemoveSavedListing(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const body = z.object({ listing_id: z.string().uuid() }).parse(await readJsonBody(req));
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const result = await withTenantContext(
      deps.pool,
      { partyId },
      (client) => removeSavedListing(client, { partyId, listingId: body.listing_id }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleListSupportCases(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const cases = await withTenantContext(
      deps.pool,
      { partyId },
      (client) => listSupportCases(client, partyId),
    );
    sendJson(res, 200, { cases });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleCreateSupportCase(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const body = z
      .object({
        category: z.enum(SUPPORT_CATEGORIES),
        subject: z.string().min(1).max(200),
        description: z.string().min(1).max(5000),
        related_listing_id: z.string().uuid().optional(),
        related_application_id: z.string().uuid().optional(),
      })
      .parse(await readJsonBody(req));
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const created = await withTenantContext(
      deps.pool,
      { partyId },
      (client) =>
        createSupportCase(client, {
          partyId,
          category: body.category,
          subject: body.subject,
          description: body.description,
          relatedListingId: body.related_listing_id,
          relatedApplicationId: body.related_application_id,
        }),
    );
    sendJson(res, 201, created);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleGetScreeningCenter(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const center = await withTenantContext(
      deps.pool,
      { partyId },
      (client) => getScreeningCenter(client, partyId),
    );
    sendJson(res, 200, center);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleMissingInfoResponse(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const body = z
      .object({
        response: z.string().min(1).max(2000),
        request_id: z.string().uuid().optional(),
        document_ids: z.array(z.string().uuid()).max(20).optional(),
        idempotency_key: z.string().min(8).max(128).optional(),
      })
      .parse(await readJsonBody(req));
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const result = await withTenantContext(
      deps.pool,
      { partyId },
      (client) =>
        respondToMissingInfo(client, {
          applicationId,
          partyId,
          response: body.response,
          requestId: body.request_id,
          documentIds: body.document_ids,
          idempotencyKey: body.idempotency_key,
        }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleMissingInfoUpload(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
  applicationId: string,
  requestId: string,
): Promise<void> {
  try {
    const body = z
      .object({
        content_type: z.string().min(3).max(120),
        original_filename: z.string().min(1).max(260).optional(),
        doc_type: z.string().max(64).optional(),
        /** Base64 file body — private store; never a public URL */
        content_base64: z.string().min(1).max(14_000_000),
      })
      .parse(await readJsonBody(req));
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const buf = Buffer.from(body.content_base64, 'base64');
    const result = await withTenantContext(
      deps.pool,
      { partyId },
      (client) =>
        uploadMissingInfoDocument(client, {
          applicationId,
          partyId,
          requestId,
          body: buf,
          contentType: body.content_type,
          originalFilename: body.original_filename,
          docType: body.doc_type,
        }),
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

export async function handleMissingInfoDocUrl(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
  applicationId: string,
  documentId: string,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const result = await withTenantContext(
      deps.pool,
      { partyId },
      (client) =>
        signMissingInfoDocumentUrl(client, {
          documentId,
          actorPartyId: partyId,
          asReviewer: false,
        }),
    );
    void applicationId;
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleListRenterCashback(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const rows = await withTenantContext(
      deps.pool,
      { partyId },
      (client) => listCashbackForParty(client, partyId),
    );
    sendJson(res, 200, {
      offer_version_note:
        '[PLACEHOLDER] display_v1 cashback is a display offer only — not a funded commitment.',
      eligibility: rows,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleListNotifications(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const { listInboxNotifications } = await import('../modules/notifications/index.js');
    const notifications = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId },
      (client) => listInboxNotifications(client, { partyId: identity.partyId }),
    );
    sendJson(res, 200, { notifications });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleMarkNotificationRead(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
  notificationId: string,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const { markNotificationRead } = await import('../modules/notifications/index.js');
    const result = await withTenantContext(
      deps.pool,
      { partyId: identity.partyId },
      (client) =>
        markNotificationRead(client, {
          partyId: identity.partyId,
          notificationId,
        }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleReportListingIssue(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
  listingId: string,
): Promise<void> {
  try {
    const body = z
      .object({
        category: z.enum([
          'stale_availability',
          'incorrect_price',
          'incorrect_photos',
          'incorrect_address',
          'scam_suspected',
          'other_non_sensitive',
        ]),
        note: z.string().max(500).optional(),
      })
      .parse(await readJsonBody(req));
    let reporterPartyId: string | null = null;
    try {
      const identity = await requireSession(deps.pool, req);
      reporterPartyId = identity.partyId;
    } catch {
      // anonymous report allowed
    }
    const { reportListingIssue } = await import('../modules/listings/report-issue.js');
    const result = await withSystemBypass(deps.pool, (client) =>
      reportListingIssue(client, {
        listingId,
        reporterPartyId,
        category: body.category,
        note: body.note,
      }),
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

export async function handleListRenterLeases(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const leases = await withTenantContext(
      deps.pool,
      { partyId },
      (client) => listRenterLeaseDocuments(client, partyId, applicationId),
    );
    sendJson(res, 200, { application_id: applicationId, leases });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleAcknowledgeRenterLease(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
  applicationId: string,
  docId: string,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const doc = await withTenantContext(deps.pool, { partyId }, async (client) => {
      const leases = await listRenterLeaseDocuments(client, partyId, applicationId);
      if (!leases.some((l) => l.id === docId)) {
        throw new AppError('lease document not found', 'lease_document_not_found', 404);
      }
      return acknowledgeLeaseDocument(client, { docId, partyId });
    });
    sendJson(res, 200, doc);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleRenterLeaseDownloadUrl(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RenterHandlerDeps,
  applicationId: string,
  docId: string,
): Promise<void> {
  try {
    const identity = await requireSession(deps.pool, req);
    const { partyId } = await effectiveRenterPartyId(deps.pool, req, identity);
    const result = await withTenantContext(deps.pool, { partyId }, async (client) => {
      const leases = await listRenterLeaseDocuments(client, partyId, applicationId);
      if (!leases.some((l) => l.id === docId)) {
        throw new AppError('lease document not found', 'lease_document_not_found', 404);
      }
      return signGetUrlForRenter(client, {
        docId,
        partyId,
        ip: getClientIp(req),
        userAgent: getUserAgent(req),
      });
    });
    sendJson(res, 200, {
      url: result.url,
      expires_at: result.expires_at,
      document: result.document,
    });
  } catch (err) {
    sendError(res, err);
  }
}
