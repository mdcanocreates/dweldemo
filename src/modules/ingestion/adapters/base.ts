import type {
  AdapterCapabilities,
  AdapterKind,
  ConnectionTestResult,
  ListingSourceAdapter,
  RawRecord,
  SourceConfig,
} from '../types.js';
import { iterateRecords, loadJsonFixture, loadXmlFixture } from './fixture-loader.js';

export type FixtureFormat = 'json' | 'xml';

/**
 * Fixture-backed adapter — never opens a network socket.
 * Live endpoints are rejected so CI cannot accidentally hit partners.
 */
export function createFixtureAdapter(opts: {
  kind: AdapterKind;
  format: FixtureFormat;
  capabilities?: Partial<AdapterCapabilities>;
}): ListingSourceAdapter {
  const caps: AdapterCapabilities = {
    supportsIncremental: opts.capabilities?.supportsIncremental ?? true,
    supportsDelistSignal: opts.capabilities?.supportsDelistSignal ?? false,
    supportsMedia: opts.capabilities?.supportsMedia ?? false,
    cursorField: opts.capabilities?.cursorField ?? null,
  };

  const load = (cfg: SourceConfig): RawRecord[] => {
    assertNoLiveNetwork(cfg);
    return opts.format === 'xml' ? loadXmlFixture(cfg) : loadJsonFixture(cfg);
  };

  return {
    kind: opts.kind,
    async testConnection(cfg) {
      try {
        const records = load(cfg).slice(0, 5);
        return { ok: true, sampleCount: records.length };
      } catch (err) {
        return {
          ok: false,
          sampleCount: 0,
          errorClass: 'connection_failed',
          message: sanitizeAdapterError(err),
        };
      }
    },
    async *fetchIncremental(cfg, cursor) {
      const records = load(cfg);
      if (!cursor) {
        yield* iterateRecords(records);
        return;
      }
      let past = false;
      for (const r of records) {
        if (!past) {
          if ((r.cursor ?? r.sourceModifiedAt ?? r.externalId) === cursor) {
            past = true;
          }
          continue;
        }
        yield r;
      }
      // If cursor not found, treat as full set (fixture replay safety).
      if (!past) yield* iterateRecords(records);
    },
    async *fetchFull(cfg) {
      yield* iterateRecords(load(cfg));
    },
    capabilities() {
      return { ...caps };
    },
  };
}

export function assertNoLiveNetwork(cfg: SourceConfig): void {
  const ep = cfg.endpoint ?? '';
  if (/^https?:\/\//i.test(ep) && !cfg.fixturePath && !cfg.fixtureRecords) {
    throw new Error('live network endpoints are forbidden in ListingSourceAdapter (use fixtures)');
  }
}

export function sanitizeAdapterError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=[REDACTED]')
    .replace(/secret[=:]\s*\S+/gi, 'secret=[REDACTED]')
    .replace(/password[=:]\s*\S+/gi, 'password=[REDACTED]')
    .slice(0, 200);
}

export async function collectAsync<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}
