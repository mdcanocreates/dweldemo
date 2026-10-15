import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { getObjectStore } from '../../infra/object-store/index.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';

export type LeaseDocumentRow = {
  id: string;
  application_id: string;
  listing_id: string;
  org_id: string;
  uploaded_by_party_id: string;
  storage_key: string;
  original_filename: string;
  content_type: string;
  status: string;
  workflow_status: string;
  acknowledged_at: string | null;
  made_available_at: string | null;
  created_at: string;
  executed_at: string | null;
};

function mapRow(row: {
  id: string;
  application_id: string;
  listing_id: string;
  org_id: string;
  uploaded_by_party_id: string;
  storage_key: string;
  original_filename: string;
  content_type: string;
  status: string;
  workflow_status: string | null;
  acknowledged_at: Date | null;
  made_available_at: Date | null;
  created_at: Date;
  executed_at: Date | null;
}): LeaseDocumentRow {
  return {
    id: row.id,
    application_id: row.application_id,
    listing_id: row.listing_id,
    org_id: row.org_id,
    uploaded_by_party_id: row.uploaded_by_party_id,
    storage_key: row.storage_key,
    original_filename: row.original_filename,
    content_type: row.content_type,
    status: row.status,
    workflow_status: row.workflow_status ?? 'uploaded',
    acknowledged_at: row.acknowledged_at?.toISOString() ?? null,
    made_available_at: row.made_available_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    executed_at: row.executed_at?.toISOString() ?? null,
  };
}

const SELECT_COLS = `id, application_id, listing_id, org_id, uploaded_by_party_id,
  storage_key, original_filename, content_type, status,
  coalesce(workflow_status, 'uploaded') as workflow_status,
  acknowledged_at, made_available_at, created_at, executed_at`;

export async function listLeaseDocuments(
  client: DbClient,
  input: { orgId: string; listingId?: string; applicationId?: string },
): Promise<LeaseDocumentRow[]> {
  const { rows } = await client.query<{
    id: string;
    application_id: string;
    listing_id: string;
    org_id: string;
    uploaded_by_party_id: string;
    storage_key: string;
    original_filename: string;
    content_type: string;
    status: string;
    workflow_status: string | null;
    acknowledged_at: Date | null;
    made_available_at: Date | null;
    created_at: Date;
    executed_at: Date | null;
  }>(
    `select ${SELECT_COLS}
     from lease_document
     where org_id = $1
       and ($2::uuid is null or listing_id = $2)
       and ($3::uuid is null or application_id = $3)
     order by created_at desc`,
    [input.orgId, input.listingId ?? null, input.applicationId ?? null],
  );
  return rows.map(mapRow);
}

