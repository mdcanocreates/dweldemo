import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { resolveOrCreatePropertyUnit } from '../geo/index.js';
import { AppError } from '../shared/errors.js';
import {
  applyDeltaDelistSignal,
  stampAbsentFromReconcile,
} from './delist.js';
import { mergeCanonicalListing } from './merge.js';
import { applyMediaPolicy, recordMediaObservation } from './media.js';
import { evaluateQualityGates, markSyncQuarantined } from './quality.js';
import {
  DEFAULT_FIELD_MAP,
  payloadHash,
  transformRecord,
} from './transform.js';
import type {
  CanonicalListingFields,
  IngestionThresholds,
  PipelineCounts,
} from './types.js';
import { DEFAULT_INGESTION_THRESHOLDS } from './types.js';

export type { CanonicalListingFields, PipelineCounts } from './types.js';

async function ensureDefaultMapping(
  client: DbClient,
  adapterKind: string,
  version = '1.0.0',
  fieldMap: Record<string, string> = DEFAULT_FIELD_MAP,
  valueMaps: Record<string, unknown> = {},
): Promise<{
  id: string;
  version: string;
  fieldMap: Record<string, string>;
  valueMaps: Record<string, unknown>;
}> {
  const name = `default_${adapterKind}`;
  const { rows } = await client.query<{
    id: string;
    field_map: Record<string, string>;
    value_maps: Record<string, unknown>;
  }>(`select id, field_map, value_maps from mapping_profile where name = $1 and version = $2`, [
    name,
    version,
  ]);
  if (rows[0]) {
    return {
      id: rows[0].id,
      version,
      fieldMap: rows[0].field_map ?? fieldMap,
      valueMaps: rows[0].value_maps ?? valueMaps,
    };
  }
  const id = randomUUID();
  await client.query(
    `insert into mapping_profile (id, name, adapter_kind, version, field_map, value_maps)
     values ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [id, name, adapterKind, version, JSON.stringify(fieldMap), JSON.stringify(valueMaps)],
  );
  return { id, version, fieldMap, valueMaps };
}

export async function ensureMappingVersion(
  client: DbClient,
  input: {
    adapterKind: string;
    version: string;
    fieldMap: Record<string, string>;
    valueMaps?: Record<string, unknown>;
    name?: string;
  },
): Promise<{
  id: string;
  version: string;
  fieldMap: Record<string, string>;
  valueMaps: Record<string, unknown>;
}> {
  const name = input.name ?? `default_${input.adapterKind}`;
  const valueMaps = input.valueMaps ?? {};
  const { rows } = await client.query<{ id: string }>(
    `select id from mapping_profile where name = $1 and version = $2`,
    [name, input.version],
  );
  if (rows[0]) {
    await client.query(
      `update mapping_profile set field_map = $2::jsonb, value_maps = $3::jsonb where id = $1`,
      [rows[0].id, JSON.stringify(input.fieldMap), JSON.stringify(valueMaps)],
    );
    return { id: rows[0].id, version: input.version, fieldMap: input.fieldMap, valueMaps };
  }
  const id = randomUUID();
  await client.query(
    `insert into mapping_profile (id, name, adapter_kind, version, field_map, value_maps)
     values ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [
      id,
      name,
      input.adapterKind,
      input.version,
      JSON.stringify(input.fieldMap),
      JSON.stringify(valueMaps),
    ],
  );
  return { id, version: input.version, fieldMap: input.fieldMap, valueMaps };
}

