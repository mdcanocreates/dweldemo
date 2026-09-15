/**
 * Part J — RBIT internal admin console domain operations.
 * All reads/writes run under system bypass from HTTP layer.
 */

import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { appendAdminAction, emitDomainEvent } from '../audit/index.js';
import { grantRole, isSuperAdmin, partyHasRole } from '../identity/index.js';
import { AppError } from '../shared/errors.js';
import { assessCertnAvailability } from '../vendors/index.js';

export async function assertAdmin(
  client: DbClient,
  partyId: string,
): Promise<{ isSuper: boolean }> {
  const isSuper = await isSuperAdmin(client, partyId);
  const isAdmin = await partyHasRole(client, partyId, 'rbit_admin');
  if (!isSuper && !isAdmin) {
    throw new AppError('admin role required', 'auth_forbidden', 403);
  }
  return { isSuper };
}

export async function assertSuperAdmin(client: DbClient, partyId: string): Promise<void> {
  if (!(await isSuperAdmin(client, partyId))) {
    throw new AppError('rbit_super_admin required', 'auth_forbidden', 403);
  }
}

export async function listAdminUsers(
  client: DbClient,
  input: { q?: string | null; limit?: number; offset?: number },
): Promise<{ items: unknown[]; total: number }> {
  const limit = Math.min(input.limit ?? 50, 100);
  const offset = input.offset ?? 0;
  const params: unknown[] = [];
  let where = 'true';
  if (input.q?.trim()) {
    params.push(`%${input.q.trim().toLowerCase()}%`);
    where = `(p.id::text ilike $1 or exists (
      select 1 from external_identity_ref e
      where e.party_id = p.id and lower(e.vendor_subject_id) like $1
    ))`;
  }
  const { rows: countRows } = await client.query<{ n: string }>(
    `select count(*)::text as n from party p where ${where}`,
    params,
  );
  params.push(limit, offset);
  const { rows } = await client.query(
    `select p.id as party_id, p.kind, p.created_at,
            coalesce(
              (select json_agg(json_build_object(
                 'role', pr.role, 'org_id', pr.org_id, 'status', pr.status
               ))
               from party_role pr
               where pr.party_id = p.id and pr.revoked_at is null),
              '[]'::json
            ) as roles,
            (select e.vendor_subject_id from external_identity_ref e
             where e.party_id = p.id and e.vendor = 'email'
             order by e.first_seen_at desc limit 1) as email_ref
     from party p
     where ${where}
     order by p.created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: rows, total: Number(countRows[0]?.n ?? 0) };
}

export async function listAdminOrgs(
  client: DbClient,
  input: { q?: string | null; limit?: number; offset?: number },
): Promise<{ items: unknown[]; total: number }> {
  const limit = Math.min(input.limit ?? 50, 100);
  const offset = input.offset ?? 0;
  const params: unknown[] = [];
  let where = 'true';
  if (input.q?.trim()) {
    params.push(`%${input.q.trim().toLowerCase()}%`);
    where = `(lower(o.display_name) like $1 or lower(o.legal_name) like $1 or o.id::text ilike $1)`;
  }
  const { rows: countRows } = await client.query<{ n: string }>(
    `select count(*)::text as n from org o where ${where}`,
    params,
  );
  params.push(limit, offset);
  const { rows } = await client.query(
    `select o.id, o.kind, o.display_name, o.legal_name, o.status,
            o.broker_payouts_enabled,
            o.stripe_connect_account_id, o.stripe_connect_status,
            (select lse.status from landlord_self_execution lse
             where lse.org_id = o.id
             order by lse.created_at desc limit 1) as self_execution_status
     from org o
     where ${where}
     order by o.created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: rows, total: Number(countRows[0]?.n ?? 0) };
}

