import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import { DEMO_TERMS_VERSION, isDemoModeEnabled } from '../demo/index.js';

export { DEMO_TERMS_VERSION };

export type BrokerTermsAcceptance = {
  id: string;
  party_id: string;
  terms_version: string;
  accepted_at: string;
  compensation_cap_ack: boolean;
  non_circumvention_ack: boolean;
  licensing_ack: boolean;
  platform_role_ack: boolean;
};

export async function getBrokerTermsAcceptance(
  client: DbClient,
  partyId: string,
  termsVersion: string = DEMO_TERMS_VERSION,
): Promise<BrokerTermsAcceptance | null> {
  const { rows } = await client.query<{
    id: string;
    party_id: string;
    terms_version: string;
    accepted_at: Date;
    compensation_cap_ack: boolean;
    non_circumvention_ack: boolean;
    licensing_ack: boolean;
    platform_role_ack: boolean;
  }>(
    `select id, party_id, terms_version, accepted_at,
            compensation_cap_ack, non_circumvention_ack, licensing_ack, platform_role_ack
     from broker_terms_acceptance
     where party_id = $1 and terms_version = $2
     limit 1`,
    [partyId, termsVersion],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    party_id: row.party_id,
    terms_version: row.terms_version,
    accepted_at: row.accepted_at.toISOString(),
    compensation_cap_ack: row.compensation_cap_ack,
    non_circumvention_ack: row.non_circumvention_ack,
    licensing_ack: row.licensing_ack,
    platform_role_ack: row.platform_role_ack,
  };
}

export async function recordBrokerTermsAcceptance(
  client: DbClient,
  input: {
    partyId: string;
    termsVersion?: string;
    ipAddress: string | null;
    userAgent: string | null;
    compensationCapAck: boolean;
    nonCircumventionAck: boolean;
    licensingAck: boolean;
    platformRoleAck: boolean;
    /** Public anonymous demo must never create a production acceptance row. */
    allowProductionRecord?: boolean;
  },
): Promise<BrokerTermsAcceptance> {
  if (
    !input.compensationCapAck ||
    !input.nonCircumventionAck ||
    !input.licensingAck ||
    !input.platformRoleAck
  ) {
    throw new AppError('all acknowledgments required', 'broker_terms_incomplete', 400);
  }

  if (input.allowProductionRecord === false) {
    throw new AppError(
      'anonymous demo cannot create production broker terms records',
      'broker_terms_demo_only',
      403,
    );
  }

  const version = input.termsVersion ?? DEMO_TERMS_VERSION;
  const { rows } = await client.query<{
    id: string;
    party_id: string;
    terms_version: string;
    accepted_at: Date;
    compensation_cap_ack: boolean;
    non_circumvention_ack: boolean;
    licensing_ack: boolean;
    platform_role_ack: boolean;
  }>(
    `insert into broker_terms_acceptance (
       party_id, terms_version, ip_address, user_agent,
       compensation_cap_ack, non_circumvention_ack, licensing_ack, platform_role_ack
     ) values ($1,$2,$3::inet,$4,true,true,true,true)
     on conflict (party_id, terms_version) do update set
       accepted_at = now(),
       ip_address = excluded.ip_address,
       user_agent = excluded.user_agent,
       compensation_cap_ack = true,
       non_circumvention_ack = true,
       licensing_ack = true,
       platform_role_ack = true
     returning id, party_id, terms_version, accepted_at,
               compensation_cap_ack, non_circumvention_ack, licensing_ack, platform_role_ack`,
    [input.partyId, version, input.ipAddress, input.userAgent],
  );
  const row = rows[0]!;
  void isDemoModeEnabled; // documented gate for callers
  return {
    id: row.id,
    party_id: row.party_id,
    terms_version: row.terms_version,
    accepted_at: row.accepted_at.toISOString(),
    compensation_cap_ack: row.compensation_cap_ack,
    non_circumvention_ack: row.non_circumvention_ack,
    licensing_ack: row.licensing_ack,
    platform_role_ack: row.platform_role_ack,
  };
}
