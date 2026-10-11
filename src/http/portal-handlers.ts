import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { withTenantContext } from '../db/tenant.js';
import type { DbPool } from '../db/pool.js';
import { pickOrgForRole } from '../modules/auth/session.js';
import { ingestManualListing } from '../modules/ingestion/index.js';
import {
  listOrgListings,
  replaceListingMediaUrls,
  setListingStatus,
} from '../modules/listings/public.js';
import {
  decideOnApplicant,
  getApplicantDetail,
  getLandlordSettings,
  getSelfExecutionStatus,
  listListingApplicants,
  listOrgActivity,
  submitSelfExecution,
  updateLandlordListing,
  updateLandlordSettings,
  uploadListingPhoto,
} from '../modules/landlord/index.js';
import {
  getActiveCriteria,
  upsertCriteria,
  normalizeCriteriaRules,
} from '../modules/listings/criteria.js';
import {
  listLeaseDocuments,
  makeLeaseAvailableToRenter,
  uploadLeaseDocumentMetadata,
} from '../modules/lease/index.js';
import {
  acceptBrokerInvitation,
  listPendingInvitationsForProviderOrg,
} from '../modules/brokerage/index.js';
import { getObjectStore } from '../infra/object-store/index.js';
import { AppError } from '../modules/shared/errors.js';
import { resolveActivePreviewContext } from './preview-context.js';
import { requireSession } from './session-auth.js';
import { readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';

export type PortalHandlerDeps = {
  pool: DbPool;
};

const createListingSchema = z.object({
  address_raw: z.string().min(5).max(500),
  rent_amount_cents: z.number().int().positive(),
  deposit_cents: z.number().int().nonnegative().optional(),
  bedrooms: z.number().nonnegative().optional(),
  bathrooms: z.number().nonnegative().optional(),
  sqft: z.number().int().positive().optional(),
  description: z.string().max(5000).optional(),
  pets_allowed: z.boolean().optional(),
  amenities: z.array(z.string().max(80)).max(40).optional(),
  available_on: z.string().date().optional(),
  status: z.enum(['draft', 'active', 'paused']).optional(),
  media_urls: z.array(z.string().url().max(2000)).max(20).optional(),
});

const statusSchema = z.object({
  status: z.enum(['active', 'paused', 'draft', 'rented']),
});

const updateListingSchema = z.object({
  rent_amount_cents: z.number().int().positive().optional(),
  deposit_cents: z.number().int().nonnegative().nullable().optional(),
  bedrooms: z.number().nonnegative().optional(),
  bathrooms: z.number().nonnegative().optional(),
  sqft: z.number().int().positive().nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  pets_allowed: z.boolean().nullable().optional(),
  amenities: z.array(z.string().max(80)).max(40).optional(),
  available_on: z.string().date().nullable().optional(),
  status: z.enum(['draft', 'active', 'paused', 'rented']).optional(),
});

const settingsSchema = z.object({
  screening_mode: z.enum(['auto_screen', 'manual_review']),
});

const decisionSchema = z.object({
  decision: z.enum([
    'approve',
    'decline',
    'request_screening',
    'pass',
    'request_more_info',
    'move_forward',
  ]),
  note: z.string().max(2000).optional(),
  reason_codes: z.array(z.string().max(64)).max(20).optional(),
  missing_info_categories: z.array(z.string().max(64)).max(20).optional(),
  required_document_types: z.array(z.string().max(64)).max(20).optional(),
  expected_status: z.string().max(64).optional(),
  idempotency_key: z.string().min(8).max(128).optional(),
});

const missingInfoReviewSchema = z.object({
  decision: z.enum(['accept', 'return']),
  note: z.string().max(1000).optional(),
  expected_response_version: z.number().int().nonnegative().optional(),
});

const criteriaSchema = z.object({
  jurisdiction: z.string().min(2).max(2).nullable().optional(),
  rules: z
    .object({
      min_income_to_rent_ratio: z.number().positive().max(20).optional(),
      move_in_window_days: z.number().int().nonnegative().max(365).optional(),
      pets_allowed: z.boolean().optional(),
      max_occupants: z.number().int().positive().max(50).optional(),
      lease_term_months: z
        .union([z.number().int().positive(), z.array(z.number().int().positive()).max(12)])
        .optional(),
      require_complete_profile: z.boolean().optional(),
    })
    .default({}),
});

const leaseUploadSchema = z.object({
  content_type: z.string().min(3).max(120),
  original_filename: z.string().min(1).max(260),
  storage_key: z.string().max(500).optional(),
  file_base64: z.string().max(12_000_000).optional(),
});

const selfExecSchema = z.object({
  license_state: z.string().min(2).max(2),
  license_type: z.enum(['licensed_broker', 'licensed_pm', 'owner_occupant']),
  license_number: z.string().max(80).optional(),
  business_entity_name: z.string().max(200).optional(),
  storage_key: z.string().max(500).optional(),
  original_filename: z.string().max(260).optional(),
  content_type: z.string().max(120).optional(),
  /** DEV/base64 image or PDF content for S3 put when provided */
  file_base64: z.string().max(8_000_000).optional(),
});

const photoUploadSchema = z.object({
  content_type: z.string().min(3).max(120),
  filename: z.string().max(260).optional(),
  file_base64: z.string().min(8).max(8_000_000),
});

async function requireLandlordOrg(pool: DbPool, req: IncomingMessage) {
  const identity = await requireSession(pool, req);

  // Preview overlay: allowlisted inspector uses Fake Oaks without party_role mutation.
  const preview = await resolveActivePreviewContext(pool, req);
  if (preview?.role === 'landlord' && preview.previewOrgId) {
    return { identity, orgId: preview.previewOrgId, preview: true as const };
  }

  const landlord = pickOrgForRole(identity, ['landlord']);
  if (!landlord) {
    throw new AppError(
      'landlord role required for this organization',
      'auth_forbidden',
      403,
    );
  }
  return { identity, orgId: landlord.orgId, preview: false as const };
}

export async function handleLandlordListListings(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const listings = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) => listOrgListings(client, orgId),
    );
    sendJson(res, 200, { listings });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleLandlordCreateListing(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
): Promise<void> {
  try {
    const body = createListingSchema.parse(await readJsonBody(req));
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);

    const created = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      async (client) => {
        const externalId = `manual:${randomUUID()}`;
        await ingestManualListing(client, {
          orgId,
          externalId,
          addressRaw: body.address_raw,
          rentAmountCents: body.rent_amount_cents,
          depositCents: body.deposit_cents ?? null,
          bedrooms: body.bedrooms ?? null,
          bathrooms: body.bathrooms ?? null,
          sqft: body.sqft ?? null,
        });

        const { rows } = await client.query<{ id: string; status: string }>(
          `select l.id, l.status
           from listing l
           join source_listing sl on sl.id = l.primary_source_listing_id
           where l.org_id = $1 and sl.external_id = $2
           order by l.created_at desc
           limit 1`,
          [orgId, externalId],
        );
        const listing = rows[0];
        if (!listing) {
          throw new AppError('listing create failed', 'listing_create_failed', 500);
        }
        if (body.media_urls?.length) {
          await replaceListingMediaUrls(client, {
            listingId: listing.id,
            orgId,
            urls: body.media_urls,
          });
        }
        if (
          body.description != null ||
          body.pets_allowed != null ||
          body.amenities ||
          body.available_on ||
          body.status
        ) {
          await updateLandlordListing(client, {
            listingId: listing.id,
            orgId,
            description: body.description ?? undefined,
            petsAllowed: body.pets_allowed ?? undefined,
            amenities: body.amenities,
            availableOn: body.available_on ?? undefined,
            status: body.status,
          });
        }
        return listing;
      },
    );

    sendJson(res, 201, {
      listing_id: created.id,
      status: created.status,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleLandlordSetListingStatus(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  listingId: string,
): Promise<void> {
  try {
    const body = statusSchema.parse(await readJsonBody(req));
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const updated = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        setListingStatus(client, {
          listingId,
          orgId,
          status: body.status,
        }),
    );
    sendJson(res, 200, updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleLandlordGetSettings(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const settings = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) => getLandlordSettings(client, orgId),
    );
    sendJson(res, 200, settings);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleLandlordUpdateSettings(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
): Promise<void> {
  try {
    const body = settingsSchema.parse(await readJsonBody(req));
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const settings = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        updateLandlordSettings(client, {
          orgId,
          screeningMode: body.screening_mode,
          actorPartyId: identity.partyId,
        }),
    );
    sendJson(res, 200, settings);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleLandlordUpdateListing(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  listingId: string,
): Promise<void> {
  try {
    const body = updateListingSchema.parse(await readJsonBody(req));
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const updated = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        updateLandlordListing(client, {
          listingId,
          orgId,
          rentAmountCents: body.rent_amount_cents,
          depositCents: body.deposit_cents,
          bedrooms: body.bedrooms,
          bathrooms: body.bathrooms,
          sqft: body.sqft,
          description: body.description,
          petsAllowed: body.pets_allowed,
          amenities: body.amenities,
          availableOn: body.available_on,
          status: body.status,
        }),
    );
    sendJson(res, 200, updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleLandlordUploadListingPhoto(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  listingId: string,
): Promise<void> {
  try {
    const body = photoUploadSchema.parse(await readJsonBody(req));
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const buf = Buffer.from(body.file_base64, 'base64');
    if (!buf.length) {
      throw new AppError('empty upload', 'validation_error', 400);
    }
    const uploaded = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        uploadListingPhoto(client, {
          listingId,
          orgId,
          body: buf,
          contentType: body.content_type,
          filename: body.filename,
        }),
    );
    sendJson(res, 201, uploaded);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleLandlordListApplicants(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  listingId: string,
): Promise<void> {
  try {
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const [applicants, settings] = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      async (client) => {
        const apps = await listListingApplicants(client, { listingId, orgId });
        const s = await getLandlordSettings(client, orgId);
        return [apps, s] as const;
      },
    );
    sendJson(res, 200, {
      listing_id: listingId,
      screening_mode: settings.screening_mode,
      applicants,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleLandlordDecideApplicant(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  listingId: string,
  applicationId: string,
): Promise<void> {
  try {
    const body = decisionSchema.parse(await readJsonBody(req));
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const result = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        decideOnApplicant(client, {
          listingId,
          applicationId,
          orgId,
          actorPartyId: identity.partyId,
          decision: body.decision,
          note: body.note,
          reason_codes: body.reason_codes,
          missing_info_categories: body.missing_info_categories,
          required_document_types: body.required_document_types,
          expected_status: body.expected_status,
          idempotency_key: body.idempotency_key,
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

export async function handleLandlordReviewMissingInfo(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  listingId: string,
  applicationId: string,
  requestId: string,
): Promise<void> {
  try {
    const body = missingInfoReviewSchema.parse(await readJsonBody(req));
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const { reviewMissingInfoResponse } = await import('../modules/renter/index.js');
    const result = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        reviewMissingInfoResponse(client, {
          applicationId,
          listingId,
          orgId,
          actorPartyId: identity.partyId,
          requestId,
          decision: body.decision,
          note: body.note,
          expectedResponseVersion: body.expected_response_version,
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

export async function handleLandlordMissingInfoDocUrl(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  applicationId: string,
  documentId: string,
): Promise<void> {
  try {
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const { signMissingInfoDocumentUrl } = await import('../modules/renter/index.js');
    const result = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        signMissingInfoDocumentUrl(client, {
          documentId,
          actorPartyId: identity.partyId,
          actorOrgId: orgId,
          asReviewer: true,
        }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleLandlordGetCriteria(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  listingId: string,
): Promise<void> {
  try {
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const criteria = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `select id from listing where id = $1 and org_id = $2`,
          [listingId, orgId],
        );
        if (!rows[0]) throw new AppError('listing not found', 'listing_not_found', 404);
        return getActiveCriteria(client, listingId);
      },
    );
    sendJson(res, 200, { listing_id: listingId, criteria });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleLandlordPutCriteria(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  listingId: string,
): Promise<void> {
  try {
    const body = criteriaSchema.parse(await readJsonBody(req));
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const criteria = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        upsertCriteria(client, {
          listingId,
          orgId,
          actorPartyId: identity.partyId,
          jurisdiction: body.jurisdiction,
          rules: normalizeCriteriaRules(body.rules),
        }),
    );
    sendJson(res, 200, { listing_id: listingId, criteria });
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleLandlordGetApplicantDetail(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  applicationId: string,
): Promise<void> {
  try {
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const detail = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) => getApplicantDetail(client, { applicationId, orgId }),
    );
    sendJson(res, 200, detail);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleLandlordListActivity(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const url = new URL(req.url ?? '/', 'http://local');
    const limit = Number(url.searchParams.get('limit') ?? '50');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const category = url.searchParams.get('category');
    const result = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        listOrgActivity(client, {
          orgId,
          limit: Number.isFinite(limit) ? limit : 50,
          offset: Number.isFinite(offset) ? offset : 0,
          category,
        }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleLandlordUploadLease(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  listingId: string,
  applicationId: string,
): Promise<void> {
  try {
    const body = leaseUploadSchema.parse(await readJsonBody(req));
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const buf = body.file_base64 ? Buffer.from(body.file_base64, 'base64') : null;
    const doc = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        uploadLeaseDocumentMetadata(client, {
          orgId,
          listingId,
          applicationId,
          actorPartyId: identity.partyId,
          body: buf,
          contentType: body.content_type,
          originalFilename: body.original_filename,
          storageKey: body.storage_key,
        }),
    );
    sendJson(res, 201, doc);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return;
    }
    sendError(res, err);
  }
}

export async function handleLandlordListLeases(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  listingId: string,
  applicationId?: string,
): Promise<void> {
  try {
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const docs = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        listLeaseDocuments(client, {
          orgId,
          listingId,
          applicationId,
        }),
    );
    sendJson(res, 200, { listing_id: listingId, application_id: applicationId ?? null, leases: docs });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleLandlordGetSelfExecution(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const status = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) => getSelfExecutionStatus(client, orgId),
    );
    const isAdmin = identity.roles.some((r) =>
      ['rbit_admin', 'rbit_super_admin', 'rbit_super'].includes(r.role),
    );
    sendJson(res, 200, {
      ...status,
      compliance_tag: 'interim_v1',
      admin_banner: isAdmin
        ? 'Self-execution criteria are interim_v1 — pending Jacob\'s sign-off.'
        : null,
    });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleLandlordSubmitSelfExecution(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
): Promise<void> {
  try {
    const body = selfExecSchema.parse(await readJsonBody(req));
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);

    let storageKey = body.storage_key ?? null;
    let contentType = body.content_type ?? null;
    let originalFilename = body.original_filename ?? null;

    if (body.file_base64) {
      const buf = Buffer.from(body.file_base64, 'base64');
      if (!buf.length) {
        throw new AppError('empty upload', 'validation_error', 400);
      }
      contentType = body.content_type ?? 'application/octet-stream';
      storageKey = `self-execution/${orgId}/${randomUUID()}`;
      originalFilename = body.original_filename ?? 'evidence.bin';
      const store = getObjectStore();
      await store.put({ key: storageKey, body: buf, contentType });
    }

    const created = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        submitSelfExecution(client, {
          orgId,
          partyId: identity.partyId,
          licenseState: body.license_state,
          licenseType: body.license_type,
          licenseNumber: body.license_number,
          businessEntityName: body.business_entity_name,
          storageKey,
          originalFilename,
          contentType,
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

export async function handleLandlordConfirmListingFreshness(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  listingId: string,
): Promise<void> {
  try {
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const { confirmListingFreshness } = await import('../modules/listings/report-issue.js');
    const result = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        confirmListingFreshness(client, {
          listingId,
          orgId,
          actorPartyId: identity.partyId,
        }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleLandlordListBrokerInvitations(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
): Promise<void> {
  try {
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const invitations = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      async (client) => {
        const { rows: emails } = await client.query<{ email: string | null }>(
          `select email from renter_profile where party_id = $1`,
          [identity.partyId],
        );
        return listPendingInvitationsForProviderOrg(client, {
          providerOrgId: orgId,
          contactEmail: emails[0]?.email ?? null,
        });
      },
    );
    sendJson(res, 200, { invitations });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleLandlordAcceptBrokerInvitation(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  invitationId: string,
): Promise<void> {
  try {
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const result = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      (client) =>
        acceptBrokerInvitation(client, {
          invitationId,
          providerOrgId: orgId,
          actorPartyId: identity.partyId,
        }),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleLandlordMakeLeaseAvailable(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalHandlerDeps,
  listingId: string,
  applicationId: string,
  docId: string,
): Promise<void> {
  try {
    const { identity, orgId } = await requireLandlordOrg(deps.pool, req);
    const doc = await withTenantContext(
      deps.pool,
      { orgId, partyId: identity.partyId },
      async (client) => {
        const owned = await listLeaseDocuments(client, {
          orgId,
          listingId,
          applicationId,
        });
        if (!owned.some((d) => d.id === docId)) {
          throw new AppError('lease document not found', 'lease_document_not_found', 404);
        }
        return makeLeaseAvailableToRenter(client, {
          docId,
          orgId,
          actorPartyId: identity.partyId,
        });
      },
    );
    sendJson(res, 200, doc);
  } catch (err) {
    sendError(res, err);
  }
}
