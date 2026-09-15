/**
 * Idempotent DEV/staging seed for portal + admin E2E accounts (phase4 F-7).
 *
 * Schema remaps (report in F-7 evidence):
 *   prompt "landlord_admin"  → party_role.role = 'landlord'
 *   prompt "rbit_super"      → party_role.role = 'rbit_super_admin' (org_id NULL)
 *   prompt org "type"        → org.kind ('landlord' | 'brokerage')
 *   prompt org "name"        → org.display_name / legal_name
 *   party has no email column → lookup via external_identity_ref (vendor=email)
 *     using platformEmailHmac (same as magic-link auth)
 *
 * Usage (ECS or local with DB + KMS):
 *   npx tsx scripts/seed-test-accounts.ts
 */
import pg from 'pg';

import { resolveDatabaseUrl } from '../src/db/database-url.js';
import { loadRdsSslConfig } from '../src/db/rds-ssl.js';
import { initializeAwsRuntime, shouldUseAwsInfra } from '../src/infra/runtime.js';
import { getKmsProvider } from '../src/infra/crypto/kms.js';
import { createOrg, createPartyWithIdentity, grantRole } from '../src/modules/identity/index.js';
import { platformEmailHmac } from '../src/modules/auth/passwordless.js';

const { Client } = pg;

const INFO_EMAIL = 'info@rbitfinancial.com';
const SUPER_EMAIL = 'michaeldcnao@gmail.com';

const LANDLORD_ORG_LEGAL = 'RBIT Financial';
const BROKER_ORG_LEGAL = 'RBIT Financial Brokerage';

/** Prompt alias → schema role */
const ROLE_LANDLORD_ADMIN = 'landlord';
const ROLE_BROKER_ADMIN = 'broker_admin';
const ROLE_RBIT_SUPER = 'rbit_super_admin';

function resolveSsl(): pg.ClientConfig['ssl'] | undefined {
  const caPath = process.env.RDS_CA_BUNDLE_PATH ?? '/certs/rds-global-bundle.pem';
  try {
    return loadRdsSslConfig(caPath);
  } catch {
    return undefined;
  }
}

async function findPartyIdByEmail(
  client: pg.Client,
  email: string,
): Promise<string | null> {
  const hmacHex = platformEmailHmac(email).toString('hex');
  const { rows } = await client.query<{ party_id: string }>(
    `select party_id from external_identity_ref
     where vendor = 'email' and vendor_subject_id = $1`,
    [hmacHex],
  );
  return rows[0]?.party_id ?? null;
}

async function ensureParty(
  client: pg.Client,
  email: string,
): Promise<{ partyId: string; created: boolean }> {
  const existing = await findPartyIdByEmail(client, email);
  if (existing) return { partyId: existing, created: false };

  const kms = getKmsProvider();
  const created = await createPartyWithIdentity(client, kms, {
    identity: { email },
  });
  const hmacHex = platformEmailHmac(email).toString('hex');
  await client.query(
    `insert into external_identity_ref (party_id, vendor, vendor_subject_id)
     values ($1, 'email', $2)
     on conflict (vendor, vendor_subject_id) do nothing`,
    [created.partyId, hmacHex],
  );
  return { partyId: created.partyId, created: true };
}

async function ensureOrg(
  client: pg.Client,
  input: {
    kind: 'landlord' | 'brokerage';
    legalName: string;
    displayName: string;
  },
): Promise<{ orgId: string; created: boolean }> {
  const { rows } = await client.query<{ id: string }>(
    `select id from org
     where kind = $1 and legal_name = $2
     order by created_at asc
     limit 1`,
    [input.kind, input.legalName],
  );
  if (rows[0]) return { orgId: rows[0].id, created: false };

  const created = await createOrg(client, {
    kind: input.kind,
    legalName: input.legalName,
    displayName: input.displayName,
    claimStatus: 'claimed',
  });
  return { orgId: created.id, created: true };
}

async function ensureRole(
  client: pg.Client,
  input: { partyId: string; orgId: string | null; role: string },
): Promise<{ granted: boolean }> {
  const { rows } = await client.query<{ id: string }>(
    `select id from party_role
     where party_id = $1
       and role = $2
       and revoked_at is null
       and coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     limit 1`,
    [input.partyId, input.role, input.orgId],
  );
  if (rows[0]) return { granted: false };

  await grantRole(client, {
    partyId: input.partyId,
    orgId: input.orgId,
    role: input.role,
  });
  return { granted: true };
}

export type SeedTestAccountsResult = {
  accounts: Array<{
    email: string;
    partyId: string;
    roles: Array<{ role: string; orgName: string | null; orgKind: string | null }>;
  }>;
  notes: string[];
};

