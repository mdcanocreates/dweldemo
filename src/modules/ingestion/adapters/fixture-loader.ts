import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RawRecord, SourceConfig } from '../types.js';

const FIXTURES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/ingestion',
);

export function resolveFixturePath(relative: string): string {
  return path.isAbsolute(relative) ? relative : path.join(FIXTURES_ROOT, relative);
}

export function loadJsonFixture(cfg: SourceConfig): RawRecord[] {
  if (cfg.fixtureRecords) return cfg.fixtureRecords;
  if (!cfg.fixturePath) return [];
  const abs = resolveFixturePath(cfg.fixturePath);
  const raw = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
  if (Array.isArray(raw)) {
    return raw.map((row, i) => normalizeRow(row as Record<string, unknown>, i));
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as { records?: unknown }).records)) {
    return ((raw as { records: Record<string, unknown>[] }).records).map((row, i) =>
      normalizeRow(row, i),
    );
  }
  throw new Error(`unsupported fixture shape: ${cfg.fixturePath}`);
}

function normalizeRow(row: Record<string, unknown>, index: number): RawRecord {
  const externalId = String(row.external_id ?? row.externalId ?? row.id ?? `row-${index}`);
  return {
    externalId,
    payload: row,
    sourceModifiedAt:
      row.source_modified_at != null
        ? String(row.source_modified_at)
        : row.ModificationTimestamp != null
          ? String(row.ModificationTimestamp)
          : null,
    cursor: row.cursor != null ? String(row.cursor) : null,
  };
}

/** Parse a minimal RSS/XML listing feed into RawRecords (fixture-only, no network). */
export function parseListingXml(xml: string, idAttr = 'id'): RawRecord[] {
  const items: RawRecord[] = [];
  const itemRe = /<(?:item|listing|property)\b[^>]*>([\s\S]*?)<\/(?:item|listing|property)>/gi;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = itemRe.exec(xml))) {
    const body = m[1]!;
    const get = (tag: string): string | null => {
      const tm = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      return tm ? tm[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : null;
    };
    const externalId =
      get(idAttr) ?? get('guid') ?? get('id') ?? get('ListingKey') ?? `xml-${i}`;
    const address =
      get('address') ??
      get('Address') ??
      [get('street'), get('city'), get('state'), get('postal')].filter(Boolean).join(', ');
    const rentRaw = get('rent') ?? get('price') ?? get('ListPrice') ?? get('rent_amount_cents');
    const payload: Record<string, unknown> = {
      external_id: externalId,
      address,
      rent_amount_cents: rentRaw != null ? Number(String(rentRaw).replace(/[$,]/g, '')) : null,
      bedrooms: numOrNull(get('bedrooms') ?? get('Beds')),
      bathrooms: numOrNull(get('bathrooms') ?? get('Baths')),
      sqft: numOrNull(get('sqft') ?? get('LivingArea')),
      description: get('description') ?? get('title'),
      unit_count: numOrNull(get('unit_count')),
      StandardStatus: get('StandardStatus') ?? get('status'),
    };
    items.push({
      externalId: String(externalId),
      payload,
      sourceModifiedAt: get('pubDate') ?? get('ModificationTimestamp'),
    });
    i += 1;
  }
  return items;
}

function numOrNull(v: string | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function loadXmlFixture(cfg: SourceConfig): RawRecord[] {
  if (cfg.fixtureRecords) return cfg.fixtureRecords;
  if (!cfg.fixturePath) return [];
  const abs = resolveFixturePath(cfg.fixturePath);
  const xml = readFileSync(abs, 'utf8');
  return parseListingXml(xml);
}

export async function* iterateRecords(records: RawRecord[]): AsyncIterable<RawRecord> {
  for (const r of records) {
    yield r;
  }
}