export async function uploadLeaseDocumentMetadata(
  client: DbClient,
  input: {
    orgId: string;
    listingId: string;
    applicationId: string;
    actorPartyId: string;
    body?: Buffer | null;
    contentType: string;
    originalFilename: string;
    storageKey?: string | null;
  },
): Promise<LeaseDocumentRow> {
  const { rows: app } = await client.query<{ id: string }>(
    `select id from application
     where id = $1 and listing_id = $2 and org_id = $3`,
    [input.applicationId, input.listingId, input.orgId],
  );
  if (!app[0]) throw new AppError('application not found', 'application_not_found', 404);

  let storageKey = input.storageKey ?? null;
  if (input.body?.length) {
    storageKey = `leases/${input.orgId}/${input.listingId}/${input.applicationId}/${randomUUID()}`;
    const store = getObjectStore();
    await store.put({
      key: storageKey,
      body: input.body,
      contentType: input.contentType,
    });
  }
  if (!storageKey) {
    throw new AppError('storage_key or file required', 'validation_error', 400);
  }

  const { rows } = await client.query<{
    id: string;
    application_id: string;
    listing_id: string;
    org_id: string;
    uploaded_by_party_id: string;
    storage_key: string;
    original_filename: string;
    content_type: string;
    status: string;
    workflow_status: string | null;
    acknowledged_at: Date | null;
    made_available_at: Date | null;
    created_at: Date;
    executed_at: Date | null;
  }>(
    `insert into lease_document (
       application_id, listing_id, org_id, uploaded_by_party_id,
       storage_key, original_filename, content_type, status, workflow_status
     ) values ($1,$2,$3,$4,$5,$6,$7,'uploaded','uploaded')
     returning ${SELECT_COLS}`,
    [
      input.applicationId,
      input.listingId,
      input.orgId,
      input.actorPartyId,
      storageKey,
      input.originalFilename.slice(0, 260),
      input.contentType.slice(0, 120),
    ],
  );
  const doc = mapRow(rows[0]!);

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: input.applicationId,
    eventType: 'lease_document.uploaded',
    payload: {
      lease_document_id: doc.id,
      listing_id: input.listingId,
      workflow_status: 'uploaded',
      // [PLACEHOLDER] Lease document is metadata-only until counsel-approved workflow
      legal_copy: '[PLACEHOLDER] Lease upload metadata — not an executed instrument.',
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  return doc;
}

/** HP makes an uploaded lease visible to the renter (not e-sign). */
export async function makeLeaseAvailableToRenter(
  client: DbClient,
  input: { docId: string; orgId: string; actorPartyId: string },
): Promise<LeaseDocumentRow> {
  const { rows } = await client.query<{
    id: string;
    application_id: string;
    listing_id: string;
    org_id: string;
    uploaded_by_party_id: string;
    storage_key: string;
    original_filename: string;
    content_type: string;
    status: string;
    workflow_status: string | null;
    acknowledged_at: Date | null;
    made_available_at: Date | null;
    created_at: Date;
    executed_at: Date | null;
  }>(
    `update lease_document
     set workflow_status = 'available_to_renter',
         status = case when status = 'uploaded' then 'shared' else status end,
         made_available_at = coalesce(made_available_at, now())
     where id = $1 and org_id = $2 and workflow_status in ('uploaded', 'available_to_renter')
     returning ${SELECT_COLS}`,
    [input.docId, input.orgId],
  );
  if (!rows[0]) {
    throw new AppError('lease document not found', 'lease_document_not_found', 404);
  }
  const doc = mapRow(rows[0]);

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: doc.application_id,
    eventType: 'lease_document.available_to_renter',
    payload: {
      lease_document_id: doc.id,
      workflow_status: doc.workflow_status,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  return doc;
}

export async function listRenterLeaseDocuments(
  client: DbClient,
  partyId: string,
  applicationId?: string,
): Promise<LeaseDocumentRow[]> {
  const { rows } = await client.query<{
    id: string;
    application_id: string;
    listing_id: string;
    org_id: string;
    uploaded_by_party_id: string;
    storage_key: string;
    original_filename: string;
    content_type: string;
    status: string;
    workflow_status: string | null;
    acknowledged_at: Date | null;
    made_available_at: Date | null;
    created_at: Date;
    executed_at: Date | null;
  }>(
    `select ${SELECT_COLS}
     from lease_document ld
     join application a on a.id = ld.application_id
     where a.party_id = $1
       and a.status = 'approved'
       and ld.workflow_status in (
         'available_to_renter', 'acknowledged', 'executed_copy_uploaded', 'complete'
       )
       and ($2::uuid is null or ld.application_id = $2)
     order by ld.created_at desc`,
    [partyId, applicationId ?? null],
  );
  return rows.map(mapRow);
}

export async function acknowledgeLeaseDocument(
  client: DbClient,
  input: { docId: string; partyId: string },
): Promise<LeaseDocumentRow> {
  const { rows: owned } = await client.query<{ id: string }>(
    `select ld.id
     from lease_document ld
     join application a on a.id = ld.application_id
     where ld.id = $1
       and a.party_id = $2
       and a.status = 'approved'
       and ld.workflow_status in ('available_to_renter', 'acknowledged')`,
    [input.docId, input.partyId],
  );
  if (!owned[0]) {
    throw new AppError('lease document not found', 'lease_document_not_found', 404);
  }

  const { rows } = await client.query<{
    id: string;
    application_id: string;
    listing_id: string;
    org_id: string;
    uploaded_by_party_id: string;
    storage_key: string;
    original_filename: string;
    content_type: string;
    status: string;
    workflow_status: string | null;
    acknowledged_at: Date | null;
    made_available_at: Date | null;
    created_at: Date;
    executed_at: Date | null;
  }>(
    `update lease_document
     set workflow_status = 'acknowledged',
         acknowledged_at = coalesce(acknowledged_at, now()),
         acknowledged_by_party_id = $2
     where id = $1
     returning ${SELECT_COLS}`,
    [input.docId, input.partyId],
  );
  const doc = mapRow(rows[0]!);

  await client.query(
    `insert into lease_document_access_log (lease_document_id, party_id, action)
     values ($1, $2, 'acknowledge')`,
    [doc.id, input.partyId],
  );

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: doc.application_id,
    eventType: 'lease_document.acknowledged',
    payload: { lease_document_id: doc.id },
    actorPartyId: input.partyId,
    actorKind: 'user',
  });

  return doc;
}

export async function signGetUrlForRenter(
  client: DbClient,
  input: {
    docId: string;
    partyId: string;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<{ url: string; expires_at: string; document: LeaseDocumentRow }> {
  const docs = await listRenterLeaseDocuments(client, input.partyId);
  const doc = docs.find((d) => d.id === input.docId);
  if (!doc) {
    throw new AppError('lease document not found', 'lease_document_not_found', 404);
  }

  const store = getObjectStore();
  const signed = await store.signGetUrl(doc.storage_key, { expiresInSeconds: 300 });

  await client.query(
    `insert into lease_document_access_log (lease_document_id, party_id, action, ip, user_agent)
     values ($1, $2, 'download', $3::inet, $4)`,
    [doc.id, input.partyId, input.ip ?? null, input.userAgent?.slice(0, 500) ?? null],
  );

  return {
    url: signed.url,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    document: doc,
  };
}
