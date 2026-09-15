import { createHash, randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';

const STREET_ALIASES: Record<string, string> = {
  street: 'st',
  st: 'st',
  avenue: 'ave',
  ave: 'ave',
  boulevard: 'blvd',
  blvd: 'blvd',
  road: 'rd',
  rd: 'rd',
  drive: 'dr',
  dr: 'dr',
  lane: 'ln',
  ln: 'ln',
  court: 'ct',
  ct: 'ct',
  place: 'pl',
  pl: 'pl',
};

const UNIT_PREFIX_RE =
  /^(?:apt|apartment|unit|ste|suite|#)\s*/i;

export type NormalizedAddress = {
  line1: string;
  line2: string | null;
  unitLabelNormalized: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  normalizedHash: string;
  rawInput: string;
};

/**
 * Deterministic address normalizer stub.
 * Maps Apt/Street/#/UNIT variants to the same normalized_hash.
 */
export function normalizeAddress(rawInput: string): NormalizedAddress {
  const collapsed = rawInput.trim().replace(/\s+/g, ' ');
  const upper = collapsed.toUpperCase();

  // Split unit designator from street line.
  let line1 = upper;
  let unitRaw: string | null = null;

  const unitMatch = upper.match(
    /\s+(?:APT\.?|APARTMENT|UNIT|#|STE\.?|SUITE)\s*([A-Z0-9-]+)\s*$/i,
  );
  if (unitMatch) {
    unitRaw = unitMatch[1]!;
    line1 = upper.slice(0, unitMatch.index).trim();
  } else {
    const hashMatch = upper.match(/\s+#\s*([A-Z0-9-]+)\s*$/);
    if (hashMatch) {
      unitRaw = hashMatch[1]!;
      line1 = upper.slice(0, hashMatch.index).trim();
    }
  }

  const tokens = line1
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => STREET_ALIASES[t.toLowerCase()]?.toUpperCase() ?? t);

  const normalizedLine1 = tokens.join(' ');
  const unitLabelNormalized = unitRaw
    ? unitRaw.replace(UNIT_PREFIX_RE, '').toUpperCase()
    : '';

  const hashInput = [
    normalizedLine1,
    unitLabelNormalized,
  ].join('|');

  const normalizedHash = createHash('sha256').update(hashInput).digest('hex');

  return {
    line1: normalizedLine1,
    line2: unitLabelNormalized ? `UNIT ${unitLabelNormalized}` : null,
    unitLabelNormalized,
    city: null,
    state: null,
    postalCode: null,
    normalizedHash,
    rawInput: collapsed,
  };
}

export async function upsertNormalizedAddress(
  client: DbClient,
  rawInput: string,
  opts?: {
    isDpvConfirmed?: boolean;
    geocodePrecision?: 'rooftop' | 'parcel' | 'interpolated' | 'centroid' | null;
    submarketId?: string | null;
  },
): Promise<{ addressId: string; unitLabelNormalized: string; created: boolean }> {
  const n = normalizeAddress(rawInput);

  const existing = await client.query<{ id: string }>(
    `select id from address where normalized_hash = $1`,
    [n.normalizedHash],
  );
  if (existing.rows[0]) {
    return {
      addressId: existing.rows[0].id,
      unitLabelNormalized: n.unitLabelNormalized,
      created: false,
    };
  }

  const id = randomUUID();
  await client.query(
    `insert into address (
       id, raw_input, line1, line2, city, state, postal_code,
       is_dpv_confirmed, normalized_hash, geocode_precision,
       submarket_id, normalizer_vendor, normalizer_version
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'rbit_stub','1.0.0')`,
    [
      id,
      n.rawInput,
      n.line1,
      n.line2,
      n.city,
      n.state,
      n.postalCode,
      opts?.isDpvConfirmed ?? true,
      n.normalizedHash,
      opts?.geocodePrecision ?? 'rooftop',
      opts?.submarketId ?? null,
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'address',
    aggregateId: id,
    eventType: 'address.normalized',
    payload: { normalized_hash: n.normalizedHash },
    actorKind: 'system',
  });

  return {
    addressId: id,
    unitLabelNormalized: n.unitLabelNormalized,
    created: true,
  };
}

export async function resolveOrCreatePropertyUnit(
  client: DbClient,
  input: {
    rawAddress: string;
    propertyType?: string;
    bedrooms?: number | null;
    bathrooms?: number | null;
    sqft?: number | null;
    isDpvConfirmed?: boolean;
  },
): Promise<{
  addressId: string;
  propertyId: string;
  unitId: string;
  unitLabelNormalized: string;
  resolutionStatus: 'resolved' | 'ambiguous' | 'unresolvable';
}> {
  if (!input.rawAddress.trim()) {
    return {
      addressId: '',
      propertyId: '',
      unitId: '',
      unitLabelNormalized: '',
      resolutionStatus: 'unresolvable',
    };
  }

  const isDpv = input.isDpvConfirmed ?? true;
  if (!isDpv) {
    const addr = await upsertNormalizedAddress(client, input.rawAddress, {
      isDpvConfirmed: false,
      geocodePrecision: 'centroid',
    });
    return {
      addressId: addr.addressId,
      propertyId: '',
      unitId: '',
      unitLabelNormalized: addr.unitLabelNormalized,
      resolutionStatus: 'ambiguous',
    };
  }

  const addr = await upsertNormalizedAddress(client, input.rawAddress, {
    isDpvConfirmed: true,
    geocodePrecision: 'rooftop',
  });

  let propertyId: string;
  const prop = await client.query<{ id: string }>(
    `select id from property where address_id = $1`,
    [addr.addressId],
  );
  if (prop.rows[0]) {
    propertyId = prop.rows[0].id;
  } else {
    propertyId = randomUUID();
    await client.query(
      `insert into property (id, address_id, property_type) values ($1,$2,$3)`,
      [propertyId, addr.addressId, input.propertyType ?? 'residential'],
    );
    await emitDomainEvent(client, {
      aggregateType: 'property',
      aggregateId: propertyId,
      eventType: 'property.created',
      payload: { address_id: addr.addressId },
      actorKind: 'system',
    });
  }

  const unitExisting = await client.query<{ id: string }>(
    `select id from unit where property_id = $1 and unit_label_normalized = $2`,
    [propertyId, addr.unitLabelNormalized],
  );
  if (unitExisting.rows[0]) {
    return {
      addressId: addr.addressId,
      propertyId,
      unitId: unitExisting.rows[0].id,
      unitLabelNormalized: addr.unitLabelNormalized,
      resolutionStatus: 'resolved',
    };
  }

  const unitId = randomUUID();
  await client.query(
    `insert into unit (
       id, property_id, unit_label_raw, unit_label_normalized,
       bedrooms, bathrooms, sqft
     ) values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      unitId,
      propertyId,
      addr.unitLabelNormalized || null,
      addr.unitLabelNormalized,
      input.bedrooms ?? null,
      input.bathrooms ?? null,
      input.sqft ?? null,
    ],
  );
  await emitDomainEvent(client, {
    aggregateType: 'unit',
    aggregateId: unitId,
    eventType: 'unit.created',
    payload: {
      property_id: propertyId,
      unit_label_normalized: addr.unitLabelNormalized,
    },
    actorKind: 'system',
  });

  return {
    addressId: addr.addressId,
    propertyId,
    unitId,
    unitLabelNormalized: addr.unitLabelNormalized,
    resolutionStatus: 'resolved',
  };
}
