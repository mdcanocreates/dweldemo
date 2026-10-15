import type { DbClient } from '../../db/pool.js';

export type InboxNotification = {
  id: string;
  event_type: string;
  template_key: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
  read_at: string | null;
  deep_link: string | null;
};

function deepLinkFromPayload(
  eventType: string,
  payload: Record<string, unknown>,
): string | null {
  const applicationId =
    typeof payload.application_id === 'string' ? payload.application_id : null;
  const listingId = typeof payload.listing_id === 'string' ? payload.listing_id : null;
  if (applicationId && eventType.startsWith('applicant_')) {
    return `/landlord/applicants/${applicationId}`;
  }
  if (applicationId) {
    return `/applications/${applicationId}`;
  }
  if (listingId) return `/listing/${listingId}`;
  return null;
}

export async function listInboxNotifications(
  client: DbClient,
  input: { partyId: string; limit?: number },
): Promise<InboxNotification[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const { rows } = await client.query<{
    id: string;
    event_type: string;
    template_key: string;
    payload: Record<string, unknown>;
    status: string;
    created_at: Date;
    read_at: Date | null;
  }>(
    `select id, event_type, template_key, payload, status, created_at, read_at
     from notification
     where recipient_party_id = $1
       and channel = 'in_platform'
     order by created_at desc
     limit $2`,
    [input.partyId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    event_type: r.event_type,
    template_key: r.template_key,
    payload: r.payload ?? {},
    status: r.status,
    created_at: r.created_at.toISOString(),
    read_at: r.read_at?.toISOString() ?? null,
    deep_link: deepLinkFromPayload(r.event_type, r.payload ?? {}),
  }));
}

export async function markNotificationRead(
  client: DbClient,
  input: { partyId: string; notificationId: string },
): Promise<{ id: string; read_at: string }> {
  const { rows } = await client.query<{ id: string; read_at: Date }>(
    `update notification
     set status = case when status = 'queued' then 'sent' else status end,
         read_at = coalesce(read_at, now())
     where id = $1 and recipient_party_id = $2
     returning id, read_at`,
    [input.notificationId, input.partyId],
  );
  if (!rows[0]) {
    const { AppError } = await import('../shared/errors.js');
    throw new AppError('notification not found', 'notification_not_found', 404);
  }
  return { id: rows[0].id, read_at: rows[0].read_at.toISOString() };
}
