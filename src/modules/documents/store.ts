import { createHash, randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import {
  getObjectStore,
  type ObjectStore,
  type SignedUrl,
} from '../../infra/object-store/index.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';
import {
  getVendorRegistry,
  type ESign,
  type VendorCallContext,
} from '../vendors/index.js';

/** §12.1 — signed URL TTL hard cap. */
export const SIGNED_URL_MAX_TTL_SECONDS = 300;

export type StoreDocumentInput = {
  orgId?: string | null;
  ownerPartyId?: string | null;
  docType: string;
  retentionClass: string;
  body: Buffer;
  contentType: string;
  purgeAfter?: Date | null;
  supersedesId?: string | null;
  actorPartyId?: string | null;
  actorKind?: 'user' | 'system' | 'vendor' | 'admin';
  requestId?: string | null;
  /** Skip scan pipeline (tests). */
  scanStatus?: string;
  clock?: Clock;
  store?: ObjectStore;
};

export type DocumentRow = {
  id: string;
  org_id: string | null;
  owner_party_id: string | null;
  doc_type: string;
  retention_class: string;
  storage_key: string;
  content_hash: string;
  content_type: string;
  size_bytes: string;
  version: number;
  scan_status: string;
  purge_after: Date | null;
};

function contentHash(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Minimal upload pipeline: type sniff → EXIF strip stub → store.
 * Production adds AV scan; CI marks clean after store.
 */
function sniffAndStrip(body: Buffer, contentType: string): {
  body: Buffer;
  contentType: string;
} {
  // EXIF strip stub — no-op for non-image; images get a marker prefix removed if present.
  if (contentType.startsWith('image/') && body.slice(0, 4).toString('utf8') === 'EXIF') {
    return { body: body.subarray(4), contentType };
  }
  return { body, contentType };
}

export async function storeDocument(
  client: DbClient,
  input: StoreDocumentInput,
): Promise<{ documentId: string; storageKey: string; contentHash: string }> {
  const clock = input.clock ?? systemClock;
  const store = input.store ?? getObjectStore();
  const cleaned = sniffAndStrip(input.body, input.contentType);
  const hash = contentHash(cleaned.body);
  const id = randomUUID();
  const storageKey = `docs/${input.orgId ?? 'global'}/${id}/${hash.slice(0, 16)}`;

  await store.put({
    key: storageKey,
    body: cleaned.body,
    contentType: cleaned.contentType,
  });

  const scanStatus = input.scanStatus ?? 'clean';
  let version = 1;
  if (input.supersedesId) {
    const { rows } = await client.query<{ version: number }>(
      `select version from document where id = $1`,
      [input.supersedesId],
    );
    version = (rows[0]?.version ?? 0) + 1;
  }

  await client.query(
    `insert into document (
       id, org_id, owner_party_id, doc_type, retention_class,
       storage_key, content_hash, content_type, size_bytes, version,
       supersedes_id, scan_status, purge_after, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id,
      input.orgId ?? null,
      input.ownerPartyId ?? null,
      input.docType,
      input.retentionClass,
      storageKey,
      hash,
      cleaned.contentType,
      cleaned.body.length,
      version,
      input.supersedesId ?? null,
      scanStatus,
      input.purgeAfter ?? null,
      clock.now(),
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'document',
    aggregateId: id,
    eventType: 'document.stored',
    payload: {
      doc_type: input.docType,
      retention_class: input.retentionClass,
      content_hash: hash,
      size_bytes: cleaned.body.length,
      scan_status: scanStatus,
    },
    actorPartyId: input.actorPartyId ?? null,
    actorKind: input.actorKind ?? 'system',
    requestId: input.requestId ?? null,
    occurredAt: clock.now(),
  });

  return { documentId: id, storageKey, contentHash: hash };
}

export async function grantDocumentAccess(
  client: DbClient,
  input: {
    documentId: string;
    granteeOrgId?: string | null;
    granteePartyId?: string | null;
    permission: 'view' | 'download';
    expiresAt?: Date | null;
    actorPartyId?: string | null;
  },
): Promise<{ grantId: string }> {
  if (!input.granteeOrgId && !input.granteePartyId) {
    throw new AppError('grant requires grantee', 'document_grant_invalid', 400);
  }
  const id = randomUUID();
  await client.query(
    `insert into document_grant (
       id, document_id, grantee_org_id, grantee_party_id, permission, expires_at
     ) values ($1,$2,$3,$4,$5,$6)`,
    [
      id,
      input.documentId,
      input.granteeOrgId ?? null,
      input.granteePartyId ?? null,
      input.permission,
      input.expiresAt ?? null,
    ],
  );
  await emitDomainEvent(client, {
    aggregateType: 'document',
    aggregateId: input.documentId,
    eventType: 'document.grant_created',
    payload: {
      grant_id: id,
      permission: input.permission,
      grantee_org_id: input.granteeOrgId ?? null,
      grantee_party_id: input.granteePartyId ?? null,
    },
    actorPartyId: input.actorPartyId ?? null,
    actorKind: 'user',
  });
  return { grantId: id };
}

async function assertEntitled(
  client: DbClient,
  input: {
    documentId: string;
    actorPartyId?: string | null;
    actorOrgId?: string | null;
    permission: 'view' | 'download';
  },
): Promise<DocumentRow> {
  const { rows } = await client.query<DocumentRow>(
    `select id, org_id, owner_party_id, doc_type, retention_class, storage_key,
            content_hash, content_type, size_bytes::text, version, scan_status, purge_after
     from document where id = $1`,
    [input.documentId],
  );
  const doc = rows[0];
  if (!doc) throw new AppError('document not found', 'document_not_found', 404);
  if (doc.scan_status === 'purged') {
    throw new AppError('document purged', 'document_purged', 410);
  }

  const isOwner =
    (input.actorPartyId && doc.owner_party_id === input.actorPartyId) ||
    (input.actorOrgId && doc.org_id === input.actorOrgId);
  if (isOwner) return doc;

  const { rows: grants } = await client.query<{ id: string }>(
    `select id from document_grant
     where document_id = $1
       and revoked_at is null
       and (expires_at is null or expires_at > now())
       and (
         ($2::uuid is not null and grantee_party_id = $2)
         or ($3::uuid is not null and grantee_org_id = $3)
       )
       and (
         permission = $4
         or ($4 = 'view' and permission in ('view','download'))
         or ($4 = 'download' and permission = 'download')
       )
     limit 1`,
    [
      input.documentId,
      input.actorPartyId ?? null,
      input.actorOrgId ?? null,
      input.permission,
    ],
  );
  if (!grants[0]) {
    throw new AppError('not entitled', 'document_not_entitled', 403);
  }
  return doc;
}

export async function issueSignedUrl(
  client: DbClient,
  input: {
    documentId: string;
    actorPartyId?: string | null;
    actorOrgId?: string | null;
    permission?: 'view' | 'download';
    /** Requested TTL; capped at 300s. */
    expiresInSeconds?: number;
    requestId?: string | null;
    ip?: string | null;
    clock?: Clock;
    store?: ObjectStore;
  },
): Promise<SignedUrl & { documentId: string }> {
  const permission = input.permission ?? 'view';
  const doc = await assertEntitled(client, {
    documentId: input.documentId,
    actorPartyId: input.actorPartyId,
    actorOrgId: input.actorOrgId,
    permission,
  });

  const ttl = Math.min(
    input.expiresInSeconds ?? SIGNED_URL_MAX_TTL_SECONDS,
    SIGNED_URL_MAX_TTL_SECONDS,
  );
  const store = input.store ?? getObjectStore();
  const clock = input.clock ?? systemClock;
  const signed = await store.signGetUrl(doc.storage_key, {
    expiresInSeconds: ttl,
    issuedAt: clock.now(),
  });

  await client.query(
    `insert into document_access_log (
       document_id, actor_party_id, actor_org_id, action, request_id, ip, occurred_at
     ) values ($1,$2,$3,'url_issued',$4,$5::inet,$6)`,
    [
      doc.id,
      input.actorPartyId ?? null,
      input.actorOrgId ?? null,
      input.requestId ?? null,
      input.ip ?? null,
      clock.now(),
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'document',
    aggregateId: doc.id,
    eventType: 'document.url_issued',
    payload: {
      expires_at: signed.expiresAt.toISOString(),
      ttl_seconds: ttl,
      permission,
    },
    actorPartyId: input.actorPartyId ?? null,
    actorKind: 'user',
    requestId: input.requestId ?? null,
    occurredAt: clock.now(),
  });

  return { ...signed, documentId: doc.id };
}

/**
 * Purge job: remove objects past purge_after from object store; retain document tombstone.
 * Ledger / grant FKs by document id remain valid.
 */
export async function runDocumentPurgeJob(
  client: DbClient,
  opts?: { clock?: Clock; store?: ObjectStore; asOf?: Date },
): Promise<{ purged: number; documentIds: string[] }> {
  const clock = opts?.clock ?? systemClock;
  const store = opts?.store ?? getObjectStore();
  const asOf = opts?.asOf ?? clock.now();
  const asOfDate = asOf.toISOString().slice(0, 10);

  const { rows } = await client.query<{
    id: string;
    storage_key: string;
    scan_status: string;
  }>(
    `select id, storage_key, scan_status from document
     where purge_after is not null
       and purge_after <= $1::date
       and scan_status <> 'purged'
     for update`,
    [asOfDate],
  );

  const documentIds: string[] = [];
  for (const row of rows) {
    await store.delete(row.storage_key);
    await client.query(
      `update document
       set scan_status = 'purged',
           storage_key = $2,
           size_bytes = 0,
           content_hash = $3
       where id = $1`,
      [row.id, `tombstone/${row.id}`, 'purged'],
    );
    await emitDomainEvent(client, {
      aggregateType: 'document',
      aggregateId: row.id,
      eventType: 'document.purged',
      payload: { prior_storage_key: row.storage_key },
      actorKind: 'system',
      occurredAt: clock.now(),
    });
    documentIds.push(row.id);
  }

  return { purged: documentIds.length, documentIds };
}

/**
 * Wire ESign adapter → store completed document + audit certificate as documents.
 */
export async function completeESignAndStore(
  client: DbClient,
  input: {
    documentRef: string;
    signerPartyId: string;
    orgId?: string | null;
    requestId?: string | null;
    eSign?: ESign;
    store?: ObjectStore;
  },
): Promise<{
  envelopeId: string;
  completedDocumentId: string;
  auditCertificateDocumentId: string;
}> {
  const eSign = input.eSign ?? getVendorRegistry().eSign();
  const ctx: VendorCallContext = {
    correlationId: input.requestId ?? randomUUID(),
    partyId: input.signerPartyId,
    requestId: input.requestId ?? undefined,
  };
  const result = await eSign.send(
    {
      documentRef: input.documentRef,
      signerPartyId: input.signerPartyId,
      completeImmediately: true,
    },
    ctx,
  );
  if (result.status !== 'completed' || !result.completedDocumentBytes || !result.auditCertificateBytes) {
    throw new AppError('esign not completed', 'esign_incomplete', 409);
  }

  const completed = await storeDocument(client, {
    orgId: input.orgId,
    ownerPartyId: input.signerPartyId,
    docType: 'esign_completed',
    retentionClass: 'identity',
    body: result.completedDocumentBytes,
    contentType: 'application/pdf',
    actorPartyId: input.signerPartyId,
    actorKind: 'vendor',
    requestId: input.requestId,
    store: input.store,
  });

  const cert = await storeDocument(client, {
    orgId: input.orgId,
    ownerPartyId: input.signerPartyId,
    docType: 'esign_audit_certificate',
    retentionClass: 'audit',
    body: result.auditCertificateBytes,
    contentType: 'application/pdf',
    actorPartyId: input.signerPartyId,
    actorKind: 'vendor',
    requestId: input.requestId,
    store: input.store,
  });

  await emitDomainEvent(client, {
    aggregateType: 'document',
    aggregateId: completed.documentId,
    eventType: 'document.esign_completed',
    payload: {
      envelope_id: result.envelopeId,
      vendor: result.vendor,
      audit_certificate_document_id: cert.documentId,
      source_document_ref: input.documentRef,
    },
    actorPartyId: input.signerPartyId,
    actorKind: 'vendor',
    requestId: input.requestId ?? null,
  });

  return {
    envelopeId: result.envelopeId,
    completedDocumentId: completed.documentId,
    auditCertificateDocumentId: cert.documentId,
  };
}
