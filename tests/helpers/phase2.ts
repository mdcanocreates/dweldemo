import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../src/db/pool.js';
import { createOrg, createPartyWithIdentity } from '../../src/modules/identity/index.js';
import type { KmsProvider } from '../../src/infra/crypto/kms.js';

/**
 * TEST_ONLY seed for Phase 2 config namespaces.
 * D-02 report_portability_days lives here — not as a production code literal.
 * D-15 risk_insight_auto_adverse_action_enabled = false.
 */
export async function seedPhase2TestConfig(
  client: DbClient,
  opts?: { portabilityDays?: number; proposedByPartyId?: string },
): Promise<{ proposerId: string }> {
  let proposerId = opts?.proposedByPartyId;
  if (!proposerId) {
    const p = await client.query<{ id: string }>(
      `insert into party (id, kind) values ($1, 'person') returning id`,
      [randomUUID()],
    );
    proposerId = p.rows[0]!.id;
  }

  const portabilityDays = opts?.portabilityDays ?? 30; // TEST_ONLY default in seed rows

  await upsertApprovedConfig(client, {
    namespace: 'screening_policy',
    version: 'test-1',
    proposedByPartyId: proposerId,
    payload: {
      // TEST_ONLY — D-02 unresolved; value seeded for acceptance tests only
      report_portability_days: portabilityDays,
      // D-15 — must stay false
      risk_insight_auto_adverse_action_enabled: false,
    },
  });

  await upsertApprovedConfig(client, {
    namespace: 'verification_confidence',
    version: 'test-1',
    proposedByPartyId: proposerId,
    payload: {
      plaid_bank: 0.95,
      plaid_payroll: 0.9,
      vendor_payroll: 0.8,
      document: 0.5,
      stated: 0.2,
    },
  });

  await upsertApprovedConfig(client, {
    namespace: 'fraud_thresholds',
    version: 'test-1',
    proposedByPartyId: proposerId,
    payload: {
      device_window_hours: 24,
      device_max_applications: 5,
      party_window_hours: 24,
      party_max_applications: 10,
      // B-3 device prescreen thresholds
      device_identity_count_30d_threshold: 3,
      device_application_count_24h_threshold: 5,
      party_device_count_7d_threshold: 4,
    },
  });

  await upsertApprovedConfig(client, {
    namespace: 'vendor_adapters',
    version: 'test-1',
    proposedByPartyId: proposerId,
    payload: {
      tenant_screening: 'certn_stub',
      identity_verification: 'stub_identity',
      income_verification: 'stub_income',
      esign: 'stub_esign',
      vault_tokenizer: 'vault_stub',
    },
  });

  await upsertApprovedConfig(client, {
    namespace: 'screening_disclosure',
    version: 'test-1',
    proposedByPartyId: proposerId,
    payload: {
      disclosure_version: 'test-disclosure-v1',
    },
  });

  await upsertApprovedConfig(client, {
    namespace: 'application_access',
    version: 'test-1',
    proposedByPartyId: proposerId,
    payload: {
      token_ttl_ms: 7 * 24 * 60 * 60 * 1000,
    },
  });

  return { proposerId };
}

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
  // effective_from must precede MutableClock dates used in Phase 2 tests (e.g. 2026-06-01).
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

export async function seedListingPartyApp(
  client: DbClient,
  kms: KmsProvider,
  opts?: { email?: string; externalId?: string },
): Promise<{
  orgId: string;
  partyId: string;
  renterProfileId: string;
  listingId: string;
  unitId: string;
  rentCents: number;
}> {
  const { ingestManualListing } = await import('../../src/modules/ingestion/index.js');
  const org = await createOrg(client, {
    kind: 'landlord',
    legalName: `Phase2 ${opts?.externalId ?? randomUUID()} LLC`,
    displayName: 'Phase2',
  });
  const externalId = opts?.externalId ?? `p2-${randomUUID().slice(0, 8)}`;
  await ingestManualListing(client, {
    orgId: org.id,
    externalId,
    addressRaw: `100 Phase2 Ave Unit ${externalId}`,
    rentAmountCents: 200000,
    bedrooms: 2,
  });
  const { rows: listing } = await client.query<{ id: string; unit_id: string; rent_amount_cents: number }>(
    `select l.id, l.unit_id, l.rent_amount_cents from listing l
     join source_listing sl on sl.id = l.primary_source_listing_id
     where sl.external_id = $1`,
    [externalId],
  );
  const party = await createPartyWithIdentity(client, kms, {
    identity: { email: opts?.email ?? `p2-${randomUUID().slice(0, 8)}@example.com` },
  });
  const { rows: rp } = await client.query<{ id: string }>(
    `insert into renter_profile (party_id) values ($1) returning id`,
    [party.partyId],
  );
  return {
    orgId: org.id,
    partyId: party.partyId,
    renterProfileId: rp[0]!.id,
    listingId: listing[0]!.id,
    unitId: listing[0]!.unit_id,
    rentCents: listing[0]!.rent_amount_cents,
  };
}
