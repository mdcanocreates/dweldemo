import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../src/db/pool.js';
import type { KmsProvider } from '../../src/infra/crypto/kms.js';
import { seedListingPartyApp } from './phase2.js';

export async function seedWithApplication(
  client: DbClient,
  kms: KmsProvider,
  opts?: { email?: string },
): Promise<{
  orgId: string;
  partyId: string;
  renterProfileId: string;
  listingId: string;
  unitId: string;
  applicationId: string;
}> {
  const seed = await seedListingPartyApp(client, kms, { email: opts?.email });
  const applicationId = randomUUID();
  await client.query(
    `insert into application (
       id, party_id, renter_profile_id, listing_id, unit_id, org_id,
       entry_point, status, submitted_at
     ) values ($1,$2,$3,$4,$5,$6,'renter_initiated','screened', now())`,
    [
      applicationId,
      seed.partyId,
      seed.renterProfileId,
      seed.listingId,
      seed.unitId,
      seed.orgId,
    ],
  );
  return { ...seed, applicationId };
}
