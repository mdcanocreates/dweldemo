import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../src/db/pool.js';
import type { KmsProvider } from '../../src/infra/crypto/kms.js';
import {
  createOrg,
  createPartyWithIdentity,
  grantRole,
} from '../../src/modules/identity/index.js';

async function upsertApprovedConfig(
  client: DbClient,
  input: {
    namespace: string;
    version: string;
    payload: Record<string, unknown>;
    proposedByPartyId: string;
    effectiveFrom?: string;
  },
): Promise<string> {
  const id = randomUUID();
  const effectiveFrom = input.effectiveFrom ?? '2020-01-01T00:00:00Z';
  await client.query(
    `insert into config_version (
       id, namespace, version, payload, effective_from,
       proposed_by_party_id, approved_by_party_id, approved_at
     ) values ($1,$2,$3,$4::jsonb, $6::timestamptz, $5, $5, now())
     on conflict (namespace, version) do update
       set payload = excluded.payload,
           effective_from = excluded.effective_from,
           approved_by_party_id = excluded.approved_by_party_id,
           approved_at = excluded.approved_at`,
    [
      id,
      input.namespace,
      input.version,
      JSON.stringify(input.payload),
      input.proposedByPartyId,
      effectiveFrom,
    ],
  );
  const { rows } = await client.query<{ id: string }>(
    `select id from config_version where namespace = $1 and version = $2`,
    [input.namespace, input.version],
  );
  return rows[0]!.id;
}

/**
 * TEST_ONLY Phase 6 config seeds — reference model params live in config_version,
 * never as production code literals (P8 / §13.1).
 *
 * Reference: installed $2.40/W, pool 35%, RBIT 40%, floor $750,
 * tiers 1–4 caps $1250/$2050/$4000/$5000, min viable $500.
 * Tier 4 + gross $35,000 → Equation 2 adjusts $5000 → $4150.
 */
export async function seedPhase6SolarConfig(
  client: DbClient,
  opts?: {
    proposedByPartyId?: string;
    minimumViableCashbackCents?: number;
    underwritingVersion?: string;
    tiersVersion?: string;
    effectiveFrom?: string;
  },
): Promise<{
  proposerId: string;
  underwritingConfigId: string;
  tiersConfigId: string;
}> {
  let proposerId = opts?.proposedByPartyId;
  if (!proposerId) {
    const p = await client.query<{ id: string }>(
      `insert into party (id, kind) values ($1, 'person') returning id`,
      [randomUUID()],
    );
    proposerId = p.rows[0]!.id;
  }

  const underwritingConfigId = await upsertApprovedConfig(client, {
    namespace: 'solar_underwriting',
    version: opts?.underwritingVersion ?? 'test-ref-v1',
    proposedByPartyId: proposerId,
    // Default to now so each seed wins over earlier test configs with same namespace
    effectiveFrom: opts?.effectiveFrom ?? new Date().toISOString(),
    payload: {
      // TEST_ONLY reference model (§13.1)
      installed_cost_basis_cents_per_watt: 240, // $2.40/watt
      net_profit_pool_bps: 3500, // 35%
      rbit_share_of_net_bps: 4000, // 40%
      net_to_rbit_floor_cents: 75_000, // $750
      minimum_viable_cashback_cents: opts?.minimumViableCashbackCents ?? 50_000, // $500
    },
  });

  const tiersConfigId = await upsertApprovedConfig(client, {
    namespace: 'solar_tiers',
    version: opts?.tiersVersion ?? 'test-ref-v1',
    proposedByPartyId: proposerId,
    effectiveFrom: opts?.effectiveFrom ?? new Date().toISOString(),
    payload: {
      // TEST_ONLY — §13.2 four-tier caps
      tiers: [
        { tier: 1, size_min_kw: 8, size_max_kw: 15, cap_cents: 125_000 },
        { tier: 2, size_min_kw: 15, size_max_kw: 25, cap_cents: 205_000 },
        { tier: 3, size_min_kw: 25, size_max_kw: 35, cap_cents: 400_000 },
        { tier: 4, size_min_kw: 35, size_max_kw: 60, cap_cents: 500_000 },
      ],
    },
  });

  return { proposerId, underwritingConfigId, tiersConfigId };
}

export async function seedSolarParties(
  client: DbClient,
  kms: KmsProvider,
): Promise<{
  partnerOrgId: string;
  homeownerPartyId: string;
  repPartyId: string;
}> {
  const partner = await createOrg(client, {
    kind: 'solar_partner',
    legalName: 'PBC Solar Test LLC',
    displayName: 'PBC Solar',
  });

  const homeowner = await createPartyWithIdentity(client, kms, {
    kind: 'person',
    identity: {
      givenName: 'Home',
      familyName: 'Owner',
      email: `ho-${randomUUID().slice(0, 8)}@example.test`,
    },
  });
  await grantRole(client, {
    partyId: homeowner.partyId,
    role: 'solar_homeowner',
  });

  const rep = await createPartyWithIdentity(client, kms, {
    kind: 'person',
    identity: {
      givenName: 'Solar',
      familyName: 'Rep',
      email: `rep-${randomUUID().slice(0, 8)}@example.test`,
    },
  });
  await grantRole(client, {
    partyId: rep.partyId,
    orgId: partner.id,
    role: 'solar_rep',
  });

  return {
    partnerOrgId: partner.id,
    homeownerPartyId: homeowner.partyId,
    repPartyId: rep.partyId,
  };
}

/** Tier 4 reference case: gross $35k → profit share $4900 → adjusted cashback $4150. */
export const TIER4_REFERENCE = {
  systemSizeKw: 40,
  grossProjectCostCents: 3_500_000, // $35,000
  salePriceCents: 3_500_000,
  expectedProfitShareCents: 490_000, // $4,900
  tierCapCents: 500_000,
  adjustedCashbackCents: 415_000, // $4,150
} as const;
