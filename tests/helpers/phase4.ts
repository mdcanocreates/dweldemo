import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../src/db/pool.js';
import {
  createOrg,
  createPartyWithIdentity,
  grantRole,
} from '../../src/modules/identity/index.js';
import {
  createPartnerSource,
  ensureManualSource,
  putCredential,
  type AdapterKind,
} from '../../src/modules/ingestion/index.js';
import type { LocalKmsProvider } from '../../src/infra/crypto/kms.js';
import { PRECEDENCE } from '../../src/modules/ingestion/index.js';

export async function seedPhase4Org(
  client: DbClient,
  name = 'Phase4 LLC',
): Promise<{ orgId: string }> {
  const org = await createOrg(client, {
    kind: 'landlord',
    legalName: name,
    displayName: name,
  });
  return { orgId: org.id };
}

export async function seedFixtureSource(
  client: DbClient,
  input: {
    orgId: string;
    adapterKind: AdapterKind;
    fixturePath: string;
    precedence?: number;
    name?: string;
    credentialPrimary?: string;
  },
): Promise<{ sourceId: string; credentialRef: string | null }> {
  return createPartnerSource(client, {
    orgId: input.orgId,
    name: input.name ?? `${input.adapterKind}-source`,
    adapterKind: input.adapterKind,
    precedence: input.precedence,
    config: { fixturePath: input.fixturePath },
    credential: input.credentialPrimary
      ? { primary: input.credentialPrimary, kind: 'hmac_secret' }
      : undefined,
  });
}

/** TEST_ONLY display rule — D-11 partner content must not ship as prod defaults. */
export async function seedTestOnlyDisplayRule(
  client: DbClient,
  input?: {
    showExactAddress?: boolean;
    suppressFields?: string[];
    mediaPolicy?: 'host' | 'hotlink' | 'none';
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  await client.query(
    `insert into source_display_rule (
       id, name, version, is_attribution_required, attribution_text,
       suppress_fields, show_exact_address, media_policy
     ) values ($1,'TEST_ONLY_suppress','1.0.0', true, 'TEST_ONLY attribution',
       $2::text[], $3, $4)`,
    [
      id,
      input?.suppressFields ?? ['description', 'deposit_cents'],
      input?.showExactAddress ?? false,
      input?.mediaPolicy ?? 'none',
    ],
  );
  return { id };
}

export async function seedDualAdmins(
  client: DbClient,
  kms: LocalKmsProvider,
): Promise<{ requesterId: string; approverId: string }> {
  const a = await createPartyWithIdentity(client, kms, {
    identity: { email: `req-${randomUUID()}@example.test`, givenName: 'Req' },
  });
  const b = await createPartyWithIdentity(client, kms, {
    identity: { email: `apr-${randomUUID()}@example.test`, givenName: 'Apr' },
  });
  await grantRole(client, { partyId: a.partyId, role: 'rbit_admin', orgId: null });
  await grantRole(client, { partyId: b.partyId, role: 'rbit_admin', orgId: null });
  return { requesterId: a.partyId, approverId: b.partyId };
}

export { ensureManualSource, putCredential, PRECEDENCE };
