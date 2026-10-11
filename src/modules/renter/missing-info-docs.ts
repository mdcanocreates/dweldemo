/**
 * Sprint 2: missing-info document uploads, response submit, HP/Admin review.
 * Reuses document + ObjectStore primitives. Never returns public S3 URLs.
 */

import type { DbClient } from '../../db/pool.js';
import {
  grantDocumentAccess,
  issueSignedUrl,
  storeDocument,
} from '../documents/index.js';
import { emitDomainEvent } from '../audit/index.js';
import { createNotification } from '../notifications/index.js';
import { AppError } from '../shared/errors.js';

export const REQUIRED_DOCUMENT_TYPES = [
  'proof_of_income',
  'employment_letter',
  'id_document',
  'pet_documentation',
  'household_roster',
  'other_supporting',
] as const;

export type RequiredDocumentType = (typeof REQUIRED_DOCUMENT_TYPES)[number];

const DOC_TYPE_SET = new Set<string>(REQUIRED_DOCUMENT_TYPES);

/** Max upload size 10 MiB */
export const MISSING_INFO_MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function validateRequiredDocumentTypes(types: string[] | undefined): string[] {
  if (!types?.length) return [];
  const invalid = types.filter((t) => !DOC_TYPE_SET.has(t));
  if (invalid.length) {
    throw new AppError(
      `invalid required_document_types: ${invalid.join(', ')}`,
      'validation_error',
      400,
    );
  }
  return [...new Set(types)];
}

function assertContentType(ct: string): string {
  const normalized = ct.split(';')[0]!.trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(normalized)) {
    throw new AppError(
      `unsupported content type: ${normalized}`,
      'validation_error',
      400,
    );
  }
  return normalized;
}

async function loadOpenOrReturnedRequest(
  client: DbClient,
  applicationId: string,
  requestId: string | null,
): Promise<{
  id: string;
  status: string;
  org_id: string;
  listing_id: string;
  required_document_types: string[];
  response_version: number;
}> {
  const { rows } = await client.query<{
    id: string;
    status: string;
    org_id: string;
    listing_id: string;
    required_document_types: string[] | null;
    response_version: number | null;
  }>(
    `select id, status, org_id, listing_id,
            coalesce(required_document_types, '{}') as required_document_types,
            coalesce(response_version, 0) as response_version
     from missing_info_request
     where application_id = $1
       and status in ('open', 'returned')
       and ($2::uuid is null or id = $2)
     order by created_at desc
     limit 1
     for update`,
    [applicationId, requestId],
  );
  const req = rows[0];
  if (!req) {
    throw new AppError('no open missing info request', 'missing_info_not_found', 404);
  }
  return {
    ...req,
    required_document_types: req.required_document_types ?? [],
    response_version: req.response_version ?? 0,
  };
}

export async function uploadMissingInfoDocument(
  client: DbClient,
  input: {
    applicationId: string;
    partyId: string;
    requestId: string;
    body: Buffer;
    contentType: string;
    originalFilename?: string | null;
    docType?: string | null;
  },
): Promise<{
  document_id: string;
  scan_status: string;
  content_type: string;
  size_bytes: number;
}> {
  if (!input.body.length) {
    throw new AppError('empty upload', 'validation_error', 400);
  }
  if (input.body.length > MISSING_INFO_MAX_BYTES) {
    throw new AppError('file too large (max 10MB)', 'validation_error', 400);
  }
  const contentType = assertContentType(input.contentType);

  const { rows: app } = await client.query<{
    id: string;
    party_id: string;
    org_id: string;
  }>(`select id, party_id, org_id from application where id = $1`, [
    input.applicationId,
  ]);
  if (!app[0] || app[0].party_id !== input.partyId) {
    throw new AppError('application not found', 'application_not_found', 404);
  }

  const req = await loadOpenOrReturnedRequest(
    client,
    input.applicationId,
    input.requestId,
  );

  const docType =
    input.docType && DOC_TYPE_SET.has(input.docType)
      ? input.docType
      : 'other_supporting';

  // Quarantine until scan marks clean — reviewers cannot fetch pending/quarantined.
  const stored = await storeDocument(client, {
    orgId: app[0].org_id,
    ownerPartyId: input.partyId,
    docType,
    retentionClass: 'application_support',
    body: input.body,
    contentType,
    actorPartyId: input.partyId,
    actorKind: 'user',
    scanStatus: 'pending',
  });

  await grantDocumentAccess(client, {
    documentId: stored.documentId,
    granteeOrgId: req.org_id,
    permission: 'download',
    actorPartyId: input.partyId,
  });

  await client.query(
    `insert into missing_info_request_document (
       missing_info_request_id, document_id, uploaded_by_party_id
     ) values ($1,$2,$3)
     on conflict (missing_info_request_id, document_id) do nothing`,
    [req.id, stored.documentId, input.partyId],
  );

  // Local/dev scan adapter: mark clean immediately after store (AV hook point).
  await client.query(
    `update document set scan_status = 'clean'
     where id = $1 and scan_status = 'pending'`,
    [stored.documentId],
  );

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: input.applicationId,
    eventType: 'missing_info_document_uploaded',
    payload: {
      missing_info_request_id: req.id,
      document_id: stored.documentId,
      doc_type: docType,
      content_type: contentType,
      size_bytes: input.body.length,
      original_filename: input.originalFilename ?? null,
    },
    actorPartyId: input.partyId,
    actorKind: 'user',
  });

  return {
    document_id: stored.documentId,
    scan_status: 'clean',
    content_type: contentType,
    size_bytes: input.body.length,
  };
}

