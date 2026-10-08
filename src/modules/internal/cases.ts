/**
 * Control Center case/party contract over Dwel applications + partner reviews.
 * Never puts FCRA screening report bodies into case/party/event payloads.
 */

import type { DbClient } from '../../db/pool.js';
import { decideSelfExecutionReview } from '../admin/ops.js';
import { AppError } from '../shared/errors.js';
import { findIdempotentResponse, storeIdempotentResponse } from './idempotency.js';
import { writeCcOutboxEvent } from './outbox.js';
import {
  listApplicationWorkItems,
  listPartnerReviewWorkItems,
  mapApplicationStatusToWorkState,
} from './work-items.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FORBIDDEN_EVENT_KEYS = new Set([
  'derived_summary',
  'report_body',
  'screening_report',
  'screening_score',
  'credit_report',
  'criminal_report',
  'payload_ref',
  'fcra',
  'raw',
  'vendor_payload',
]);

export type CaseType = 'application' | 'partner_review';

export type ParsedCaseId =
  | { caseType: 'application'; id: string; sourceCaseId: string }
  | { caseType: 'partner_review'; id: string; sourceCaseId: string };

export type CcCase = {
  sourceCaseId: string;
  caseType: CaseType;
  productStage: string;
  version: string;
  etag: string;
  party: { sourcePartyId: string } | null;
  display: Record<string, unknown>;
  documents: Array<Record<string, unknown>>;
  allowedActions: string[];
  allowed_actions: string[];
  updatedAt: string;
  createdAt: string;
  workState?: string;
  requiresAttention?: boolean;
};

function iso(value: Date | string | null | undefined): string {
  if (value == null) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

export function parseSourceCaseId(raw: string): ParsedCaseId {
  const s = decodeURIComponent(raw).trim();
  const partner =
    /^(?:dwel:)?partner-review:([0-9a-f-]{36})$/i.exec(s) ??
    /^dwel:partner-review:([0-9a-f-]{36})$/i.exec(s);
  if (partner) {
    const id = partner[1]!;
    if (!UUID_RE.test(id)) throw new AppError('invalid case id', 'validation_error', 400);
    return { caseType: 'partner_review', id, sourceCaseId: `partner-review:${id}` };
  }
  const app = /^(?:dwel:)?(?:application:)?([0-9a-f-]{36})$/i.exec(s);
  if (app) {
    const id = app[1]!;
    if (!UUID_RE.test(id)) throw new AppError('invalid case id', 'validation_error', 400);
    return { caseType: 'application', id, sourceCaseId: id };
  }
  throw new AppError('invalid case id', 'validation_error', 400);
}

function applicationAllowedActions(status: string): string[] {
  // Application stage transitions are landlord/renter owned — no CC staff actions today.
  void status;
  return [];
}

function partnerAllowedActions(status: string): string[] {
  if (status === 'pending') return ['approve', 'decline'];
  return [];
}

async function documentMetadataForParty(
  client: DbClient,
  partyId: string | null,
): Promise<Array<Record<string, unknown>>> {
  if (!partyId) return [];
  const { rows } = await client.query<{
    id: string;
    doc_type: string;
    content_type: string;
    size_bytes: string;
    scan_status: string;
    version: number;
    created_at: Date;
  }>(
    `select id, doc_type, content_type, size_bytes::text, scan_status, version, created_at
     from document
     where owner_party_id = $1
     order by created_at desc
     limit 50`,
    [partyId],
  );
  return rows.map((r) => ({
    documentId: r.id,
    docType: r.doc_type,
    contentType: r.content_type,
    sizeBytes: Number(r.size_bytes),
    scanStatus: r.scan_status,
    version: r.version,
    createdAt: iso(r.created_at),
  }));
}

function sanitizeEventPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (FORBIDDEN_EVENT_KEYS.has(k)) continue;
    if (/score|report|fcra|credit|criminal|screening_body/i.test(k)) continue;
    if (typeof v === 'object' && v != null) continue;
    out[k] = v;
  }
  return out;
}

type AppCaseRow = {
  id: string;
  status: string;
  created_at: Date;
  submitted_at: Date | null;
  screened_at: Date | null;
  closed_at: Date | null;
  entry_point: string;
  source_channel: string | null;
  listing_id: string | null;
  org_id: string;
  party_id: string;
  given_name: string | null;
  family_name: string | null;
  email: string | null;
  preferred_state: string | null;
  badge_state: string | null;
  listing_city: string | null;
  listing_state: string | null;
  org_display_name: string | null;
};