export async function setOrgBrokerPayoutsFlag(
  client: DbClient,
  input: { orgId: string; enabled: boolean; actorPartyId: string },
): Promise<{ org_id: string; broker_payouts_enabled: boolean }> {
  const { rows } = await client.query<{ id: string; broker_payouts_enabled: boolean }>(
    `update org set broker_payouts_enabled = $2 where id = $1
     returning id, broker_payouts_enabled`,
    [input.orgId, input.enabled],
  );
  if (!rows[0]) throw new AppError('org not found', 'org_not_found', 404);
  await emitDomainEvent(client, {
    aggregateType: 'org',
    aggregateId: input.orgId,
    eventType: 'flag_toggled',
    payload: {
      flag: 'broker_payouts_enabled',
      enabled: input.enabled,
      scope: 'org',
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'admin',
  });
  await appendAdminAction(client, {
    actorPartyId: input.actorPartyId,
    action: 'org.broker_payouts_enabled',
    targetType: 'org',
    targetId: input.orgId,
    afterState: { enabled: input.enabled },
  });
  return { org_id: rows[0].id, broker_payouts_enabled: rows[0].broker_payouts_enabled };
}

export async function assignUserRole(
  client: DbClient,
  input: {
    partyId: string;
    role: string;
    orgId?: string | null;
    actorPartyId: string;
  },
): Promise<{ id: string }> {
  const allowed = [
    'renter',
    'landlord',
    'agent',
    'broker',
    'broker_admin',
    'rbit_admin',
    'rbit_support',
    'rbit_super_admin',
  ];
  if (!allowed.includes(input.role)) {
    throw new AppError('invalid role', 'validation_error', 400);
  }
  const granted = await grantRole(client, {
    partyId: input.partyId,
    orgId: input.orgId ?? null,
    role: input.role,
  });
  await emitDomainEvent(client, {
    aggregateType: 'party_role',
    aggregateId: granted.id,
    eventType: 'role_assigned',
    payload: {
      party_id: input.partyId,
      org_id: input.orgId ?? null,
      role: input.role,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'admin',
  });
  return granted;
}

export async function getConsentConfig(client: DbClient): Promise<{
  key: string;
  text: string;
  version: string | null;
  effective_from: string | null;
  change_log: unknown[];
}> {
  const { rows } = await client.query<{
    version: string;
    payload: { fcra_one_time_use?: string };
    effective_from: Date;
    proposed_by_party_id: string | null;
    approved_by_party_id: string | null;
    approved_at: Date | null;
  }>(
    `select version, payload, effective_from, proposed_by_party_id,
            approved_by_party_id, approved_at
     from config_version
     where namespace = 'consent_copy'
       and approved_by_party_id is not null
       and effective_from <= now()
     order by effective_from desc
     limit 20`,
  );
  const current = rows[0];
  return {
    key: 'consent_copy.fcra_one_time_use',
    text: current?.payload?.fcra_one_time_use ?? '',
    version: current?.version ?? null,
    effective_from: current?.effective_from?.toISOString() ?? null,
    change_log: rows.map((r) => ({
      version: r.version,
      text: r.payload?.fcra_one_time_use ?? null,
      effective_from: r.effective_from.toISOString(),
      proposed_by_party_id: r.proposed_by_party_id,
      approved_by_party_id: r.approved_by_party_id,
      approved_at: r.approved_at?.toISOString() ?? null,
    })),
  };
}

export async function updateConsentConfig(
  client: DbClient,
  input: { text: string; actorPartyId: string },
): Promise<{ version: string }> {
  const version = `consent-${Date.now()}`;
  const id = randomUUID();
  const previous = await getConsentConfig(client);
  await client.query(
    `insert into config_version (
       id, namespace, version, payload, effective_from,
       proposed_by_party_id, approved_by_party_id, approved_at
     ) values ($1,'consent_copy',$2,$3::jsonb, now(), $4, $4, now())`,
    [
      id,
      version,
      JSON.stringify({ fcra_one_time_use: input.text }),
      input.actorPartyId,
    ],
  );
  await emitDomainEvent(client, {
    aggregateType: 'config_version',
    aggregateId: id,
    eventType: 'config_updated',
    payload: {
      namespace: 'consent_copy',
      version,
      previous_text: previous.text,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'admin',
  });
  await appendAdminAction(client, {
    actorPartyId: input.actorPartyId,
    action: 'config.consent_copy',
    targetType: 'config_version',
    targetId: id,
    beforeState: { text: previous.text },
    afterState: { version, text: input.text },
  });
  return { version };
}

export async function getCertnAdminStatus(client: DbClient): Promise<Record<string, unknown>> {
  const avail = assessCertnAvailability();
  const { rows: last } = await client.query<{
    id: string;
    status: string;
    created_at: Date;
  }>(
    `select id, status, created_at from screening_order
     order by created_at desc limit 1`,
  ).catch(() => ({ rows: [] as Array<{ id: string; status: string; created_at: Date }> }));

  const { rows: failed } = await client.query<{ n: string }>(
    `select count(*)::text as n from screening_order
     where status = 'failed' and created_at >= now() - interval '7 days'`,
  ).catch(() => ({ rows: [{ n: '0' }] }));

  const secretArn =
    process.env.CERTN_API_KEY_SECRET_ARN ??
    'arn:aws:secretsmanager:us-east-2:941612827888:secret:rbit-dev/certn-api-key-****';

  return {
    feature_gate: avail.available ? 'enabled' : 'unavailable',
    reason: avail.available ? null : avail.reason,
    secret_arn_masked: secretArn.replace(/:[^:]+$/, ':****'),
    awscurrent_inferred: avail.available,
    last_screening_order: last[0]
      ? {
          id: last[0].id,
          status: last[0].status,
          created_at: last[0].created_at.toISOString(),
        }
      : null,
    failed_screenings_7d: Number(failed[0]?.n ?? 0),
  };
}

export async function listSelfExecutionReviews(
  client: DbClient,
  input: { status?: string | null; limit?: number; offset?: number },
): Promise<{ items: unknown[]; total: number }> {
  const status = input.status ?? 'pending';
  const limit = Math.min(input.limit ?? 50, 100);
  const offset = input.offset ?? 0;
  const { rows: countRows } = await client.query<{ n: string }>(
    `select count(*)::text as n from landlord_self_execution where status = $1`,
    [status],
  );
  const { rows } = await client.query(
    `select id, org_id, license_state, license_type, license_number,
            business_entity_name, status, compliance_tag, created_at,
            reviewer_notes, reviewed_at, reviewed_by_party_id
     from landlord_self_execution
     where status = $1
     order by created_at asc
     limit $2 offset $3`,
    [status, limit, offset],
  );
  return { items: rows, total: Number(countRows[0]?.n ?? 0) };
}

export async function decideSelfExecutionReview(
  client: DbClient,
  input: {
    id: string;
    decision: 'verify' | 'reject';
    notes?: string | null;
    actorPartyId: string;
  },
): Promise<{ id: string; status: string }> {
  if (input.decision === 'reject' && !input.notes?.trim()) {
    throw new AppError('notes required to reject', 'validation_error', 400);
  }
  const next = input.decision === 'verify' ? 'verified' : 'rejected';
  const { rows } = await client.query<{ id: string; status: string }>(
    `update landlord_self_execution
     set status = $2,
         reviewer_notes = $3,
         reviewed_by_party_id = $4,
         reviewed_at = now(),
         updated_at = now()
     where id = $1 and status = 'pending'
     returning id, status`,
    [input.id, next, input.notes ?? null, input.actorPartyId],
  );
  if (!rows[0]) throw new AppError('review not found or not pending', 'not_found', 404);
  await emitDomainEvent(client, {
    aggregateType: 'landlord_self_execution',
    aggregateId: input.id,
    eventType: 'self_execution_reviewed',
    payload: { decision: input.decision, status: next, interim_v1: true },
    actorPartyId: input.actorPartyId,
    actorKind: 'admin',
  });
  return rows[0];
}

export async function listPlatformFlags(client: DbClient): Promise<unknown[]> {
  const { rows } = await client.query(
    `select name, enabled, compliance_tag, description, updated_at, updated_by_party_id
     from platform_flag order by name`,
  );
  return rows;
}

export async function setPlatformFlag(
  client: DbClient,
  input: { name: string; enabled: boolean; actorPartyId: string },
): Promise<{ name: string; enabled: boolean }> {
  const { rows: prev } = await client.query<{ enabled: boolean }>(
    `select enabled from platform_flag where name = $1`,
    [input.name],
  );
  if (!prev[0]) throw new AppError('unknown flag', 'flag_not_found', 404);
  const { rows } = await client.query<{ name: string; enabled: boolean }>(
    `update platform_flag
     set enabled = $2, updated_at = now(), updated_by_party_id = $3
     where name = $1
     returning name, enabled`,
    [input.name, input.enabled, input.actorPartyId],
  );
  await client.query(
    `insert into platform_flag_change (flag_name, previous_enabled, new_enabled, actor_party_id)
     values ($1,$2,$3,$4)`,
    [input.name, prev[0].enabled, input.enabled, input.actorPartyId],
  );
  await emitDomainEvent(client, {
    aggregateType: 'platform_flag',
    aggregateId: randomUUID(),
    eventType: 'flag_toggled',
    payload: {
      flag: input.name,
      previous: prev[0].enabled,
      enabled: input.enabled,
      scope: 'global',
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'admin',
  });
  return rows[0]!;
}

export async function listAuditEvents(
  client: DbClient,
  input: {
    eventType?: string | null;
    partyId?: string | null;
    orgId?: string | null;
    from?: Date | null;
    to?: Date | null;
    limit?: number;
    offset?: number;
  },
): Promise<{ items: unknown[]; total: number }> {
  const limit = Math.min(input.limit ?? 50, 200);
  const offset = input.offset ?? 0;
  const params: unknown[] = [];
  const where: string[] = [];
  if (input.eventType) {
    params.push(input.eventType);
    where.push(`event_type = $${params.length}`);
  }
  if (input.partyId) {
    params.push(input.partyId);
    where.push(`actor_party_id = $${params.length}`);
  }
  if (input.orgId) {
    params.push(input.orgId);
    where.push(`(payload->>'org_id' = $${params.length} or aggregate_id::text = $${params.length})`);
  }
  if (input.from) {
    params.push(input.from);
    where.push(`occurred_at >= $${params.length}`);
  }
  if (input.to) {
    params.push(input.to);
    where.push(`occurred_at <= $${params.length}`);
  }
  const clause = where.length ? where.join(' and ') : 'true';
  const { rows: countRows } = await client.query<{ n: string }>(
    `select count(*)::text as n from domain_event where ${clause}`,
    params,
  );
  params.push(limit, offset);
  const { rows } = await client.query(
    `select id, aggregate_type, aggregate_id, event_type, event_version,
            actor_party_id, actor_kind, occurred_at,
            jsonb_build_object(
              'org_id', payload->>'org_id',
              'listing_id', payload->>'listing_id',
              'decision', payload->>'decision',
              'flag', payload->>'flag',
              'enabled', payload->>'enabled'
            ) as payload_safe
     from domain_event
     where ${clause}
     order by occurred_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: rows, total: Number(countRows[0]?.n ?? 0) };
}
