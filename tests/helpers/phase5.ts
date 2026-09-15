import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../src/db/pool.js';
import { createOrg, createPartyWithIdentity } from '../../src/modules/identity/index.js';
import type { KmsProvider } from '../../src/infra/crypto/kms.js';
import { ingestManualListing } from '../../src/modules/ingestion/index.js';
import { seedSubmarket, attachListingSubmarket } from './phase3.js';

async function upsertApprovedConfig(
  client: DbClient,
  input: {
    namespace: string;
    version: string;
    payload: Record<string, unknown>;
    proposedByPartyId: string;
    effectiveFrom?: string;
  },
): Promise<void> {
  const id = randomUUID();
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
      input.effectiveFrom ?? '2020-01-01T00:00:00Z',
    ],
  );
}

/** TEST_ONLY scraping_policy seed (§3.7 / Phase 5). */
export async function seedScrapingPolicy(
  client: DbClient,
  opts?: {
    proposedByPartyId?: string;
    allowIndexedCrawlers?: boolean;
    allowGenericAutomation?: boolean;
    unauthenticatedBurstLimit?: number;
    unauthenticatedWindowMs?: number;
    version?: string;
    effectiveFrom?: string;
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

  await upsertApprovedConfig(client, {
    namespace: 'scraping_policy',
    version: opts?.version ?? 'test-1',
    proposedByPartyId: proposerId,
    effectiveFrom: opts?.effectiveFrom,
    payload: {
      allow_indexed_crawlers: opts?.allowIndexedCrawlers ?? true,
      allow_generic_automation: opts?.allowGenericAutomation ?? false,
      unauthenticated_burst_limit: opts?.unauthenticatedBurstLimit ?? 5,
      unauthenticated_window_ms: opts?.unauthenticatedWindowMs ?? 60_000,
    },
  });

  return { proposerId };
}

export async function seedPhase5Listing(
  client: DbClient,
  kms: KmsProvider,
  opts?: { status?: string; rentCents?: number; bedrooms?: number },
): Promise<{
  orgId: string;
  listingId: string;
  unitId: string;
  submarketId: string;
  ownerPartyId: string;
}> {
  const org = await createOrg(client, {
    kind: 'landlord',
    legalName: `Phase5 Landlord ${randomUUID().slice(0, 8)}`,
    displayName: 'Phase5 LL',
  });
  const owner = await createPartyWithIdentity(client, kms, {
    identity: {
      email: `owner-${randomUUID().slice(0, 8)}@example.com`,
      givenName: 'Owner',
      familyName: 'Phase5',
    },
  });
  const sm = await seedSubmarket(client, `SM-${randomUUID().slice(0, 6)}`);
  const externalId = `p5-${randomUUID().slice(0, 8)}`;
  await ingestManualListing(client, {
    orgId: org.id,
    externalId,
    addressRaw: `${Math.floor(Math.random() * 9000) + 100} Phase5 Ave Apt ${Math.floor(Math.random() * 20) + 1}`,
    rentAmountCents: opts?.rentCents ?? 180000,
    bedrooms: opts?.bedrooms ?? 2,
    bathrooms: 1,
  });
  const { rows: listing } = await client.query<{ id: string; unit_id: string }>(
    `select l.id, l.unit_id from listing l
     join source_listing sl on sl.id = l.primary_source_listing_id
     where sl.external_id = $1`,
    [externalId],
  );
  if (!listing[0]) throw new Error('seedPhase5Listing: listing not found');
  await attachListingSubmarket(client, listing[0].id, sm.id);
  if (opts?.status && opts.status !== 'active') {
    await client.query(`update listing set status = $2 where id = $1`, [
      listing[0].id,
      opts.status,
    ]);
  }
  return {
    orgId: org.id,
    listingId: listing[0].id,
    unitId: listing[0].unit_id,
    submarketId: sm.id,
    ownerPartyId: owner.partyId,
  };
}
