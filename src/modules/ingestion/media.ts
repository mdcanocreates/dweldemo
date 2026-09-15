import { createHash } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import type { SourceDisplayRule } from './display-serialize.js';

export type MediaFetchResult = {
  url: string;
  contentHash: string | null;
  hosted: boolean;
  stale: boolean;
  skipped: boolean;
  reason?: string;
};

/**
 * §6A.6 Media policies — fetch during transform, not lazily at render.
 * host | hotlink | none. Content-hash dedup; never live-network in tests.
 */
export function applyMediaPolicy(
  urls: string[] | undefined,
  rule: Pick<SourceDisplayRule, 'mediaPolicy'> | null | undefined,
): MediaFetchResult[] {
  const policy = rule?.mediaPolicy ?? 'none';
  if (!urls?.length || policy === 'none') {
    return (urls ?? []).map((url) => ({
      url,
      contentHash: null,
      hosted: false,
      stale: false,
      skipped: true,
      reason: 'media_policy_none',
    }));
  }

  const out: MediaFetchResult[] = [];
  for (const url of urls) {
    const contentHash = createHash('sha256').update(url).digest('hex');
    if (policy === 'hotlink') {
      out.push({ url, contentHash, hosted: false, stale: false, skipped: false });
    } else {
      out.push({
        url: `s3://rbit-media-stub/${contentHash}`,
        contentHash,
        hosted: true,
        stale: false,
        skipped: false,
      });
    }
  }
  return out;
}

export function mediaSetHash(hashes: string[]): string {
  return createHash('sha256').update(hashes.join('|')).digest('hex');
}

export async function recordMediaObservation(
  client: DbClient,
  input: {
    sourceId: string;
    syncRunId: string;
    results: MediaFetchResult[];
  },
): Promise<void> {
  await emitDomainEvent(client, {
    aggregateType: 'sync_run',
    aggregateId: input.syncRunId,
    eventType: 'sync_run.media_observed',
    payload: {
      source_id: input.sourceId,
      fetched: input.results.filter((r) => !r.skipped).length,
      skipped: input.results.filter((r) => r.skipped).length,
      stale: input.results.filter((r) => r.stale).length,
    },
    actorKind: 'system',
  });
}