async function processCanonicalRecord(
  client: DbClient,
  input: {
    sourceId: string;
    orgId: string;
    syncRunId: string;
    rawRecordId: number;
    fields: CanonicalListingFields;
    mappingVersion: string;
    origin: 'manual' | 'ingested' | 'hybrid';
    precedence: number;
    dryRun: boolean;
    mediaPolicy?: 'host' | 'hotlink' | 'none';
  },
): Promise<'resolved' | 'ambiguous' | 'unresolvable' | 'rejected' | 'delisted'> {
  if (input.fields.mappedStatus === 'delisted' || input.fields.mappedStatus === 'rented') {
    if (!input.dryRun) {
      await applyDeltaDelistSignal(client, {
        sourceId: input.sourceId,
        externalId: input.fields.externalId,
        mappedStatus: input.fields.mappedStatus,
      });
    }
    return 'delisted';
  }

  if (input.fields.unitCount != null && input.fields.unitCount > 1) {
    if (input.dryRun) return 'ambiguous';
    const sourceListingId = randomUUID();
    await client.query(
      `insert into source_listing (
         id, source_id, org_id, external_id, raw_record_id,
         resolution_status, mapped_status, rent_amount_cents,
         bedrooms, bathrooms, sqft, available_on, lease_term_months,
         description, mapping_version
       ) values ($1,$2,$3,$4,$5,'ambiguous',$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (source_id, external_id) do update set
         raw_record_id = excluded.raw_record_id,
         resolution_status = 'ambiguous',
         last_seen_at = now(),
         mapping_version = excluded.mapping_version
       returning id`,
      [
        sourceListingId,
        input.sourceId,
        input.orgId,
        input.fields.externalId,
        input.rawRecordId,
        input.fields.mappedStatus ?? 'active',
        input.fields.rentAmountCents,
        input.fields.bedrooms ?? null,
        input.fields.bathrooms ?? null,
        input.fields.sqft ?? null,
        input.fields.availableOn ?? null,
        input.fields.leaseTermMonths ?? null,
        input.fields.description ?? null,
        input.mappingVersion,
      ],
    );
    return 'ambiguous';
  }

  if (input.dryRun) {
    // Simulate resolution without writing property/unit/address/listing.
    if (input.fields.isDpvConfirmed === false) return 'ambiguous';
    if (!input.fields.addressRaw.trim()) return 'unresolvable';
    return 'resolved';
  }

  const resolved = await resolveOrCreatePropertyUnit(client, {
    rawAddress: input.fields.addressRaw,
    bedrooms: input.fields.bedrooms,
    bathrooms: input.fields.bathrooms,
    sqft: input.fields.sqft,
    isDpvConfirmed: input.fields.isDpvConfirmed,
  });

  if (resolved.resolutionStatus === 'unresolvable') {
    return 'unresolvable';
  }

  const sourceListingId = randomUUID();
  const { rows: slRows } = await client.query<{ id: string }>(
    `insert into source_listing (
       id, source_id, org_id, external_id, raw_record_id, address_id, unit_id,
       resolution_status, resolution_confidence, rent_amount_cents, deposit_cents,
       bedrooms, bathrooms, sqft, available_on, lease_term_months, description,
       source_status_raw, mapped_status, mapping_version
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     )
     on conflict (source_id, external_id) do update set
       raw_record_id = excluded.raw_record_id,
       address_id = excluded.address_id,
       unit_id = excluded.unit_id,
       resolution_status = excluded.resolution_status,
       rent_amount_cents = excluded.rent_amount_cents,
       deposit_cents = excluded.deposit_cents,
       bedrooms = excluded.bedrooms,
       bathrooms = excluded.bathrooms,
       sqft = excluded.sqft,
       available_on = excluded.available_on,
       lease_term_months = excluded.lease_term_months,
       description = excluded.description,
       source_status_raw = excluded.source_status_raw,
       mapped_status = excluded.mapped_status,
       last_seen_at = now(),
       mapping_version = excluded.mapping_version,
       absent_since = null
     returning id`,
    [
      sourceListingId,
      input.sourceId,
      input.orgId,
      input.fields.externalId,
      input.rawRecordId,
      resolved.addressId || null,
      resolved.unitId || null,
      resolved.resolutionStatus,
      resolved.resolutionStatus === 'resolved' ? 1 : 0.5,
      input.fields.rentAmountCents,
      input.fields.depositCents ?? null,
      input.fields.bedrooms ?? null,
      input.fields.bathrooms ?? null,
      input.fields.sqft ?? null,
      input.fields.availableOn ?? null,
      input.fields.leaseTermMonths ?? null,
      input.fields.description ?? null,
      input.fields.sourceStatusRaw ?? null,
      input.fields.mappedStatus ?? 'active',
      input.mappingVersion,
    ],
  );
  const slId = slRows[0]!.id;

  if (resolved.resolutionStatus === 'ambiguous') {
    return 'ambiguous';
  }

  if (input.fields.mediaUrls?.length) {
    const media = applyMediaPolicy(input.fields.mediaUrls, {
      mediaPolicy: input.mediaPolicy ?? 'none',
    });
    await recordMediaObservation(client, {
      sourceId: input.sourceId,
      syncRunId: input.syncRunId,
      results: media,
    });
  }

  await mergeCanonicalListing(client, {
    orgId: input.orgId,
    unitId: resolved.unitId,
    sourceListingId: slId,
    fields: input.fields,
    origin: input.origin,
    precedence: input.precedence,
  });

  return 'resolved';
}

