import type { DbClient } from '../../db/pool.js';
import { parseOfferType } from './normalize.js';
import {
  collapseAuthoritativeByExternalId,
  reconcilePackageRecords,
} from './reconcile.js';
import type { NormalizedPackageRecord, ReconciliationReport } from './types.js';

export type QuarantineImportInput = {
  batchId: string;
  packageRoot: string;
  records: readonly NormalizedPackageRecord[];
  /** Default true. Write path still never publishes listings. */
  dryRun?: boolean;
};

export type QuarantineImportResult = {
  mode: 'dry_run' | 'quarantine_write';
  report: ReconciliationReport;
  snapshotsWritten: number;
  candidatesWritten: number;
  contactsWritten: number;
  offersWritten: number;
  publishedListingsTouched: 0;
};

async function ensureSource(
  client: DbClient,
  providerKey: string,
  displayName: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `select id from external_source where provider_key = $1`,
    [providerKey],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query<{ id: string }>(
    `insert into external_source (
       provider_key, display_name, license_evidence_ref, permitted_fields, status
     ) values ($1, $2, $3, $4, 'unverified')
     returning id`,
    [
      providerKey,
      displayName,
      'pending_rights_review',
      ['address', 'rent_range', 'beds', 'special_text', 'coordinates_approximate'],
    ],
  );
  return inserted.rows[0]!.id;
}

export async function importExternalListingPackages(
  client: DbClient,
  input: QuarantineImportInput,
): Promise<QuarantineImportResult> {
  const dryRun = input.dryRun !== false;
  const mode = dryRun ? 'dry_run' : 'quarantine_write';
  const report = reconcilePackageRecords(input.records, [input.packageRoot]);
  const authoritative = collapseAuthoritativeByExternalId(input.records);

  if (dryRun) {
    await client.query(
      `insert into external_import_run (
         batch_id, mode, package_root, status, records_seen, distinct_external_ids,
         snapshots_written, candidates_written, contacts_written, offers_written,
         address_collision_groups, rights_blocked, report_json, finished_at
       ) values ($1,$2,$3,'succeeded',$4,$5,0,0,0,0,$6,$7,$8::jsonb, now())
       on conflict (batch_id) do update set
         status = excluded.status,
         report_json = excluded.report_json,
         finished_at = now()`,
      [
        input.batchId,
        mode,
        input.packageRoot,
        report.recordsSeen,
        report.distinctExternalIds,
        report.addressCollisionGroups,
        report.recordsSeen,
        JSON.stringify(report),
      ],
    );
    return {
      mode,
      report,
      snapshotsWritten: 0,
      candidatesWritten: 0,
      contactsWritten: 0,
      offersWritten: 0,
      publishedListingsTouched: 0,
    };
  }

  const sourceIds = new Map<string, string>();
  let snapshotsWritten = 0;
  let candidatesWritten = 0;
  let contactsWritten = 0;
  let offersWritten = 0;

  for (const record of authoritative) {
    let sourceId = sourceIds.get(record.providerKey);
    if (!sourceId) {
      sourceId = await ensureSource(client, record.providerKey, record.providerKey);
      sourceIds.set(record.providerKey, sourceId);
    }

    const snapshot = await client.query<{ id: string }>(
      `insert into external_source_snapshot (
         external_source_id, batch_id, external_id, as_of, payload_checksum,
         raw_payload, package_name
       ) values ($1,$2,$3,$4,$5,$6::jsonb,$7)
       on conflict (external_source_id, external_id, payload_checksum)
       do update set batch_id = excluded.batch_id
       returning id`,
      [
        sourceId,
        input.batchId,
        record.externalId,
        record.asOf,
        record.payloadChecksum,
        JSON.stringify(record.raw),
        record.packageName,
      ],
    );
    snapshotsWritten += 1;

    const reviewState =
      record.unsafeStringHits.length > 0
        ? 'needs_manual_review'
        : 'pending_review';

    const candidate = await client.query<{ id: string }>(
      `insert into external_property_candidate (
         external_source_id, external_id, latest_snapshot_id, property_name,
         line1, city, state, postal_code, address_key, latitude, longitude,
         location_precision, listing_kind, review_state, rights_validated,
         source_updated_at
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false,$15
       )
       on conflict (external_source_id, external_id) do update set
         latest_snapshot_id = excluded.latest_snapshot_id,
         property_name = excluded.property_name,
         line1 = excluded.line1,
         city = excluded.city,
         state = excluded.state,
         postal_code = excluded.postal_code,
         address_key = excluded.address_key,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         location_precision = excluded.location_precision,
         listing_kind = excluded.listing_kind,
         review_state = excluded.review_state,
         source_updated_at = excluded.source_updated_at,
         updated_at = now()
       returning id`,
      [
        sourceId,
        record.externalId,
        snapshot.rows[0]!.id,
        record.propertyName,
        record.line1,
        record.city,
        record.state,
        record.postalCode,
        record.addressKey,
        record.latitude,
        record.longitude,
        record.locationPrecision,
        record.listingKind,
        reviewState,
        record.sourceUpdatedAt,
      ],
    );
    candidatesWritten += 1;
    const candidateId = candidate.rows[0]!.id;

    if (record.contact) {
      await client.query(
        `insert into property_contact_candidate (
           candidate_id, relationship_kind, contact_name, contact_title,
           contact_email, contact_phone, source_provenance, verification_state
         ) values ($1,$2,$3,$4,$5,$6,$7,'unverified')`,
        [
          candidateId,
          record.contact.relationshipKind,
          record.contact.name,
          record.contact.title,
          record.contact.email,
          record.contact.phone,
          record.contact.provenance,
        ],
      );
      contactsWritten += 1;
    }

    if (record.specialText) {
      await client.query(
        `insert into listing_offer_candidate (
           candidate_id, display_text, offer_type, qualifier_text, offer_status, source_reference
         ) values ($1,$2,$3,$4,'unverified',$5)`,
        [
          candidateId,
          record.specialText,
          parseOfferType(record.specialText, record.specialTags),
          'Offer advertised by property; terms apply. Not a Dwel-funded entitlement.',
          record.sourceUrl,
        ],
      );
      offersWritten += 1;
    }
  }

  await client.query(
    `insert into external_import_run (
       batch_id, mode, package_root, status, records_seen, distinct_external_ids,
       snapshots_written, candidates_written, contacts_written, offers_written,
       address_collision_groups, rights_blocked, report_json, finished_at
     ) values ($1,$2,$3,'succeeded',$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb, now())
     on conflict (batch_id) do update set
       snapshots_written = excluded.snapshots_written,
       candidates_written = excluded.candidates_written,
       contacts_written = excluded.contacts_written,
       offers_written = excluded.offers_written,
       report_json = excluded.report_json,
       finished_at = now()`,
    [
      input.batchId,
      mode,
      input.packageRoot,
      report.recordsSeen,
      report.distinctExternalIds,
      snapshotsWritten,
      candidatesWritten,
      contactsWritten,
      offersWritten,
      report.addressCollisionGroups,
      report.recordsSeen,
      JSON.stringify(report),
    ],
  );

  return {
    mode,
    report,
    snapshotsWritten,
    candidatesWritten,
    contactsWritten,
    offersWritten,
    publishedListingsTouched: 0,
  };
}