function updatedAtFromApp(row: AppCaseRow): Date {
  const candidates = [row.closed_at, row.screened_at, row.submitted_at, row.created_at].filter(
    (d): d is Date => d != null,
  );
  return candidates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
}

function toApplicationCase(
  row: AppCaseRow,
  documents: Array<Record<string, unknown>>,
): CcCase {
  const updated = updatedAtFromApp(row);
  const version = iso(updated);
  const displayName = [row.given_name, row.family_name].filter(Boolean).join(' ').trim() || null;
  const allowed = applicationAllowedActions(row.status);
  return {
    sourceCaseId: row.id,
    caseType: 'application',
    productStage: row.status,
    version,
    etag: version,
    party: { sourcePartyId: row.party_id },
    display: {
      displayName,
      email: row.email,
      preferredState: row.preferred_state,
      badgeState: row.badge_state,
      entryPoint: row.entry_point,
      sourceChannel: row.source_channel,
      listingId: row.listing_id,
      orgId: row.org_id,
      orgDisplayName: row.org_display_name,
      regionLabel: [row.listing_city, row.listing_state].filter(Boolean).join(', ') || null,
      // Timestamps only — no screening score/report body
      submittedAt: row.submitted_at ? iso(row.submitted_at) : null,
      screenedAt: row.screened_at ? iso(row.screened_at) : null,
    },
    documents,
    allowedActions: allowed,
    allowed_actions: allowed,
    updatedAt: version,
    createdAt: iso(row.created_at),
    workState: mapApplicationStatusToWorkState(row.status),
    requiresAttention: [
      'draft',
      'awaiting_consent',
      'submitted',
      'awaiting_landlord_interest',
      'prescreen_failed',
    ].includes(row.status),
  };
}

async function loadApplicationCase(client: DbClient, id: string): Promise<CcCase> {
  const { rows } = await client.query<AppCaseRow>(
    `select
       a.id, a.status, a.created_at, a.submitted_at, a.screened_at, a.closed_at,
       a.entry_point, a.source_channel, a.listing_id, a.org_id, a.party_id,
       rp.given_name, rp.family_name, rp.email, rp.preferred_state, rp.badge_state,
       addr.city as listing_city, addr.state as listing_state,
       o.display_name as org_display_name
     from application a
     join renter_profile rp on rp.id = a.renter_profile_id
     join org o on o.id = a.org_id
     left join listing l on l.id = a.listing_id
     left join unit u on u.id = coalesce(a.unit_id, l.unit_id)
     left join property p on p.id = u.property_id
     left join address addr on addr.id = p.address_id
     where a.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new AppError('case not found', 'not_found', 404);
  const documents = await documentMetadataForParty(client, row.party_id);
  return toApplicationCase(row, documents);
}

type PartnerRow = {
  id: string;
  org_id: string;
  license_state: string | null;
  license_type: string | null;
  license_number: string | null;
  business_entity_name: string | null;
  status: string;
  compliance_tag: string | null;
  created_at: Date;
  reviewer_notes: string | null;
  reviewed_at: Date | null;
  reviewed_by_party_id: string | null;
  updated_at: Date | null;
};

async function loadPartnerCase(client: DbClient, id: string): Promise<CcCase> {
  const { rows } = await client.query<PartnerRow>(
    `select id, org_id, license_state, license_type, license_number,
            business_entity_name, status, compliance_tag, created_at,
            reviewer_notes, reviewed_at, reviewed_by_party_id, updated_at
     from landlord_self_execution
     where id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new AppError('case not found', 'not_found', 404);
  const updated = row.reviewed_at ?? row.updated_at ?? row.created_at;
  const version = iso(updated);
  const allowed = partnerAllowedActions(row.status);
  const sourceCaseId = `partner-review:${row.id}`;
  return {
    sourceCaseId,
    caseType: 'partner_review',
    productStage: row.status,
    version,
    etag: version,
    party: null,
    display: {
      displayName: row.business_entity_name,
      orgId: row.org_id,
      licenseState: row.license_state,
      licenseType: row.license_type,
      licenseNumber: row.license_number,
      complianceTag: row.compliance_tag,
      reviewedAt: row.reviewed_at ? iso(row.reviewed_at) : null,
    },
    documents: [],
    allowedActions: allowed,
    allowed_actions: allowed,
    updatedAt: version,
    createdAt: iso(row.created_at),
    workState: row.status === 'pending' ? 'needs_review' : row.status === 'verified' ? 'done' : 'blocked',
    requiresAttention: row.status === 'pending',
  };
}

export async function getCaseDetail(client: DbClient, rawId: string): Promise<CcCase> {
  const parsed = parseSourceCaseId(rawId);
  if (parsed.caseType === 'application') return loadApplicationCase(client, parsed.id);
  return loadPartnerCase(client, parsed.id);
}

export async function listCases(
  client: DbClient,
  input: {
    limit?: number;
    cursor?: string | null;
    q?: string | null;
    caseType?: string | null;
    updatedSince?: string | null;
  },
): Promise<{ items: CcCase[]; nextCursor: string | null; sourceHealth: 'ok' }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const typeFilter = input.caseType?.trim().toLowerCase() ?? null;
  const items: CcCase[] = [];

  if (!typeFilter || typeFilter === 'application' || typeFilter === 'applications') {
    const apps = await listApplicationWorkItems(client, {
      limit,
      cursor: input.cursor,
      q: input.q,
    });
    for (const w of apps.items) {
      const detail = await loadApplicationCase(client, w.sourceId);
      if (input.updatedSince) {
        const since = Date.parse(input.updatedSince);
        if (Number.isFinite(since) && Date.parse(detail.updatedAt) < since) continue;
      }
      items.push(detail);
    }
  }

  if (!typeFilter || typeFilter === 'partner_review' || typeFilter === 'partner-reviews') {
    const partners = await listPartnerReviewWorkItems(client, {
      status: 'pending',
      limit,
      offset: 0,
    });
    for (const w of partners.items) {
      const detail = await loadPartnerCase(client, w.sourceId);
      if (input.q?.trim()) {
        const q = input.q.trim().toLowerCase();
        const hay = JSON.stringify(detail.display).toLowerCase();
        if (!hay.includes(q) && !detail.sourceCaseId.toLowerCase().includes(q)) continue;
      }
      if (input.updatedSince) {
        const since = Date.parse(input.updatedSince);
        if (Number.isFinite(since) && Date.parse(detail.updatedAt) < since) continue;
      }
      items.push(detail);
    }
  }

  items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const page = items.slice(0, limit);
  const nextCursor =
    page.length === limit ? page[page.length - 1]!.updatedAt : null;
  return { items: page, nextCursor, sourceHealth: 'ok' };
}