/**
 * Run land → transform → resolve → merge for a batch of payloads.
 * No bypass path: every listing must come through this pipeline.
 */
export async function runIngestionPipeline(
  client: DbClient,
  input: {
    sourceId: string;
    records: Record<string, unknown>[];
    runKind?: 'incremental' | 'full_reconcile' | 'backfill' | 'push' | 'dry_run';
    mappingVersion?: string;
    fieldMapOverride?: Record<string, string>;
    valueMapsOverride?: Record<string, unknown>;
    thresholds?: Partial<IngestionThresholds>;
    /** When set with full_reconcile, enables absent detection. */
    reconcile?: boolean;
    skipQualityGates?: boolean;
    /** Force apply even if gated (tests after dual approval). */
    forceApplyQuarantined?: boolean;
  },
): Promise<{ syncRunId: string; counts: PipelineCounts; quarantined: boolean }> {
  const { rows: sources } = await client.query<{
    id: string;
    org_id: string;
    adapter_kind: string;
    precedence: number;
    mapping_profile_id: string | null;
    display_rule_id: string | null;
  }>(
    `select id, org_id, adapter_kind, precedence, mapping_profile_id, display_rule_id
     from source where id = $1`,
    [input.sourceId],
  );
  const source = sources[0];
  if (!source) throw new AppError('source not found', 'source_not_found', 404);

  const dryRun = input.runKind === 'dry_run';
  const mapping =
    input.fieldMapOverride || input.valueMapsOverride || input.mappingVersion
      ? await ensureMappingVersion(client, {
          adapterKind: source.adapter_kind,
          version: input.mappingVersion ?? 'custom',
          fieldMap: input.fieldMapOverride ?? DEFAULT_FIELD_MAP,
          valueMaps: input.valueMapsOverride,
        })
      : await ensureDefaultMapping(client, source.adapter_kind);

  if (!source.mapping_profile_id) {
    await client.query(`update source set mapping_profile_id = $2 where id = $1`, [
      source.id,
      mapping.id,
    ]);
  } else if (input.mappingVersion) {
    await client.query(`update source set mapping_profile_id = $2 where id = $1`, [
      source.id,
      mapping.id,
    ]);
  }

  let mediaPolicy: 'host' | 'hotlink' | 'none' = 'none';
  if (source.display_rule_id) {
    const { rows: rules } = await client.query<{ media_policy: 'host' | 'hotlink' | 'none' }>(
      `select media_policy from source_display_rule where id = $1`,
      [source.display_rule_id],
    );
    if (rules[0]) mediaPolicy = rules[0].media_policy;
  }

  const syncRunId = randomUUID();
  const startedAt = new Date();
  await client.query(
    `insert into sync_run (id, source_id, run_kind, status, started_at) values ($1,$2,$3,'running',$4)`,
    [syncRunId, source.id, input.runKind ?? 'push', startedAt],
  );

  const counts: PipelineCounts = {
    fetched: 0,
    new: 0,
    changed: 0,
    unchanged: 0,
    rejected: 0,
    ambiguous: 0,
    resolved: 0,
    unresolvable: 0,
    absent: 0,
    wouldCreate: 0,
  };

  const origin: 'manual' | 'ingested' =
    source.adapter_kind === 'manual' ? 'manual' : 'ingested';

  const rentsCents: number[] = [];
  const seenExternalIds = new Set<string>();
  const pendingWrites: Array<{
    rawId: number;
    fields: CanonicalListingFields;
    isNew: boolean;
  }> = [];

  // Snapshot canonical counts for dry_run verification helpers.
  const beforeCounts = dryRun
    ? await snapshotCanonicalCounts(client)
    : null;

  for (const payload of input.records) {
    counts.fetched += 1;
    const hash = payloadHash(payload);
    const externalId = String(payload.external_id ?? payload.id ?? '');
    if (externalId) seenExternalIds.add(externalId);

    const prior = await client.query<{ id: string }>(
      `select id from raw_record
       where source_id = $1 and external_id = $2 and payload_hash = $3
       limit 1`,
      [source.id, externalId || hash, hash],
    );
    if (prior.rows[0] && !input.mappingVersion) {
      // Idempotent re-fetch — unless remapping version explicitly requested.
      counts.unchanged += 1;
      if (externalId) seenExternalIds.add(externalId);
      continue;
    }

    // dry_run: land raw only in a side channel? Spec: writes nothing to canonical.
    // We still may land raw_record for audit of dry_run — but property/unit/listing/address forbidden.
    // To be strict: skip raw_record on dry_run too except we need transform. Use in-memory only.
    let rawId = 0;
    if (!dryRun) {
      const { rows: rawRows } = await client.query<{ id: string }>(
        `insert into raw_record (
           source_id, sync_run_id, external_id, payload, payload_hash, mapping_version
         ) values ($1,$2,$3,$4::jsonb,$5,$6)
         returning id::text`,
        [
          source.id,
          syncRunId,
          externalId || hash,
          JSON.stringify(payload),
          hash,
          mapping.version,
        ],
      );
      rawId = Number(rawRows[0]!.id);
      if (prior.rows[0]) {
        counts.changed += 1;
      } else {
        counts.new += 1;
      }
    } else {
      counts.new += 1;
    }

    const transformed = transformRecord(payload, mapping.fieldMap, {
      valueMaps: mapping.valueMaps,
    });
    if (!transformed.ok) {
      counts.rejected += 1;
      if (!dryRun) {
        await client.query(
          `update raw_record set transform_error = $2, transformed_at = now() where id = $1`,
          [rawId, transformed.reason],
        );
        await emitDomainEvent(client, {
          aggregateType: 'sync_run',
          aggregateId: syncRunId,
          eventType: 'raw_record.rejected',
          payload: {
            reason: transformed.reason,
            source_id: source.id,
            raw_record_id: rawId,
            external_id: externalId || hash,
          },
          actorKind: 'system',
        });
      }
      continue;
    }

    if (transformed.fields.rentAmountCents != null) {
      rentsCents.push(transformed.fields.rentAmountCents);
    }

    if (!dryRun) {
      await client.query(
        `update raw_record set transformed_at = now(), mapping_version = $2 where id = $1`,
        [rawId, mapping.version],
      );
    }

    pendingWrites.push({ rawId, fields: transformed.fields, isNew: !prior.rows[0] });
  }

  // Prior median for quality gates
  const { rows: priorRentRows } = await client.query<{ med: string | null }>(
    `select percentile_cont(0.5) within group (order by rent_amount_cents)::text as med
     from source_listing where source_id = $1 and rent_amount_cents is not null`,
    [source.id],
  );
  const priorMedian = priorRentRows[0]?.med != null ? Number(priorRentRows[0].med) : null;

  const { rows: priorFetchRows } = await client.query<{ med: string | null }>(
    `select percentile_cont(0.5) within group (order by records_fetched)::text as med
     from sync_run where source_id = $1 and status = 'succeeded' and records_fetched > 0`,
    [source.id],
  );
  const priorFetchedMedian =
    priorFetchRows[0]?.med != null ? Number(priorFetchRows[0].med) : null;

  let wouldDelistShare: number | undefined;
  if (
    (input.runKind === 'full_reconcile' || input.reconcile) &&
    !dryRun
  ) {
    const stamp = await stampAbsentFromReconcile(client, {
      sourceId: source.id,
      syncRunId,
      startedAt,
      seenExternalIds,
      apply: false,
    });
    wouldDelistShare =
      stamp.activeBefore > 0 ? stamp.wouldAbsent / stamp.activeBefore : 0;
    counts.absent = stamp.wouldAbsent;
  }

  // Provisional resolution counts for gate evaluation
  for (const pw of pendingWrites) {
    if (pw.fields.unitCount != null && pw.fields.unitCount > 1) counts.ambiguous += 1;
    else if (pw.fields.isDpvConfirmed === false) counts.ambiguous += 1;
    else if (!pw.fields.addressRaw.trim()) counts.unresolvable += 1;
    else counts.resolved += 1;
  }
  // Reset resolved/ambiguous — will recount on apply
  const provisionalResolved = counts.resolved;
  const provisionalAmbiguous = counts.ambiguous;
  const provisionalUnresolvable = counts.unresolvable;
  counts.resolved = 0;
  counts.ambiguous = 0;
  counts.unresolvable = 0;

  const gate = input.skipQualityGates
    ? { quarantine: false as const }
    : evaluateQualityGates({
        counts: {
          ...counts,
          resolved: provisionalResolved,
          ambiguous: provisionalAmbiguous,
          unresolvable: provisionalUnresolvable,
        },
        rentsCents,
        priorMedianRentCents: priorMedian,
        priorFetchedMedian,
        thresholds: input.thresholds,
        wouldDelistShare,
      });

  if (gate.quarantine && !input.forceApplyQuarantined) {
    await markSyncQuarantined(client, {
      syncRunId,
      reason: gate.reason,
      counts: {
        ...counts,
        resolved: provisionalResolved,
        ambiguous: provisionalAmbiguous,
        unresolvable: provisionalUnresolvable,
      },
    });
    return {
      syncRunId,
      counts: {
        ...counts,
        resolved: provisionalResolved,
        ambiguous: provisionalAmbiguous,
        unresolvable: provisionalUnresolvable,
      },
      quarantined: true,
    };
  }

  // Apply transforms
  for (const pw of pendingWrites) {
    const result = await processCanonicalRecord(client, {
      sourceId: source.id,
      orgId: source.org_id,
      syncRunId,
      rawRecordId: pw.rawId,
      fields: pw.fields,
      mappingVersion: mapping.version,
      origin,
      precedence: source.precedence,
      dryRun,
      mediaPolicy,
    });
    if (result === 'resolved') {
      counts.resolved += 1;
      if (dryRun) counts.wouldCreate = (counts.wouldCreate ?? 0) + 1;
    } else if (result === 'ambiguous') counts.ambiguous += 1;
    else if (result === 'unresolvable') counts.unresolvable += 1;
    else if (result === 'delisted') {
      /* counted in absent/changed */
    } else counts.rejected += 1;
  }

  if ((input.runKind === 'full_reconcile' || input.reconcile) && !dryRun) {
    const stamp = await stampAbsentFromReconcile(client, {
      sourceId: source.id,
      syncRunId,
      startedAt,
      seenExternalIds,
      apply: true,
    });
    counts.absent = stamp.wouldAbsent;
  }

  if (dryRun && beforeCounts) {
    const after = await snapshotCanonicalCounts(client);
    if (
      after.listing !== beforeCounts.listing ||
      after.property !== beforeCounts.property ||
      after.unit !== beforeCounts.unit ||
      after.address !== beforeCounts.address
    ) {
      throw new AppError('dry_run wrote canonical rows', 'dry_run_mutation', 500);
    }
  }

  await client.query(
    `update sync_run set
       status = 'succeeded',
       finished_at = now(),
       records_fetched = $2,
       records_new = $3,
       records_changed = $4,
       records_unchanged = $5,
       records_rejected = $6,
       records_absent = $7
     where id = $1`,
    [
      syncRunId,
      counts.fetched,
      counts.new,
      counts.changed,
      counts.unchanged,
      counts.rejected + counts.unresolvable,
      counts.absent,
    ],
  );

  if (!dryRun) {
    await client.query(
      `update source set last_success_at = now(), consecutive_failures = 0 where id = $1`,
      [source.id],
    );
  }

  await emitDomainEvent(client, {
    aggregateType: 'sync_run',
    aggregateId: syncRunId,
    eventType: dryRun ? 'sync_run.dry_run_completed' : 'sync_run.completed',
    payload: { ...counts, source_id: source.id, quarantined: false },
    actorKind: 'system',
  });

  return { syncRunId, counts, quarantined: false };
}

