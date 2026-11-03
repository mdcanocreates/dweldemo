import { createHash, randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';

export type InterestAction = 'request_information' | 'ask_availability' | 'schedule_tour';

export type CreateInterestInput = {
  partyId: string;
  listingId: string;
  requestedAction: InterestAction;
  consentVersion: string;
  contactShareScope: string[];
  idempotencyKey: string;
};

/**
 * Heart/save must never call this. Interest is an explicit consented lead only.
 * Outbound mail uses mock transport unless separately authorized.
 */
export async function createRenterInterest(
  client: DbClient,
  input: CreateInterestInput,
): Promise<{ interest_id: string; state: string; notification: { status: string; transport: string } }> {
  if (!input.consentVersion.trim()) {
    throw new AppError('consent version required', 'consent_required', 400);
  }
  if (input.contactShareScope.length === 0) {
    throw new AppError('contact share scope required', 'consent_required', 400);
  }

  const { rows: listing } = await client.query<{
    id: string;
    org_id: string;
    status: string;
    is_demo: boolean;
  }>(
    `select id, org_id, status, coalesce(is_demo, false) as is_demo
     from listing where id = $1`,
    [input.listingId],
  );
  if (!listing[0] || listing[0].status !== 'active' || listing[0].is_demo) {
    throw new AppError('listing not found', 'listing_not_found', 404);
  }

  const interestId = `ri_${randomUUID().replace(/-/g, '')}`;
  const { rows } = await client.query<{ interest_id: string; state: string; id: string }>(
    `insert into renter_interest (
       interest_id, party_id, listing_id, org_id, requested_action,
       consent_version, contact_share_scope, state, idempotency_key
     ) values ($1,$2,$3,$4,$5,$6,$7,'delivery_pending',$8)
     on conflict (party_id, listing_id, requested_action, idempotency_key)
     do update set updated_at = now()
     returning interest_id, state, id`,
    [
      interestId,
      input.partyId,
      input.listingId,
      listing[0].org_id,
      input.requestedAction,
      input.consentVersion,
      input.contactShareScope,
      input.idempotencyKey,
    ],
  );

  const row = rows[0]!;
  const dedupeKey = createHash('sha256')
    .update(`${row.id}:${input.requestedAction}:${listing[0].org_id}`)
    .digest('hex');

  const suppressed = await client.query<{ id: string }>(
    `select id from notification_suppression_contact
     where address_fingerprint = $1`,
    [`org:${listing[0].org_id}`],
  );

  const transport = process.env.DWEL_INTEREST_EMAIL_TRANSPORT === 'live' ? 'live' : 'mock';
  if (transport === 'live') {
    throw new AppError(
      'live leasing-office email is not authorized in this environment',
      'live_email_blocked',
      403,
    );
  }

  const deliveryStatus = suppressed.rows[0] ? 'suppressed' : 'sent_mock';
  await client.query(
    `insert into interest_notification_outbox (
       interest_id, recipient_fingerprint, template_key, transport,
       delivery_status, dedupe_key, attempt_count, sent_at
     ) values ($1,$2,'provider_interest_teaser',$3,$4,$5,1, case when $4 = 'sent_mock' then now() else null end)
     on conflict (dedupe_key) do nothing`,
    [row.id, `org:${listing[0].org_id}`, transport, deliveryStatus, dedupeKey],
  );

  await client.query(
    `update renter_interest
     set state = $2, updated_at = now()
     where id = $1`,
    [row.id, deliveryStatus === 'suppressed' ? 'failed' : 'notified'],
  );

  return {
    interest_id: row.interest_id,
    state: deliveryStatus === 'suppressed' ? 'failed' : 'notified',
    notification: { status: deliveryStatus, transport },
  };
}