export async function listCaseEvents(
  client: DbClient,
  rawId: string,
  input?: { limit?: number },
): Promise<{ sourceCaseId: string; events: Array<Record<string, unknown>> }> {
  const parsed = parseSourceCaseId(rawId);
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 100);
  const aggregateType =
    parsed.caseType === 'application' ? 'application' : 'landlord_self_execution';

  const { rows } = await client.query<{
    id: string;
    event_type: string;
    event_version: number;
    payload: unknown;
    actor_kind: string | null;
    occurred_at: Date;
  }>(
    `select id, event_type, event_version, payload, actor_kind, occurred_at
     from domain_event
     where aggregate_type = $1 and aggregate_id = $2
     order by seq desc
     limit $3`,
    [aggregateType, parsed.id, limit],
  );

  // Also include screening_order status events linked to application — status only
  let screeningEvents: typeof rows = [];
  if (parsed.caseType === 'application') {
    const { rows: orderRows } = await client.query<{ id: string }>(
      `select id from screening_order where application_id = $1`,
      [parsed.id],
    );
    if (orderRows.length > 0) {
      const ids = orderRows.map((r) => r.id);
      const { rows: sRows } = await client.query<{
        id: string;
        event_type: string;
        event_version: number;
        payload: unknown;
        actor_kind: string | null;
        occurred_at: Date;
      }>(
        `select id, event_type, event_version, payload, actor_kind, occurred_at
         from domain_event
         where aggregate_type = 'screening_order'
           and aggregate_id = any($1::uuid[])
           and event_type like 'screening_order%'
         order by seq desc
         limit $2`,
        [ids, limit],
      );
      screeningEvents = sRows;
    }
  }

  const merged = [...rows, ...screeningEvents]
    .sort((a, b) => b.occurred_at.getTime() - a.occurred_at.getTime())
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      eventType: e.event_type,
      eventVersion: e.event_version,
      actorKind: e.actor_kind,
      occurredAt: iso(e.occurred_at),
      // Safe summary only — no screening report bodies
      summary: sanitizeEventPayload(e.payload),
    }));

  return { sourceCaseId: parsed.sourceCaseId, events: merged };
}