async function snapshotCanonicalCounts(client: DbClient) {
  const q = async (table: string) => {
    const { rows } = await client.query<{ c: string }>(`select count(*)::text as c from ${table}`);
    return Number(rows[0]!.c);
  };
  return {
    listing: await q('listing'),
    property: await q('property'),
    unit: await q('unit'),
    address: await q('address'),
  };
}

/**
 * Replay: re-transform historical raw_record with a new mapping version.
 * Zero partner API calls — only reads landed payloads.
 */
export async function replayRawRecords(
  client: DbClient,
  input: {
    sourceId: string;
    mappingVersion: string;
    fieldMap: Record<string, string>;
  },
): Promise<{ syncRunId: string; counts: PipelineCounts }> {
  const { rows: raws } = await client.query<{
    id: string;
    external_id: string;
    payload: Record<string, unknown>;
  }>(
    `select distinct on (external_id) id::text, external_id, payload
     from raw_record
     where source_id = $1 and payload is not null and transform_error is null
     order by external_id, received_at desc`,
    [input.sourceId],
  );

  const records = raws.map((r) => ({
    ...r.payload,
    external_id: r.external_id,
  }));

  // Bypass idempotency by passing mappingVersion so hashes still land as changed transforms.
  return runIngestionPipeline(client, {
    sourceId: input.sourceId,
    records,
    runKind: 'backfill',
    mappingVersion: input.mappingVersion,
    fieldMapOverride: input.fieldMap,
    skipQualityGates: true,
  });
}

