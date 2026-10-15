import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';

export const SUPPORT_CATEGORIES = [
  'screening',
  'payment',
  'cashback',
  'listing_issue',
  'privacy',
  'account',
  'broker_relationship',
  'fraud',
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export type SupportCaseRow = {
  id: string;
  party_id: string;
  org_id: string | null;
  category: string;
  subject: string;
  description: string;
  related_listing_id: string | null;
  related_application_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export async function createSupportCase(
  client: DbClient,
  input: {
    partyId: string;
    category: SupportCategory;
    subject: string;
    description: string;
    orgId?: string | null;
    relatedListingId?: string | null;
    relatedApplicationId?: string | null;
  },
): Promise<SupportCaseRow> {
  const subject = input.subject.trim();
  const description = input.description.trim();
  if (!subject) throw new AppError('subject required', 'validation_error', 400);
  if (!description) throw new AppError('description required', 'validation_error', 400);

  const { rows } = await client.query<{
    id: string;
    party_id: string;
    org_id: string | null;
    category: string;
    subject: string;
    description: string;
    related_listing_id: string | null;
    related_application_id: string | null;
    status: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `insert into support_case (
       party_id, org_id, category, subject, description,
       related_listing_id, related_application_id
     ) values ($1,$2,$3,$4,$5,$6,$7)
     returning *`,
    [
      input.partyId,
      input.orgId ?? null,
      input.category,
      subject.slice(0, 200),
      description.slice(0, 5000),
      input.relatedListingId ?? null,
      input.relatedApplicationId ?? null,
    ],
  );
  const row = rows[0]!;
  await emitDomainEvent(client, {
    aggregateType: 'support_case',
    aggregateId: row.id,
    eventType: 'support_case.created',
    payload: {
      category: row.category,
      // [PLACEHOLDER] legal/ops routing copy — counsel must approve support workflows
      legal_copy: '[PLACEHOLDER] Support case intake — not a formal legal notice.',
    },
    actorPartyId: input.partyId,
    actorKind: 'user',
  });
  return {
    id: row.id,
    party_id: row.party_id,
    org_id: row.org_id,
    category: row.category,
    subject: row.subject,
    description: row.description,
    related_listing_id: row.related_listing_id,
    related_application_id: row.related_application_id,
    status: row.status,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function listSupportCases(
  client: DbClient,
  partyId: string,
): Promise<SupportCaseRow[]> {
  const { rows } = await client.query<{
    id: string;
    party_id: string;
    org_id: string | null;
    category: string;
    subject: string;
    description: string;
    related_listing_id: string | null;
    related_application_id: string | null;
    status: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `select * from support_case where party_id = $1 order by created_at desc`,
    [partyId],
  );
  return rows.map((row) => ({
    id: row.id,
    party_id: row.party_id,
    org_id: row.org_id,
    category: row.category,
    subject: row.subject,
    description: row.description,
    related_listing_id: row.related_listing_id,
    related_application_id: row.related_application_id,
    status: row.status,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }));
}
