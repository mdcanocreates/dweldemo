import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../src/db/pool.js';
import type { LocalKmsProvider } from '../../src/infra/crypto/kms.js';
import { createPartyWithIdentity } from '../../src/modules/identity/index.js';
import type { FeatureObservation } from '../../src/modules/scoring/index.js';

export async function seedScoringParty(
  client: DbClient,
  kms: LocalKmsProvider,
): Promise<{ partyId: string }> {
  const party = await createPartyWithIdentity(client, kms, {
    kind: 'person',
    identity: {
      givenName: 'Score',
      familyName: 'Fixture',
      email: `score-${randomUUID().slice(0, 8)}@example.test`,
    },
  });
  return { partyId: party.partyId };
}

export function sampleObservations(at: Date): FeatureObservation[] {
  return [
    { name: 'application_count', value: 3, written_at: at },
    { name: 'interest_received_count', value: 2, written_at: at },
    { name: 'approval_count', value: 2, written_at: at },
    { name: 'decline_count', value: 1, written_at: at },
    { name: 'placement_count', value: 1, written_at: at },
    { name: 'fraud_flag_count', value: 0, written_at: at },
    { name: 'paid_upfront_screening_count', value: 1, written_at: at },
    { name: 'income_band', value: 3, written_at: at },
    { name: 'household_size', value: 2, written_at: at },
  ];
}