export async function handlePushIngest(
  client: DbClient,
  input: {
    sourceId: string;
    rawBody: string;
    signatureHeader: string | undefined;
    nonce?: string | null;
    clock?: import('../shared/clock.js').Clock;
  },
): Promise<{ status: number; syncRunId?: string; reason?: string }> {
  const { verifyPushSignature, parsePushRecords } = await import('./push.js');
  const { rows } = await client.query<{ credential_ref: string | null }>(
    `select credential_ref from source where id = $1`,
    [input.sourceId],
  );
  if (!rows[0]?.credential_ref) {
    return { status: 401, reason: 'missing_credential' };
  }
  const verified = verifyPushSignature({
    rawBody: input.rawBody,
    signatureHeader: input.signatureHeader,
    credentialRef: rows[0].credential_ref,
    nonce: input.nonce,
    clock: input.clock,
  });
  if (!verified.ok) {
    if (verified.reason === 'malformed_body') {
      await emitDomainEvent(client, {
        aggregateType: 'source',
        aggregateId: input.sourceId,
        eventType: 'push.rejected',
        payload: { reason: verified.reason },
        actorKind: 'system',
      });
    }
    return { status: verified.status, reason: verified.reason };
  }
  const parsed = parsePushRecords(verified.body);
  if (parsed.reason) {
    await emitDomainEvent(client, {
      aggregateType: 'source',
      aggregateId: input.sourceId,
      eventType: 'push.rejected',
      payload: { reason: parsed.reason },
      actorKind: 'system',
    });
    return { status: 400, reason: parsed.reason };
  }
  const result = await runIngestionPipeline(client, {
    sourceId: input.sourceId,
    runKind: 'push',
    records: parsed.records,
    skipQualityGates: true,
  });
  return { status: 202, syncRunId: result.syncRunId };
}

