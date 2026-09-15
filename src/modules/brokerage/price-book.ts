import type { DbClient } from '../../db/pool.js';
import { resolveConfig } from '../config/index.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';

export type PriceBookTier = {
  tier: string;
  rentMinCents: number;
  rentMaxCents: number | null;
  feeCents: number;
};

export type ClassifiedTier = {
  rsTier: string;
  feeAmountCents: number;
  priceBookVersion: string;
  classifierVersion: string;
  rentAmountCentsAtClass: number;
};

const CLASSIFIER_VERSION = 'rs_classifier_v1';

/**
 * Resolve approved rs_price_book config. Unapproved versions are invisible
 * (config.approve dual-approval gate — §10.3 / §3.2).
 * Fee amounts live only in config_version payload — not in this module.
 */
export async function resolvePriceBook(
  client: DbClient,
  asOf: Date,
): Promise<{ version: string; tiers: PriceBookTier[] } | null> {
  const { rows } = await client.query<{ version: string; payload: Record<string, unknown> }>(
    `select version, payload from config_version
     where namespace = 'rs_price_book'
       and approved_by_party_id is not null
       and effective_from <= $1
       and (effective_to is null or effective_to > $1)
     order by effective_from desc
     limit 1`,
    [asOf],
  );
  const row = rows[0];
  if (!row) return null;
  const tiersRaw = row.payload.tiers;
  if (!Array.isArray(tiersRaw)) {
    throw new AppError('rs_price_book.tiers missing', 'PRICE_BOOK_INVALID');
  }
  const tiers: PriceBookTier[] = tiersRaw.map((t) => {
    const o = t as Record<string, unknown>;
    return {
      tier: String(o.tier),
      rentMinCents: Number(o.rent_min_cents),
      rentMaxCents: o.rent_max_cents == null ? null : Number(o.rent_max_cents),
      feeCents: Number(o.fee_cents),
    };
  });
  return { version: row.version, tiers };
}

export function classifyRentAgainstBook(
  rentAmountCents: number,
  book: { version: string; tiers: PriceBookTier[] },
): ClassifiedTier {
  const match = book.tiers.find((t) => {
    if (rentAmountCents < t.rentMinCents) return false;
    if (t.rentMaxCents == null) return true;
    return rentAmountCents <= t.rentMaxCents;
  });
  if (!match) {
    throw new AppError(
      `rent ${rentAmountCents} outside price book`,
      'RENT_OUT_OF_BOOK',
    );
  }
  return {
    rsTier: match.tier,
    feeAmountCents: match.feeCents,
    priceBookVersion: book.version,
    classifierVersion: CLASSIFIER_VERSION,
    rentAmountCentsAtClass: rentAmountCents,
  };
}

export async function classifyLeadFee(
  client: DbClient,
  rentAmountCents: number,
  opts?: { asOf?: Date; clock?: Clock },
): Promise<ClassifiedTier> {
  const clock = opts?.clock ?? systemClock;
  const asOf = opts?.asOf ?? clock.now();
  const book = await resolvePriceBook(client, asOf);
  if (!book) {
    throw new AppError(
      'no approved rs_price_book effective — dual approval required',
      'PRICE_BOOK_NOT_EFFECTIVE',
    );
  }
  return classifyRentAgainstBook(rentAmountCents, book);
}

/** Helper: is an unapproved proposal visible via resolveConfig? */
export async function isPriceBookEffectiveViaResolve(
  client: DbClient,
  asOf: Date,
): Promise<boolean> {
  const cfg = await resolveConfig(client, 'rs_price_book', asOf);
  return cfg != null;
}