export async function getScreeningStatus(
  client: DbClient,
  rawId: string,
): Promise<Record<string, unknown>> {
  const parsed = parseSourceCaseId(rawId);
  if (parsed.caseType !== 'application') {
    throw new AppError(
      'screening status is only available for application cases',
      'unsupported_case_type',
      400,
    );
  }

  const { rows: appRows } = await client.query<{
    id: string;
    status: string;
    screening_authorized_at: Date | null;
    screened_at: Date | null;
  }>(
    `select id, status, screening_authorized_at, screened_at from application where id = $1`,
    [parsed.id],
  );
  const app = appRows[0];
  if (!app) throw new AppError('case not found', 'not_found', 404);

  const { rows: orders } = await client.query<{
    id: string;
    status: string;
    created_at: Date;
    completed_at: Date | null;
  }>(
    `select id, status, created_at, completed_at
     from screening_order
     where application_id = $1
     order by created_at desc
     limit 5`,
    [parsed.id],
  );

  const orderIds = orders.map((o) => o.id);
  let reports: Array<{
    screening_order_id: string;
    report_kind: string;
    status: string;
    issued_at: Date | null;
  }> = [];
  if (orderIds.length > 0) {
    const { rows } = await client.query<{
      screening_order_id: string;
      report_kind: string;
      status: string;
      issued_at: Date | null;
    }>(
      `select screening_order_id, report_kind, status, issued_at
       from screening_report
       where screening_order_id = any($1::uuid[])`,
      [orderIds],
    );
    reports = rows;
  }

  return {
    sourceCaseId: parsed.sourceCaseId,
    applicationStatus: app.status,
    screeningAuthorizedAt: app.screening_authorized_at
      ? iso(app.screening_authorized_at)
      : null,
    screenedAt: app.screened_at ? iso(app.screened_at) : null,
    orders: orders.map((o) => ({
      orderId: o.id,
      status: o.status,
      createdAt: iso(o.created_at),
      completedAt: o.completed_at ? iso(o.completed_at) : null,
      reports: reports
        .filter((r) => r.screening_order_id === o.id)
        .map((r) => ({
          reportKind: r.report_kind,
          status: r.status,
          issuedAt: r.issued_at ? iso(r.issued_at) : null,
          // Explicitly omit derived_summary / payload / scores
        })),
    })),
  };
}

export async function listParties(
  client: DbClient,
  input: { limit?: number; cursor?: string | null; q?: string | null },
): Promise<{ items: Array<Record<string, unknown>>; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const params: unknown[] = [];
  let where = 'true';
  if (input.cursor?.trim()) {
    params.push(input.cursor.trim());
    where += ` and p.created_at < $${params.length}::timestamptz`;
  }
  if (input.q?.trim()) {
    params.push(`%${input.q.trim().toLowerCase()}%`);
    const i = params.length;
    where += ` and (
      p.id::text ilike $${i}
      or lower(coalesce(rp.given_name, '')) like $${i}
      or lower(coalesce(rp.family_name, '')) like $${i}
      or lower(coalesce(rp.email, '')) like $${i}
      or exists (
        select 1 from external_identity_ref e
        where e.party_id = p.id and lower(e.vendor_subject_id) like $${i}
      )
    )`;
  }
  params.push(limit);
  const { rows } = await client.query<{
    id: string;
    kind: string;
    created_at: Date;
    given_name: string | null;
    family_name: string | null;
    email: string | null;
    preferred_state: string | null;
    badge_state: string | null;
  }>(
    `select p.id, p.kind, p.created_at,
            rp.given_name, rp.family_name, rp.email, rp.preferred_state, rp.badge_state
     from party p
     left join renter_profile rp on rp.party_id = p.id
     where ${where}
     order by p.created_at desc
     limit $${params.length}`,
    params,
  );

  const items = rows.map((r) => ({
    sourcePartyId: r.id,
    kind: r.kind,
    displayName: [r.given_name, r.family_name].filter(Boolean).join(' ').trim() || null,
    email: r.email,
    preferredState: r.preferred_state,
    badgeState: r.badge_state,
    createdAt: iso(r.created_at),
  }));
  const nextCursor =
    items.length === limit ? iso(rows[rows.length - 1]!.created_at) : null;
  return { items, nextCursor };
}

export async function getParty(
  client: DbClient,
  partyId: string,
): Promise<Record<string, unknown>> {
  if (!UUID_RE.test(partyId)) {
    throw new AppError('invalid party id', 'validation_error', 400);
  }
  const { rows } = await client.query<{
    id: string;
    kind: string;
    created_at: Date;
    given_name: string | null;
    family_name: string | null;
    email: string | null;
    preferred_state: string | null;
    badge_state: string | null;
  }>(
    `select p.id, p.kind, p.created_at,
            rp.given_name, rp.family_name, rp.email, rp.preferred_state, rp.badge_state
     from party p
     left join renter_profile rp on rp.party_id = p.id
     where p.id = $1`,
    [partyId],
  );
  const r = rows[0];
  if (!r) throw new AppError('party not found', 'not_found', 404);

  const { rows: caseRows } = await client.query<{ id: string; status: string }>(
    `select id, status from application where party_id = $1 order by created_at desc limit 20`,
    [partyId],
  );

  return {
    sourcePartyId: r.id,
    kind: r.kind,
    displayName: [r.given_name, r.family_name].filter(Boolean).join(' ').trim() || null,
    email: r.email,
    preferredState: r.preferred_state,
    badgeState: r.badge_state,
    createdAt: iso(r.created_at),
    linkedCases: caseRows.map((c) => ({
      sourceCaseId: c.id,
      caseType: 'application',
      productStage: c.status,
    })),
  };
}

