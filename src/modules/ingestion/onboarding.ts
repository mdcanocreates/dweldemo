import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';
import { getAdapter } from './adapters/registry.js';
import { putCredential } from './credentials.js';
import { runIngestionPipeline } from './pipeline.js';
import type { AdapterKind, SourceConfig } from './types.js';
import { PRECEDENCE } from './types.js';

export type OnboardingStep = 'select' | 'authorize' | 'test' | 'preview' | 'dry_run' | 'activate';

/**
 * §6A.8 Partner onboarding — test → preview → dry run → activate.
 */
export async function createPartnerSource(
  client: DbClient,
  input: {
    orgId: string;
    name: string;
    adapterKind: AdapterKind;
    syncMode?: 'pull_incremental' | 'pull_full' | 'push' | 'manual';
    precedence?: number;
    config?: SourceConfig;
    credential?: { primary: string; kind?: 'api_key' | 'oauth' | 'hmac_secret' | 'basic' };
  },
): Promise<{ sourceId: string; credentialRef: string | null }> {
  const adapter = getAdapter(input.adapterKind);
  const credentialRef = input.credential
    ? putCredential({
        primary: input.credential.primary,
        kind: input.credential.kind ?? 'api_key',
      })
    : null;

  const precedence =
    input.precedence ??
    (input.adapterKind === 'manual'
      ? PRECEDENCE.landlord_direct
      : ['appfolio', 'buildium', 'rentmanager'].includes(input.adapterKind)
        ? PRECEDENCE.pm_system
        : input.adapterKind === 'csv_upload'
          ? PRECEDENCE.import
          : ['generic_rss', 'zillow_feed_xml', 'listhub_xml'].includes(input.adapterKind)
            ? PRECEDENCE.syndication_feed
            : PRECEDENCE.mls_aggregator);

  const id = randomUUID();
  await client.query(
    `insert into source (
       id, org_id, name, adapter_kind, status, credential_ref, config,
       precedence, sync_mode, sync_interval_seconds, rate_limit_per_minute
     ) values ($1,$2,$3,$4,'pending_auth',$5,$6::jsonb,$7,$8,3600,60)`,
    [
      id,
      input.orgId,
      input.name,
      input.adapterKind,
      credentialRef,
      JSON.stringify(input.config ?? {}),
      precedence,
      input.syncMode ??
        (adapter.capabilities().supportsIncremental ? 'pull_incremental' : 'pull_full'),
    ],
  );
  await emitDomainEvent(client, {
    aggregateType: 'source',
    aggregateId: id,
    eventType: 'source.created',
    payload: { adapter_kind: input.adapterKind, org_id: input.orgId },
    actorKind: 'system',
  });
  return { sourceId: id, credentialRef };
}

export async function testPartnerConnection(
  client: DbClient,
  sourceId: string,
): Promise<{ ok: boolean; sampleCount: number; message?: string; samples?: Record<string, unknown>[] }> {
  const source = await loadSource(client, sourceId);
  const adapter = getAdapter(source.adapter_kind);
  await client.query(`update source set status = 'testing' where id = $1`, [sourceId]);
  const cfg = source.config as SourceConfig;
  const result = await adapter.testConnection(cfg);
  if (!result.ok) {
    await client.query(
      `update source set status = 'failed', consecutive_failures = consecutive_failures + 1 where id = $1`,
      [sourceId],
    );
    return { ok: false, sampleCount: 0, message: result.message };
  }
  const samples: Record<string, unknown>[] = [];
  let n = 0;
  for await (const rec of adapter.fetchFull(cfg)) {
    samples.push(rec.payload);
    n += 1;
    if (n >= 5) break;
  }
  return { ok: true, sampleCount: samples.length, samples };
}

export async function previewMapping(
  client: DbClient,
  sourceId: string,
): Promise<{
  rows: Array<{ raw: Record<string, unknown>; normalized: Record<string, unknown> | null; reason: string | null }>;
}> {
  const { transformRecord, DEFAULT_FIELD_MAP } = await import('./transform.js');
  const source = await loadSource(client, sourceId);
  const adapter = getAdapter(source.adapter_kind);
  const fieldMap = await loadFieldMap(client, source);
  const rows = [];
  let n = 0;
  for await (const rec of adapter.fetchFull(source.config as SourceConfig)) {
    const t = transformRecord(rec.payload, fieldMap);
    rows.push({
      raw: rec.payload,
      normalized: t.ok
        ? {
            external_id: t.fields.externalId,
            address: t.fields.addressRaw,
            rent_amount_cents: t.fields.rentAmountCents,
            bedrooms: t.fields.bedrooms,
            bathrooms: t.fields.bathrooms,
          }
        : null,
      reason: t.ok ? null : t.reason,
    });
    n += 1;
    if (n >= 10) break;
  }
  void DEFAULT_FIELD_MAP;
  return { rows };
}

export async function dryRunPartnerSource(
  client: DbClient,
  sourceId: string,
): Promise<{ syncRunId: string; counts: Awaited<ReturnType<typeof runIngestionPipeline>>['counts'] }> {
  const source = await loadSource(client, sourceId);
  await client.query(`update source set status = 'dry_run' where id = $1`, [sourceId]);
  const adapter = getAdapter(source.adapter_kind);
  const records: Record<string, unknown>[] = [];
  for await (const rec of adapter.fetchFull(source.config as SourceConfig)) {
    records.push({ ...rec.payload, external_id: rec.externalId });
  }
  return runIngestionPipeline(client, {
    sourceId,
    runKind: 'dry_run',
    records,
  });
}

export async function activatePartnerSource(
  client: DbClient,
  sourceId: string,
): Promise<void> {
  const source = await loadSource(client, sourceId);
  if (!['dry_run', 'testing', 'paused'].includes(source.status) && source.status !== 'pending_auth') {
    // allow activate from dry_run primarily
  }
  await client.query(`update source set status = 'active' where id = $1`, [sourceId]);
  await emitDomainEvent(client, {
    aggregateType: 'source',
    aggregateId: sourceId,
    eventType: 'source.activated',
    payload: { adapter_kind: source.adapter_kind },
    actorKind: 'system',
  });
}

async function loadSource(client: DbClient, sourceId: string) {
  const { rows } = await client.query<{
    id: string;
    adapter_kind: string;
    status: string;
    config: SourceConfig;
    mapping_profile_id: string | null;
  }>(`select id, adapter_kind, status, config, mapping_profile_id from source where id = $1`, [
    sourceId,
  ]);
  if (!rows[0]) throw new AppError('source not found', 'source_not_found', 404);
  return rows[0];
}

async function loadFieldMap(
  client: DbClient,
  source: { mapping_profile_id: string | null; adapter_kind: string },
): Promise<Record<string, string>> {
  const { DEFAULT_FIELD_MAP } = await import('./transform.js');
  if (!source.mapping_profile_id) return { ...DEFAULT_FIELD_MAP };
  const { rows } = await client.query<{ field_map: Record<string, string> }>(
    `select field_map from mapping_profile where id = $1`,
    [source.mapping_profile_id],
  );
  return rows[0]?.field_map ?? { ...DEFAULT_FIELD_MAP };
}