export async function ensureManualSource(
  client: DbClient,
  orgId: string,
): Promise<{ sourceId: string }> {
  const { rows } = await client.query<{ id: string }>(
    `select id from source where org_id = $1 and adapter_kind = 'manual' limit 1`,
    [orgId],
  );
  if (rows[0]) return { sourceId: rows[0].id };

  const mapping = await ensureDefaultMapping(client, 'manual');
  const id = randomUUID();
  await client.query(
    `insert into source (
       id, org_id, name, adapter_kind, status, config,
       mapping_profile_id, precedence, sync_mode
     ) values ($1,$2,'Manual entry','manual','active','{}'::jsonb,$3,10,'manual')`,
    [id, orgId, mapping.id],
  );
  await emitDomainEvent(client, {
    aggregateType: 'source',
    aggregateId: id,
    eventType: 'source.created',
    payload: { adapter_kind: 'manual', org_id: orgId },
    actorKind: 'system',
  });
  return { sourceId: id };
}

export async function ensureCsvSource(
  client: DbClient,
  orgId: string,
): Promise<{ sourceId: string }> {
  const { rows } = await client.query<{ id: string }>(
    `select id from source where org_id = $1 and adapter_kind = 'csv_upload' limit 1`,
    [orgId],
  );
  if (rows[0]) return { sourceId: rows[0].id };

  const mapping = await ensureDefaultMapping(client, 'csv_upload');
  const id = randomUUID();
  await client.query(
    `insert into source (
       id, org_id, name, adapter_kind, status, config,
       mapping_profile_id, precedence, sync_mode
     ) values ($1,$2,'CSV upload','csv_upload','active','{}'::jsonb,$3,50,'manual')`,
    [id, orgId, mapping.id],
  );
  return { sourceId: id };
}

