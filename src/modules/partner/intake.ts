import type { DbClient } from '../../db/pool.js';
import { appendAdminAction, emitDomainEvent } from '../audit/index.js';
import { createOrg, grantRole } from '../identity/index.js';
import { AppError } from '../shared/errors.js';

export const PARTNER_ROLES = ['landlord', 'broker'] as const;
export const PARTNER_STATUSES = ['new', 'under_review', 'approved', 'rejected'] as const;

export type PartnerRole = (typeof PARTNER_ROLES)[number];
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export type PartnerIntakeInput = {
  role: PartnerRole;
  fullName: string;
  email: string;
  phone: string;
  organizationName: string;
  market: string;
  portfolioSize: string;
  propertyTypes?: string | null;
  notes?: string | null;
};

export type PartnerIntakeRecord = {
  id: string;
  party_id: string;
  role: PartnerRole;
  status: PartnerStatus;
  full_name: string;
  email: string;
  phone: string;
  organization_name: string;
  market: string;
  portfolio_size: string;
  property_types: string | null;
  notes: string | null;
  org_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type IntakeRow = {
  id: string;
  party_id: string;
  role: PartnerRole;
  status: PartnerStatus;
  full_name: string;
  email: string;
  phone: string;
  organization_name: string;
  market: string;
  portfolio_size: string;
  property_types: string | null;
  notes: string | null;
  org_id: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const SELECT_INTAKE = `
  select id, party_id, role, status, full_name, email, phone, organization_name,
         market, portfolio_size, property_types, notes, org_id, reviewed_at,
         created_at, updated_at
  from partner_intake
`;

function toRecord(row: IntakeRow): PartnerIntakeRecord {
  return {
    id: row.id,
    party_id: row.party_id,
    role: row.role,
    status: row.status,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    organization_name: row.organization_name,
    market: row.market,
    portfolio_size: row.portfolio_size,
    property_types: row.property_types,
    notes: row.notes,
    org_id: row.org_id,
    reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function latestPartnerIntake(
  client: DbClient,
  partyId: string,
  role: PartnerRole,
): Promise<PartnerIntakeRecord | null> {
  const { rows } = await client.query<IntakeRow>(
    `${SELECT_INTAKE}
     where party_id = $1 and role = $2
     order by created_at desc
     limit 1`,
    [partyId, role],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505';
}

export async function submitPartnerIntake(
  client: DbClient,
  partyId: string,
  input: PartnerIntakeInput,
): Promise<PartnerIntakeRecord> {
  const current = await latestPartnerIntake(client, partyId, input.role);
  if (current && current.status !== 'rejected') return current;

  await client.query('savepoint partner_intake_insert');
  try {
    const { rows } = await client.query<IntakeRow>(
      `insert into partner_intake (
         party_id, role, status, full_name, email, phone, organization_name,
         market, portfolio_size, property_types, notes
       ) values ($1,$2,'new',$3,$4,$5,$6,$7,$8,$9,$10)
       returning id, party_id, role, status, full_name, email, phone, organization_name,
                 market, portfolio_size, property_types, notes, org_id, reviewed_at,
                 created_at, updated_at`,
      [
        partyId,
        input.role,
        input.fullName,
        input.email,
        input.phone,
        input.organizationName,
        input.market,
        input.portfolioSize,
        input.propertyTypes ?? null,
        input.notes ?? null,
      ],
    );
    await client.query('release savepoint partner_intake_insert');
    const created = toRecord(rows[0]!);
    await emitDomainEvent(client, {
      aggregateType: 'partner_intake',
      aggregateId: created.id,
      eventType: 'partner_intake.submitted',
      payload: { party_id: partyId, role: input.role, status: 'new' },
      actorPartyId: partyId,
      actorKind: 'user',
    });
    return created;
  } catch (err) {
    await client.query('rollback to savepoint partner_intake_insert');
    if (!isUniqueViolation(err)) throw err;
    const raced = await latestPartnerIntake(client, partyId, input.role);
    if (raced && raced.status !== 'rejected') return raced;
    throw err;
  }
}

export async function listPartnerIntakes(
  client: DbClient,
  status?: PartnerStatus | null,
): Promise<PartnerIntakeRecord[]> {
  const params: unknown[] = [];
  let where = '';
  if (status) {
    params.push(status);
    where = 'where status = $1';
  }
  const { rows } = await client.query<IntakeRow>(
    `${SELECT_INTAKE}
     ${where}
     order by created_at desc
     limit 100`,
    params,
  );
  return rows.map(toRecord);
}

async function existingOrgForRole(
  client: DbClient,
  partyId: string,
  role: PartnerRole,
): Promise<string | null> {
  const roles = role === 'broker' ? ['broker', 'broker_admin', 'agent'] : ['landlord'];
  const { rows } = await client.query<{ org_id: string }>(
    `select org_id from party_role
     where party_id = $1 and role = any($2::text[]) and org_id is not null
     limit 1`,
    [partyId, roles],
  );
  return rows[0]?.org_id ?? null;
}

export async function decidePartnerIntake(
  client: DbClient,
  input: {
    intakeId: string;
    decision: 'under_review' | 'approved' | 'rejected';
    actorPartyId: string;
  },
): Promise<PartnerIntakeRecord> {
  const { rows } = await client.query<IntakeRow>(
    `${SELECT_INTAKE} where id = $1 for update`,
    [input.intakeId],
  );
  const row = rows[0];
  if (!row) throw new AppError('intake not found', 'not_found', 404);
  if (row.status === 'approved' && input.decision === 'approved') return toRecord(row);
  if (row.status === 'approved') {
    throw new AppError('approved intake cannot be reopened', 'invalid_transition', 409);
  }
  if (row.status === 'rejected' && input.decision !== 'approved') {
    throw new AppError('rejected intake can only be approved', 'invalid_transition', 409);
  }

  let orgId = row.org_id;
  if (input.decision === 'approved') {
    orgId = orgId ?? (await existingOrgForRole(client, row.party_id, row.role));
    if (!orgId) {
      const kind = row.role === 'broker' ? 'brokerage' : 'landlord';
      const org = await createOrg(client, {
        kind,
        legalName: row.organization_name,
        displayName: row.organization_name,
        claimStatus: 'claimed',
      });
      orgId = org.id;
      await grantRole(client, {
        partyId: row.party_id,
        orgId,
        role: row.role,
      });
    }
  }

  const { rows: updated } = await client.query<IntakeRow>(
    `update partner_intake
     set status = $2,
         org_id = $3,
         reviewed_by = $4,
         reviewed_at = now(),
         updated_at = now()
     where id = $1
     returning id, party_id, role, status, full_name, email, phone, organization_name,
               market, portfolio_size, property_types, notes, org_id, reviewed_at,
               created_at, updated_at`,
    [row.id, input.decision, orgId, input.actorPartyId],
  );
  const record = toRecord(updated[0]!);
  await emitDomainEvent(client, {
    aggregateType: 'partner_intake',
    aggregateId: record.id,
    eventType: 'partner_intake.decided',
    payload: {
      party_id: record.party_id,
      role: record.role,
      status: record.status,
      org_id: record.org_id,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'admin',
  });
  await appendAdminAction(client, {
    actorPartyId: input.actorPartyId,
    action: 'partner_intake.decide',
    targetType: 'partner_intake',
    targetId: record.id,
    beforeState: { status: row.status },
    afterState: { status: record.status, org_id: record.org_id },
    reasonCode: input.decision,
  });
  return record;
}
