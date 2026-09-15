import { randomBytes, randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { FieldEncryptor, mintDek, openDek } from '../../infra/crypto/dek.js';
import type { KmsProvider } from '../../infra/crypto/kms.js';
import { emitDomainEvent } from '../audit/index.js';

export type IdentityFields = {
  givenName?: string;
  familyName?: string;
  dob?: string;
  phone?: string;
  email?: string;
  identityFingerprint?: string;
};

export async function createOrg(
  client: DbClient,
  input: {
    kind: 'rbit' | 'landlord' | 'brokerage' | 'property_mgmt' | 'solar_partner';
    legalName: string;
    displayName: string;
    claimStatus?: 'unclaimed' | 'pending' | 'claimed';
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  await client.query(
    `insert into org (id, kind, legal_name, display_name, claim_status)
     values ($1,$2,$3,$4,$5)`,
    [id, input.kind, input.legalName, input.displayName, input.claimStatus ?? 'claimed'],
  );
  await emitDomainEvent(client, {
    aggregateType: 'org',
    aggregateId: id,
    eventType: 'org.created',
    payload: { kind: input.kind, claim_status: input.claimStatus ?? 'claimed' },
    actorKind: 'system',
  });
  return { id };
}

export async function createPartyWithIdentity(
  client: DbClient,
  kms: KmsProvider,
  input: {
    kind?: 'person' | 'organization';
    identity: IdentityFields;
    actorPartyId?: string;
  },
): Promise<{ partyId: string; dekId: string }> {
  const partyId = randomUUID();
  const { plaintextDek, hmacKey, wrappedKey, kmsKeyId } = await mintDek(kms);
  const encryptor = new FieldEncryptor(plaintextDek, hmacKey);

  await client.query(
    `insert into party (id, kind) values ($1, $2)`,
    [partyId, input.kind ?? 'person'],
  );

  const dekId = randomUUID();
  await client.query(
    `insert into data_encryption_key (id, party_id, wrapped_key, kms_key_id)
     values ($1, $2, $3, $4)`,
    [dekId, partyId, wrappedKey, kmsKeyId],
  );

  const email = input.identity.email;
  await client.query(
    `insert into party_identity (
       party_id, dek_id, given_name_enc, family_name_enc, dob_enc,
       phone_enc, email_enc, email_hmac, phone_hmac, identity_fingerprint
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      partyId,
      dekId,
      encryptor.encrypt(input.identity.givenName),
      encryptor.encrypt(input.identity.familyName),
      encryptor.encrypt(input.identity.dob),
      encryptor.encrypt(input.identity.phone),
      encryptor.encrypt(email),
      email ? encryptor.hmac(email) : null,
      input.identity.phone ? encryptor.hmac(input.identity.phone) : null,
      input.identity.identityFingerprint ?? null,
    ],
  );

  await client.query(
    `insert into party_features (party_id, first_seen_at) values ($1, now())`,
    [partyId],
  );

  await emitDomainEvent(client, {
    aggregateType: 'party',
    aggregateId: partyId,
    eventType: 'party.created',
    payload: { kind: input.kind ?? 'person', dek_id: dekId },
    actorPartyId: input.actorPartyId ?? null,
    actorKind: 'system',
  });

  await emitDomainEvent(client, {
    aggregateType: 'party',
    aggregateId: partyId,
    eventType: 'party.identity_written',
    payload: { dek_id: dekId, has_email: Boolean(email) },
    actorPartyId: input.actorPartyId ?? null,
    actorKind: 'system',
  });

  return { partyId, dekId };
}

export async function readPartyIdentity(
  client: DbClient,
  kms: KmsProvider,
  partyId: string,
): Promise<IdentityFields> {
  const { rows } = await client.query<{
    wrapped_key: Buffer;
    destroyed_at: Date | null;
    given_name_enc: Buffer | null;
    family_name_enc: Buffer | null;
    dob_enc: Buffer | null;
    phone_enc: Buffer | null;
    email_enc: Buffer | null;
    identity_fingerprint: string | null;
  }>(
    `select d.wrapped_key, d.destroyed_at,
            i.given_name_enc, i.family_name_enc, i.dob_enc,
            i.phone_enc, i.email_enc, i.identity_fingerprint
     from party_identity i
     join data_encryption_key d on d.id = i.dek_id
     where i.party_id = $1`,
    [partyId],
  );
  const row = rows[0];
  if (!row) throw new Error('party_identity not found');
  if (row.destroyed_at) {
    throw new Error('DEK destroyed — identity unreadable (crypto-shredded)');
  }

  let encryptor: FieldEncryptor;
  try {
    encryptor = await openDek(kms, row.wrapped_key);
  } catch (err) {
    throw new Error(`identity unreadable: ${(err as Error).message}`, { cause: err });
  }

  return {
    givenName: encryptor.decrypt(row.given_name_enc) ?? undefined,
    familyName: encryptor.decrypt(row.family_name_enc) ?? undefined,
    dob: encryptor.decrypt(row.dob_enc) ?? undefined,
    phone: encryptor.decrypt(row.phone_enc) ?? undefined,
    email: encryptor.decrypt(row.email_enc) ?? undefined,
    identityFingerprint: row.identity_fingerprint ?? undefined,
  };
}

/**
 * Crypto-shred: destroy the DEK. party row tombstoned; party_features and FKs remain.
 */
export async function cryptoShredParty(
  client: DbClient,
  kms: KmsProvider,
  partyId: string,
  actorPartyId: string,
): Promise<void> {
  const { rows } = await client.query<{ id: string; wrapped_key: Buffer }>(
    `select id, wrapped_key from data_encryption_key
     where party_id = $1 and destroyed_at is null
     for update`,
    [partyId],
  );
  const dek = rows[0];
  if (!dek) throw new Error('no active DEK for party');

  if (kms.destroyKeyMaterial) {
    await kms.destroyKeyMaterial(dek.wrapped_key);
  }

  // Overwrite wrapped_key with random bytes so even master-key holders cannot recover,
  // then mark destroyed.
  await client.query(
    `update data_encryption_key
     set wrapped_key = $2, destroyed_at = now()
     where id = $1`,
    [dek.id, randomBytes(dek.wrapped_key.length)],
  );

  await client.query(
    `update party set purged_at = now() where id = $1`,
    [partyId],
  );

  await emitDomainEvent(client, {
    aggregateType: 'party',
    aggregateId: partyId,
    eventType: 'party.crypto_shredded',
    payload: { dek_id: dek.id },
    actorPartyId,
    actorKind: 'admin',
  });
}

export async function grantRole(
  client: DbClient,
  input: {
    partyId: string;
    orgId?: string | null;
    role: string;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  await client.query(
    `insert into party_role (id, party_id, org_id, role) values ($1,$2,$3,$4)`,
    [id, input.partyId, input.orgId ?? null, input.role],
  );
  await emitDomainEvent(client, {
    aggregateType: 'party_role',
    aggregateId: id,
    eventType: 'party_role.granted',
    payload: {
      party_id: input.partyId,
      org_id: input.orgId ?? null,
      role: input.role,
    },
    actorKind: 'system',
  });
  return { id };
}