/** Manual listing entry — MUST go through the ingestion pipeline. */
export async function ingestManualListing(
  client: DbClient,
  input: {
    orgId: string;
    externalId?: string;
    addressRaw: string;
    rentAmountCents: number;
    depositCents?: number | null;
    bedrooms?: number | null;
    bathrooms?: number | null;
    sqft?: number | null;
  },
): Promise<{ syncRunId: string; counts: PipelineCounts }> {
  const { sourceId } = await ensureManualSource(client, input.orgId);
  const result = await runIngestionPipeline(client, {
    sourceId,
    runKind: 'push',
    records: [
      {
        external_id: input.externalId ?? `manual:${randomUUID()}`,
        address: input.addressRaw,
        rent_amount_cents: input.rentAmountCents,
        deposit_cents: input.depositCents ?? null,
        bedrooms: input.bedrooms ?? null,
        bathrooms: input.bathrooms ?? null,
        sqft: input.sqft ?? null,
      },
    ],
    skipQualityGates: true,
  });
  return { syncRunId: result.syncRunId, counts: result.counts };
}

export async function ingestCsvRows(
  client: DbClient,
  input: { orgId: string; rows: Record<string, unknown>[] },
): Promise<{ syncRunId: string; counts: PipelineCounts }> {
  const { sourceId } = await ensureCsvSource(client, input.orgId);
  const result = await runIngestionPipeline(client, {
    sourceId,
    runKind: 'backfill',
    records: input.rows,
    skipQualityGates: true,
  });
  return { syncRunId: result.syncRunId, counts: result.counts };
}

export { DEFAULT_INGESTION_THRESHOLDS };