function extractExpectedVersion(
  headers: Record<string, string | string[] | undefined>,
  body: Record<string, unknown>,
): string | null {
  const ifMatch = headers['if-match'];
  const raw =
    typeof ifMatch === 'string'
      ? ifMatch
      : Array.isArray(ifMatch)
        ? ifMatch[0]
        : null;
  if (raw?.trim()) {
    return raw.trim().replace(/^W\//, '').replaceAll('"', '');
  }
  if (typeof body.expected_version === 'string') return body.expected_version;
  if (typeof body.expectedVersion === 'string') return body.expectedVersion;
  return null;
}

export async function executeCaseAction(
  client: DbClient,
  input: {
    rawCaseId: string;
    action: string;
    headers: Record<string, string | string[] | undefined>;
    body: Record<string, unknown>;
    idempotencyKey: string;
    actorSubject: string | null;
  },
): Promise<{ status: number; body: unknown }> {
  const parsed = parseSourceCaseId(input.rawCaseId);
  const routeKey = `POST /internal/v1/cases/${parsed.sourceCaseId}/actions/${input.action}`;

  const existing = await findIdempotentResponse(client, {
    idempotencyKey: input.idempotencyKey,
    routeKey,
  });
  if (existing) return existing;

  const action = input.action.trim().toLowerCase();
  const expected = extractExpectedVersion(input.headers, input.body);

  if (parsed.caseType === 'partner_review') {
    const current = await loadPartnerCase(client, parsed.id);
    if (expected != null && expected !== current.version && expected !== current.etag) {
      return {
        status: 409,
        body: {
          error: 'version_conflict',
          message: 'case changed; refresh and retry',
          version: current.version,
          etag: current.etag,
        },
      };
    }

    let decision: 'verify' | 'reject';
    if (action === 'approve' || action === 'verify') decision = 'verify';
    else if (action === 'decline' || action === 'reject') decision = 'reject';
    else {
      throw new AppError(
        `unsupported action '${input.action}' for partner_review`,
        'unsupported_action',
        400,
      );
    }

    const notes =
      typeof input.body.notes === 'string'
        ? input.body.notes
        : typeof input.body.reason === 'string'
          ? input.body.reason
          : null;

    // CC employees are not Dwel parties — only set reviewed_by_party_id when sub is a real party.
    let actorPartyId: string | null = null;
    if (input.actorSubject && UUID_RE.test(input.actorSubject)) {
      const { rows: partyRows } = await client.query<{ id: string }>(
        `select id from party where id = $1`,
        [input.actorSubject],
      );
      actorPartyId = partyRows[0]?.id ?? null;
    }

    const result = await decideSelfExecutionReview(client, {
      id: parsed.id,
      decision,
      notes,
      actorPartyId,
      actorSubject: input.actorSubject,
    });

    const updated = await loadPartnerCase(client, parsed.id);
    await writeCcOutboxEvent(client, {
      eventType: 'case.stage_changed',
      sourceCaseId: parsed.sourceCaseId,
      sourceVersion: updated.version,
      payload: {
        caseType: 'partner_review',
        action,
        decision,
        fromStage: current.productStage,
        toStage: result.status,
      },
    });

    const body = {
      ok: true,
      sourceCaseId: parsed.sourceCaseId,
      action,
      result,
      case: updated,
    };
    await storeIdempotentResponse(client, {
      idempotencyKey: input.idempotencyKey,
      routeKey,
      status: 200,
      body,
    });
    return { status: 200, body };
  }

  // Application / listing review actions are not staff-owned on this surface yet.
  if (action === 'listing_approve' || action === 'listing_decline' || action === 'listing_review') {
    throw new AppError(
      'listing review actions are not available on this Dwel internal surface',
      'unsupported_action',
      400,
    );
  }

  throw new AppError(
    `unsupported action '${input.action}' for ${parsed.caseType}`,
    'unsupported_action',
    400,
  );
}
