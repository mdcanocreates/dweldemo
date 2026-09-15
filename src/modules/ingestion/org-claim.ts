import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';

/**
 * Org claim integration for ingestion-created unclaimed orgs (§6A / Phase 4).
 * Claiming attaches claimant without creating a duplicate org.
 */
export async function createUnclaimedIngestionOrg(
  client: DbClient,
  input: {
    legalName: string;
    displayName: string;
    kind?: 'landlord' | 'property_mgmt' | 'brokerage';
  },
): Promise<{ orgId: string }> {
  const id = randomUUID();
  await client.query(
    `insert into org (id, kind, legal_name, display_name, claim_status)
     values ($1,$2,$3,$4,'unclaimed')`,
    [id, input.kind ?? 'landlord', input.legalName, input.displayName],
  );
  await emitDomainEvent(client, {
    aggregateType: 'org',
    aggregateId: id,
    eventType: 'org.created',
    payload: { kind: input.kind ?? 'landlord', claim_status: 'unclaimed', via: 'ingestion' },
    actorKind: 'system',
  });
  return { orgId: id };
}

export async function submitOrgClaim(
  client: DbClient,
  input: {
    orgId: string;
    claimantPartyId: string;
    method: 'email_domain' | 'phone_verification' | 'admin_manual' | 'feed_credential';
    evidence: Record<string, unknown>;
  },
): Promise<{ claimId: string }> {
  const { rows: orgs } = await client.query<{ id: string; claim_status: string }>(
    `select id, claim_status from org where id = $1 for update`,
    [input.orgId],
  );
  const org = orgs[0];
  if (!org) throw new AppError('org not found', 'org_not_found', 404);
  if (org.claim_status === 'claimed') {
    throw new AppError('org already claimed', 'org_already_claimed', 409);
  }

  const claimId = randomUUID();
  await client.query(
    `insert into org_claim (id, org_id, claimant_party_id, method, evidence, status)
     values ($1,$2,$3,$4,$5::jsonb,'pending')`,
    [claimId, input.orgId, input.claimantPartyId, input.method, JSON.stringify(input.evidence)],
  );
  await client.query(`update org set claim_status = 'pending' where id = $1`, [input.orgId]);
  await emitDomainEvent(client, {
    aggregateType: 'org_claim',
    aggregateId: claimId,
    eventType: 'org_claim.submitted',
    payload: { org_id: input.orgId, method: input.method },
    actorPartyId: input.claimantPartyId,
    actorKind: 'user',
  });
  return { claimId };
}

export async function approveOrgClaim(
  client: DbClient,
  input: {
    claimId: string;
    reviewedByPartyId: string;
  },
): Promise<{ orgId: string }> {
  const { rows } = await client.query<{
    id: string;
    org_id: string;
    status: string;
  }>(`select id, org_id, status from org_claim where id = $1 for update`, [input.claimId]);
  const claim = rows[0];
  if (!claim) throw new AppError('claim not found', 'claim_not_found', 404);
  if (claim.status !== 'pending') {
    throw new AppError(`claim is ${claim.status}`, 'claim_not_pending', 409);
  }

  await client.query(
    `update org_claim set status = 'approved', reviewed_by_party_id = $2, resolved_at = now()
     where id = $1`,
    [claim.id, input.reviewedByPartyId],
  );
  await client.query(`update org set claim_status = 'claimed' where id = $1`, [claim.org_id]);

  // Ensure no duplicate org was created for this claim path.
  await emitDomainEvent(client, {
    aggregateType: 'org',
    aggregateId: claim.org_id,
    eventType: 'org.claimed',
    payload: { claim_id: claim.id, reviewed_by: input.reviewedByPartyId },
    actorPartyId: input.reviewedByPartyId,
    actorKind: 'admin',
  });

  return { orgId: claim.org_id };
}
