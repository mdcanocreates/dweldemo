import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { appendAdminAction, emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import { resolveReportPortabilityDays } from './config.js';

export type GrantResult =
  | { granted: true; accessId: string; repull: false }
  | { granted: true; accessId: string; repull: true; newReportId: string }
  | { granted: false; reason: string };

/**
 * Portability: one report, many org grants within expires_at (D-02 window from config).
 * Post-expiry grant triggers re-pull signal.
 */
export async function grantReportAccess(
  client: DbClient,
  input: {
    reportId: string;
    grantedToOrgId: string;
    actorPartyId: string;
    applicationId?: string | null;
    clock?: Clock;
    /** Callback to perform vendor re-pull when expired — provided by pipeline. */
    repullFn?: (reportId: string) => Promise<string>;
  },
): Promise<GrantResult> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();

  const { rows } = await client.query<{
    id: string;
    expires_at: Date | null;
    status: string;
    party_id: string;
  }>(`select id, expires_at, status, party_id from screening_report where id = $1`, [
    input.reportId,
  ]);
  const report = rows[0];
  if (!report) throw new AppError('report not found', 'report_not_found', 404);

  const expired =
    report.status === 'expired' ||
    (report.expires_at != null && report.expires_at.getTime() <= now.getTime());

  if (expired) {
    if (!input.repullFn) {
      return { granted: false, reason: 'report_expired_repull_required' };
    }
    const newReportId = await input.repullFn(input.reportId);
    const accessId = await insertGrant(client, {
      reportId: newReportId,
      orgId: input.grantedToOrgId,
      applicationId: input.applicationId,
      now,
      actorPartyId: input.actorPartyId,
    });
    return { granted: true, accessId, repull: true, newReportId };
  }

  const accessId = await insertGrant(client, {
    reportId: input.reportId,
    orgId: input.grantedToOrgId,
    applicationId: input.applicationId,
    now,
    actorPartyId: input.actorPartyId,
  });
  return { granted: true, accessId, repull: false };
}

async function insertGrant(
  client: DbClient,
  input: {
    reportId: string;
    orgId: string;
    applicationId?: string | null;
    now: Date;
    actorPartyId: string;
  },
): Promise<string> {
  const accessId = randomUUID();
  await client.query(
    `insert into screening_report_access (
       id, report_id, granted_to_org_id, application_id, granted_at
     ) values ($1,$2,$3,$4,$5)`,
    [accessId, input.reportId, input.orgId, input.applicationId ?? null, input.now],
  );
  await emitDomainEvent(client, {
    aggregateType: 'screening_report',
    aggregateId: input.reportId,
    eventType: 'screening_report.access_granted',
    payload: {
      access_id: accessId,
      granted_to_org_id: input.orgId,
      application_id: input.applicationId ?? null,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
    occurredAt: input.now,
  });
  await appendAdminAction(client, {
    actorPartyId: input.actorPartyId,
    action: 'screening_report.access_granted',
    targetType: 'screening_report',
    targetId: input.reportId,
    afterState: { access_id: accessId, org_id: input.orgId },
  });
  return accessId;
}

export async function setReportExpiryFromConfig(
  client: DbClient,
  reportId: string,
  issuedAt: Date,
  clock: Clock = systemClock,
): Promise<Date> {
  const days = await resolveReportPortabilityDays(client, clock);
  const expiresAt = new Date(issuedAt.getTime() + days * 86400000);
  await client.query(`update screening_report set expires_at = $2 where id = $1`, [
    reportId,
    expiresAt,
  ]);
  return expiresAt;
}

export async function recordReportView(
  client: DbClient,
  accessId: string,
  actorPartyId: string,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  const { rows } = await client.query<{
    id: string;
    report_id: string;
    first_viewed_at: Date | null;
    view_count: number;
  }>(`select id, report_id, first_viewed_at, view_count from screening_report_access where id = $1`, [
    accessId,
  ]);
  if (!rows[0]) throw new AppError('access not found', 'access_not_found', 404);
  await client.query(
    `update screening_report_access
     set view_count = view_count + 1,
         first_viewed_at = coalesce(first_viewed_at, $2)
     where id = $1`,
    [accessId, now],
  );
  await appendAdminAction(client, {
    actorPartyId,
    action: 'screening_report.viewed',
    targetType: 'screening_report',
    targetId: rows[0].report_id,
    afterState: { access_id: accessId },
  });
}