export async function seedTestAccounts(
  connectionString: string,
): Promise<SeedTestAccountsResult> {
  const notes = [
    `Mapped landlord_admin → '${ROLE_LANDLORD_ADMIN}' (CHECK constraint on party_role.role)`,
    `Mapped rbit_super → '${ROLE_RBIT_SUPER}' with org_id NULL (platform role pattern)`,
    `Org type column is org.kind; broker org kind is 'brokerage'`,
  ];

  if (shouldUseAwsInfra(process.env.NODE_ENV)) {
    const kmsKeyId = process.env.KMS_KEY_ID;
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-2';
    const bucket = process.env.S3_BUCKET ?? process.env.OBJECT_STORE_BUCKET;
    if (kmsKeyId && bucket) {
      await initializeAwsRuntime({
        awsRegion: region,
        kmsKeyId,
        s3Bucket: bucket,
      });
    }
  }

  const client = new Client({ connectionString, ssl: resolveSsl() });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);

    const info = await ensureParty(client, INFO_EMAIL);
    const landlordOrg = await ensureOrg(client, {
      kind: 'landlord',
      legalName: LANDLORD_ORG_LEGAL,
      displayName: LANDLORD_ORG_LEGAL,
    });
    const brokerOrg = await ensureOrg(client, {
      kind: 'brokerage',
      legalName: BROKER_ORG_LEGAL,
      displayName: BROKER_ORG_LEGAL,
    });
    await ensureRole(client, {
      partyId: info.partyId,
      orgId: landlordOrg.orgId,
      role: ROLE_LANDLORD_ADMIN,
    });
    await ensureRole(client, {
      partyId: info.partyId,
      orgId: brokerOrg.orgId,
      role: ROLE_BROKER_ADMIN,
    });

    const superParty = await ensureParty(client, SUPER_EMAIL);
    await ensureRole(client, {
      partyId: superParty.partyId,
      orgId: null,
      role: ROLE_RBIT_SUPER,
    });

    const hmacInfo = platformEmailHmac(INFO_EMAIL).toString('hex');
    const hmacSuper = platformEmailHmac(SUPER_EMAIL).toString('hex');
    const { rows } = await client.query<{
      email_hmac: string;
      role: string;
      org_name: string | null;
      org_kind: string | null;
      party_id: string;
    }>(
      `select e.vendor_subject_id as email_hmac,
              pr.role,
              o.display_name as org_name,
              o.kind as org_kind,
              pr.party_id
       from party_role pr
       join external_identity_ref e
         on e.party_id = pr.party_id and e.vendor = 'email'
       left join org o on o.id = pr.org_id
       where e.vendor_subject_id = any($1::text[])
         and pr.revoked_at is null
       order by e.vendor_subject_id, pr.role`,
      [[hmacInfo, hmacSuper]],
    );

    await client.query(`select set_config('rbit.bypass_rls', 'off', true)`);
    await client.query('commit');

    const byEmail = new Map<string, SeedTestAccountsResult['accounts'][0]>();
    const emailForHmac = (h: string) =>
      h === hmacInfo ? INFO_EMAIL : h === hmacSuper ? SUPER_EMAIL : h;

    for (const row of rows) {
      const email = emailForHmac(row.email_hmac);
      let entry = byEmail.get(email);
      if (!entry) {
        entry = { email, partyId: row.party_id, roles: [] };
        byEmail.set(email, entry);
      }
      entry.roles.push({
        role: row.role,
        orgName: row.org_name,
        orgKind: row.org_kind,
      });
    }

    notes.push(
      `info party ${info.created ? 'created' : 'existed'}: ${info.partyId}`,
      `super party ${superParty.created ? 'created' : 'existed'}: ${superParty.partyId}`,
      `landlord org ${landlordOrg.created ? 'created' : 'existed'}: ${landlordOrg.orgId}`,
      `broker org ${brokerOrg.created ? 'created' : 'existed'}: ${brokerOrg.orgId}`,
    );

    return { accounts: [...byEmail.values()], notes };
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

/** Evidence helper — adapted F-7 query (no party.email / org.name / org.type columns). */
export function evidenceQuerySql(): string {
  return `
SELECT
  CASE e.vendor_subject_id
    WHEN encode(hmac(lower(normalize('info@rbitfinancial.com', NFC)), ...)) THEN 'info@...'
    ELSE e.vendor_subject_id
  END AS email_ref,
  party_role.role,
  org.display_name AS org_name,
  org.kind AS org_type
FROM party_role
JOIN external_identity_ref e ON e.party_id = party_role.party_id AND e.vendor = 'email'
LEFT JOIN org ON org.id = party_role.org_id
WHERE party_role.revoked_at IS NULL
  AND e.vendor_subject_id IN (<platformEmailHmac hex for seeded emails>);
`.trim();
}

async function main(): Promise<void> {
  const result = await seedTestAccounts(resolveDatabaseUrl());
  console.log(
    JSON.stringify(
      { ok: true, ...result, evidence_query_note: evidenceQuerySql() },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