export async function respondToMissingInfo(
  client: DbClient,
  input: {
    applicationId: string;
    partyId: string;
    response: string;
    requestId?: string | null;
    documentIds?: string[];
    idempotencyKey?: string | null;
  },
): Promise<{ request_id: string; status: string; response_version: number }> {
  const text = input.response.trim();
  if (!text) throw new AppError('response required', 'validation_error', 400);
  if (text.length > 2000) {
    throw new AppError('response too long', 'validation_error', 400);
  }

  const { rows: app } = await client.query<{
    id: string;
    org_id: string;
    listing_id: string;
    party_id: string;
    status: string;
  }>(
    `select id, org_id, listing_id, party_id, status
     from application where id = $1 for update`,
    [input.applicationId],
  );
  if (!app[0] || app[0].party_id !== input.partyId) {
    throw new AppError('application not found', 'application_not_found', 404);
  }

  const req = await loadOpenOrReturnedRequest(
    client,
    input.applicationId,
    input.requestId ?? null,
  );

  const docIds = [...new Set(input.documentIds ?? [])];
  if (req.required_document_types.length > 0 && docIds.length === 0) {
    throw new AppError(
      'supporting documents required for this request',
      'documents_required',
      400,
    );
  }

  if (docIds.length) {
    const { rows: linked } = await client.query<{ document_id: string; scan_status: string }>(
      `select mird.document_id, d.scan_status
       from missing_info_request_document mird
       join document d on d.id = mird.document_id
       where mird.missing_info_request_id = $1
         and mird.document_id = any($2::uuid[])
         and mird.uploaded_by_party_id = $3`,
      [req.id, docIds, input.partyId],
    );
    if (linked.length !== docIds.length) {
      throw new AppError(
        'one or more documents are not attached to this request',
        'document_not_linked',
        400,
      );
    }
    const dirty = linked.filter((d) => d.scan_status !== 'clean');
    if (dirty.length) {
      throw new AppError(
        'documents still scanning or quarantined',
        'document_not_clean',
        409,
      );
    }
  }

  const nextVersion = req.response_version + 1;
  await client.query(
    `update missing_info_request
     set status = 'responded',
         renter_response = $2,
         responded_at = now(),
         response_version = $3,
         review_note = null,
         reviewed_at = null,
         reviewed_by_party_id = null
     where id = $1`,
    [req.id, text, nextVersion],
  );

  await client.query(
    `update application
     set status = case
           when status in ('info_requested', 'more_info_requested') then 'awaiting_landlord_interest'
           else status
         end
     where id = $1`,
    [input.applicationId],
  );

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: input.applicationId,
    eventType: 'applicant_info_responded',
    payload: {
      missing_info_request_id: req.id,
      listing_id: app[0].listing_id,
      org_id: app[0].org_id,
      document_ids: docIds,
      response_version: nextVersion,
      idempotency_key: input.idempotencyKey ?? null,
    },
    actorPartyId: input.partyId,
    actorKind: 'user',
  });

  await createNotification(client, {
    recipientPartyId: input.partyId,
    channel: 'in_platform',
    eventType: 'applicant_info_responded',
    templateKey: 'applicant_info_responded',
    payload: {
      application_id: input.applicationId,
      missing_info_request_id: req.id,
      legal_copy: 'Your response was submitted for Home Provider review.',
    },
  });

  return {
    request_id: req.id,
    status: 'responded',
    response_version: nextVersion,
  };
}

