import type { DbClient } from '../../db/pool.js';

export type ReusableScreening = {
  reusable: boolean;
  report_id: string | null;
  expires_at: string | null;
  prior_application_id: string | null;
  reason: 'valid_report' | 'prior_paid_screening' | 'none';
  fee_cents_if_required: number;
};

/**
 * Determine whether this renter already has an eligible screening that can be
 * reused for a new application without charging another fee.
 *
 * Consent is still required per application/provider — reuse only skips payment.
 */
export async function findReusableScreening(
  client: DbClient,
  input: {
    partyId: string;
    applicationId: string;
    feeCentsIfNew: number;
  },
): Promise<ReusableScreening> {
  const { rows: reports } = await client.query<{
    id: string;
    expires_at: Date | null;
  }>(
    `select id, expires_at
     from screening_report
     where party_id = $1
       and status = 'complete'
       and (expires_at is null or expires_at > now())
     order by coalesce(issued_at, expires_at) desc nulls last
     limit 1`,
    [input.partyId],
  );
  if (reports[0]) {
    return {
      reusable: true,
      report_id: reports[0].id,
      expires_at: reports[0].expires_at?.toISOString() ?? null,
      prior_application_id: null,
      reason: 'valid_report',
      fee_cents_if_required: 0,
    };
  }

  // Fallback: prior paid screening on another application (sandbox often has no report row yet).
  const { rows: prior } = await client.query<{ id: string }>(
    `select a.id
     from application a
     where a.party_id = $1
       and a.id <> $2
       and a.status in (
         'screening_authorized',
         'screening_running',
         'screening_in_progress',
         'screened',
         'screening_complete',
         'approved',
         'declined'
       )
     order by a.created_at desc
     limit 1`,
    [input.partyId, input.applicationId],
  );
  if (prior[0]) {
    return {
      reusable: true,
      report_id: null,
      expires_at: null,
      prior_application_id: prior[0].id,
      reason: 'prior_paid_screening',
      fee_cents_if_required: 0,
    };
  }

  return {
    reusable: false,
    report_id: null,
    expires_at: null,
    prior_application_id: null,
    reason: 'none',
    fee_cents_if_required: input.feeCentsIfNew,
  };
}
