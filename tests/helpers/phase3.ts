import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../src/db/pool.js';
import type { KmsProvider } from '../../src/infra/crypto/kms.js';
import {
  createOrg,
  createPartyWithIdentity,
  grantRole,
} from '../../src/modules/identity/index.js';
import {
  ensureBrokerBalance,
  ensureBrokerPerformance,
  setBrokerCoverage,
  upsertBrokerProfile,
} from '../../src/modules/brokerage/index.js';
import { specSeedPriceBookTiers } from './price-book-seed.js';
import { seedListingPartyApp } from './phase2.js';

async function upsertApprovedConfig(
  client: DbClient,
  input: {
    namespace: string;
    version: string;
    payload: Record<string, unknown>;
    proposedByPartyId: string;
  },
): Promise<void> {
  const id = randomUUID();
  await client.query(
    `insert into config_version (
       id, namespace, version, payload, effective_from,
       proposed_by_party_id, approved_by_party_id, approved_at
     ) values ($1,$2,$3,$4::jsonb, '2020-01-01T00:00:00Z'::timestamptz, $5, $5, now())
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
    ],
  );
}

/**
 * TEST_ONLY Phase 3 config seeds.
 * D-05 lead_fee_recognition seeded (not a production code default).
 */
export async function seedPhase3TestConfig(
  client: DbClient,
  opts?: {
    proposedByPartyId?: string;
    leadFeeRecognition?: 'immediate' | 'deferred';
    priceBookVersion?: string;
    priceBookFeeOverride?: Partial<Record<string, number>>;
  },
): Promise<{ proposerId: string }> {
  let proposerId = opts?.proposedByPartyId;
  if (!proposerId) {
    const p = await client.query<{ id: string }>(
      `insert into party (id, kind) values ($1, 'person') returning id`,
      [randomUUID()],
    );
    proposerId = p.rows[0]!.id;
  }

  const tiers = specSeedPriceBookTiers().map((t) => ({
    tier: t.tier,
    rent_min_cents: t.rentMinCents,
    rent_max_cents: t.rentMaxCents,
    fee_cents: opts?.priceBookFeeOverride?.[t.tier] ?? t.feeCents,
  }));

  await upsertApprovedConfig(client, {
    namespace: 'rs_price_book',
    version: opts?.priceBookVersion ?? 'test-seed-v1',
    proposedByPartyId: proposerId,
    payload: { tiers },
  });

  await upsertApprovedConfig(client, {
    namespace: 'ledger_policy',
    version: 'test-1',
    proposedByPartyId: proposerId,
    payload: {
      // TEST_ONLY — D-05 unresolved; both paths supported; seeded for tests
      lead_fee_recognition: opts?.leadFeeRecognition ?? 'immediate',
    },
  });

  await upsertApprovedConfig(client, {
    namespace: 'lead_assignment',
    version: 'test-1',
    proposedByPartyId: proposerId,
    payload: {
      sla_hours: 4,
      max_reoffers: 3,
    },
  });

  return { proposerId };
}

export async function seedSubmarket(
  client: DbClient,
  name = 'Test Submarket',
): Promise<{ id: string }> {
  const id = randomUUID();
  // Simple unit square polygon for PostGIS
  await client.query(
    `insert into submarket (id, name, metro_code, boundary, version, is_active)
     values (
       $1, $2, 'TEST',
       ST_GeogFromText('POLYGON((-97.8 30.2,-97.7 30.2,-97.7 30.3,-97.8 30.3,-97.8 30.2))'),
       'v1', true
     )`,
    [id, name],
  );
  return { id };
}

export async function attachListingSubmarket(
  client: DbClient,
  listingId: string,
  submarketId: string,
): Promise<void> {
  await client.query(
    `update address a
     set submarket_id = $2
     from property p
     join unit u on u.property_id = p.id
     join listing l on l.unit_id = u.id
     where a.id = p.address_id and l.id = $1`,
    [listingId, submarketId],
  );
}

export async function createApplicationForListing(
  client: DbClient,
  input: {
    partyId: string;
    renterProfileId: string;
    listingId: string;
    unitId: string;
    orgId: string;
  },
): Promise<{ applicationId: string }> {
  const id = randomUUID();
  await client.query(
    `insert into application (
       id, party_id, renter_profile_id, listing_id, unit_id, org_id,
       entry_point, status, submitted_at
     ) values ($1,$2,$3,$4,$5,$6,'renter_initiated','screened', now())`,
    [
      id,
      input.partyId,
      input.renterProfileId,
      input.listingId,
      input.unitId,
      input.orgId,
    ],
  );
  return { applicationId: id };
}

export async function seedBrokerOrg(
  client: DbClient,
  input: {
    submarketId: string;
    licenseState?: string;
    licenseVerifiedAt?: Date | null;
    licenseExpiresAt?: string | null;
    creditTier?: 'new' | 'established' | 'invoiced' | 'suspended';
    priority?: number;
    maxOpenLeads?: number;
    legalName?: string;
  },
): Promise<{ orgId: string }> {
  const org = await createOrg(client, {
    kind: 'brokerage',
    legalName: input.legalName ?? `Broker ${randomUUID().slice(0, 8)}`,
    displayName: 'Broker',
  });
  await upsertBrokerProfile(client, {
    orgId: org.id,
    licenseState: input.licenseState ?? 'TX',
    licenseNumber: `LIC-${randomUUID().slice(0, 6)}`,
    licenseVerifiedAt:
      input.licenseVerifiedAt === undefined
        ? new Date('2025-01-01T00:00:00Z')
        : input.licenseVerifiedAt,
    licenseExpiresAt:
      input.licenseExpiresAt === undefined ? '2030-12-31' : input.licenseExpiresAt,
    creditTier: input.creditTier ?? 'established',
    maxOpenLeads: input.maxOpenLeads ?? 10,
    status: 'active',
  });
  await ensureBrokerPerformance(client, org.id);
  await ensureBrokerBalance(client, org.id);
  await setBrokerCoverage(client, {
    orgId: org.id,
    submarketId: input.submarketId,
    priority: input.priority ?? 100,
  });
  return { orgId: org.id };
}

export async function seedLeadWorld(
  client: DbClient,
  kms: KmsProvider,
  opts?: { rentCents?: number; email?: string },
): Promise<{
  landlordOrgId: string;
  partyId: string;
  renterProfileId: string;
  listingId: string;
  unitId: string;
  applicationId: string;
  submarketId: string;
  rentCents: number;
}> {
  const seed = await seedListingPartyApp(client, kms, { email: opts?.email });
  if (opts?.rentCents != null) {
    await client.query(`update listing set rent_amount_cents = $2 where id = $1`, [
      seed.listingId,
      opts.rentCents,
    ]);
  }
  const { rows: rentRow } = await client.query<{ rent_amount_cents: number }>(
    `select rent_amount_cents from listing where id = $1`,
    [seed.listingId],
  );
  const sub = await seedSubmarket(client);
  await attachListingSubmarket(client, seed.listingId, sub.id);
  const { applicationId } = await createApplicationForListing(client, {
    partyId: seed.partyId,
    renterProfileId: seed.renterProfileId,
    listingId: seed.listingId,
    unitId: seed.unitId,
    orgId: seed.orgId,
  });
  return {
    landlordOrgId: seed.orgId,
    partyId: seed.partyId,
    renterProfileId: seed.renterProfileId,
    listingId: seed.listingId,
    unitId: seed.unitId,
    applicationId,
    submarketId: sub.id,
    rentCents: rentRow[0]!.rent_amount_cents,
  };
}

export async function seedDualApprovalAdmins(
  client: DbClient,
  kms: KmsProvider,
): Promise<{ proposerId: string; approverId: string }> {
  const proposer = await createPartyWithIdentity(client, kms, {
    identity: { email: `prop-${randomUUID().slice(0, 8)}@example.com` },
  });
  const approver = await createPartyWithIdentity(client, kms, {
    identity: { email: `appr-${randomUUID().slice(0, 8)}@example.com` },
  });
  await grantRole(client, { partyId: proposer.partyId, role: 'rbit_admin' });
  await grantRole(client, { partyId: approver.partyId, role: 'rbit_admin' });
  return { proposerId: proposer.partyId, approverId: approver.partyId };
}