export async function reviewMissingInfoResponse(
  client: DbClient,
  input: {
    applicationId: string;
    listingId: string;
    orgId: string;
    actorPartyId: string;
    requestId: string;
    decision: 'accept' | 'return';
    note?: string | null;
    /** Optimistic concurrency — reject if response_version changed. */
    expectedResponseVersion?: number | null;
  },
): Promise<{ request_id: string; status: string }> {
  const { rows: app } = await client.query<{
    id: string;
    status: string;
    party_id: string;
  }>(
    `select id, status, party_id from application
     where id = $1 and listing_id = $2 and org_id = $3
     for update`,
    [input.applicationId, input.listingId, input.orgId],
  );
  if (!app[0]) {
    throw new AppError('application not found', 'application_not_found', 404);
  }

  const { rows: reqs } = await client.query<{
    id: string;
    status: string;
    response_version: number;
  }>(
    `select id, status, coalesce(response_version, 0) as response_version
     from missing_info_request
     where id = $1 and application_id = $2 and org_id = $3
     for update`,
    [input.requestId, input.applicationId, input.orgId],
  );
  const req = reqs[0];
  if (!req) {
    throw new AppError('missing info request not found', 'missing_info_not_found', 404);
  }
  if (req.status !== 'responded') {
    throw new AppError(
      `cannot review request in status '${req.status}'`,
      'invalid_transition',
      409,
    );
  }
  if (
    input.expectedResponseVersion != null &&
    input.expectedResponseVersion !== req.response_version
  ) {
    throw new AppError(
      'response was updated; refresh and retry',
      'conflict',
      409,
    );
  }

  const note =
    input.note != null && input.note.trim()
      ? input.note.trim().slice(0, 1000)
      : null;

  if (input.decision === 'accept') {
    await client.query(
      `update missing_info_request
       set status = 'accepted',
           review_note = $2,
           reviewed_at = now(),
           reviewed_by_party_id = $3
       where id = $1`,
      [req.id, note, input.actorPartyId],
    );
    await emitDomainEvent(client, {
      aggregateType: 'application',
      aggregateId: input.applicationId,
      eventType: 'missing_info_accepted',
      payload: {
        missing_info_request_id: req.id,
        review_note: note,
      },
      actorPartyId: input.actorPartyId,
      actorKind: 'user',
    });
    await createNotification(client, {
      recipientPartyId: app[0].party_id,
      channel: 'in_platform',
      eventType: 'missing_info_accepted',
      templateKey: 'missing_info_accepted',
      payload: {
        application_id: input.applicationId,
        missing_info_request_id: req.id,
      },
    });
    return { request_id: req.id, status: 'accepted' };
  }

  // return for correction
  await client.query(
    `update missing_info_request
     set status = 'returned',
         review_note = $2,
         reviewed_at = now(),
         reviewed_by_party_id = $3
     where id = $1`,
    [req.id, note, input.actorPartyId],
  );
  await client.query(
    `update application
     set status = 'info_requested',
         info_requested_at = coalesce(info_requested_at, now())
     where id = $1`,
    [input.applicationId],
  );
  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: input.applicationId,
    eventType: 'missing_info_returned',
    payload: {
      missing_info_request_id: req.id,
      review_note: note,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });
  await createNotification(client, {
    recipientPartyId: app[0].party_id,
    channel: 'in_platform',
    eventType: 'missing_info_returned',
    templateKey: 'missing_info_returned',
    payload: {
      application_id: input.applicationId,
      missing_info_request_id: req.id,
      review_note: note,
    },
  });
  return { request_id: req.id, status: 'returned' };
}

export async function listMissingInfoDocuments(
  client: DbClient,
  requestId: string,
): Promise<
  Array<{
    document_id: string;
    doc_type: string;
    content_type: string;
    size_bytes: number;
    scan_status: string;
    created_at: string;
    reviewer_accessible: boolean;
  }>
> {
  const { rows } = await client.query<{
    document_id: string;
    doc_type: string;
    content_type: string;
    size_bytes: string;
    scan_status: string;
    created_at: Date;
  }>(
    `select d.id as document_id, d.doc_type, d.content_type, d.size_bytes::text,
            d.scan_status, mird.created_at
     from missing_info_request_document mird
     join document d on d.id = mird.document_id
     where mird.missing_info_request_id = $1
     order by mird.created_at asc`,
    [requestId],
  );
  return rows.map((r) => ({
    document_id: r.document_id,
    doc_type: r.doc_type,
    content_type: r.content_type,
    size_bytes: Number(r.size_bytes),
    scan_status: r.scan_status,
    created_at: r.created_at.toISOString(),
    reviewer_accessible: r.scan_status === 'clean',
  }));
}

/**
 * Issue short-lived signed GET for a missing-info document.
 * Reviewers (org) only after scan_status=clean. Owners may view pending.
 */
export async function signMissingInfoDocumentUrl(
  client: DbClient,
  input: {
    documentId: string;
    actorPartyId?: string | null;
    actorOrgId?: string | null;
    asReviewer?: boolean;
  },
): Promise<{ url: string; expires_at: string; document_id: string }> {
  const { rows } = await client.query<{
    scan_status: string;
    owner_party_id: string | null;
  }>(`select scan_status, owner_party_id from document where id = $1`, [
    input.documentId,
  ]);
  const doc = rows[0];
  if (!doc) throw new AppError('document not found', 'document_not_found', 404);

  const isOwner =
    input.actorPartyId != null && doc.owner_party_id === input.actorPartyId;
  if ((input.asReviewer || !isOwner) && doc.scan_status !== 'clean') {
    throw new AppError(
      'document unavailable until scan completes',
      'document_quarantined',
      403,
    );
  }

  const signed = await issueSignedUrl(client, {
    documentId: input.documentId,
    actorPartyId: input.actorPartyId,
    actorOrgId: input.actorOrgId,
    permission: 'download',
  });
  return {
    url: signed.url,
    expires_at: signed.expiresAt.toISOString(),
    document_id: input.documentId,
  };
}
