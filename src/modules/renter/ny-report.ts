import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';

const FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;

export type ScreeningReportView = {
  id: string;
  report_source: string;
  completed_at: string;
  state_jurisdiction: string;
  compliance_tag: string | null;
  fresh: boolean;
};

export async function getLatestValidNyReport(
  client: DbClient,
  partyId: string,
  now = new Date(),
): Promise<ScreeningReportView | null> {
  const { rows } = await client.query<{
    id: string;
    report_source: string;
    completed_at: Date;
    state_jurisdiction: string;
    compliance_tag: string | null;
  }>(
    `select id, report_source, completed_at, state_jurisdiction, compliance_tag
     from applicant_screening_submission
     where party_id = $1
       and state_jurisdiction = 'NY'
     order by completed_at desc
     limit 1`,
    [partyId],
  );
  const row = rows[0];
  if (!row) return null;
  const fresh = now.getTime() - row.completed_at.getTime() <= FRESHNESS_MS;
  return {
    id: row.id,
    report_source: row.report_source,
    completed_at: row.completed_at.toISOString(),
    state_jurisdiction: row.state_jurisdiction,
    compliance_tag: row.compliance_tag,
    fresh,
  };
}

/** Interest-click gate: NY renters need a fresh report. Non-NY: no pre-check. */
export async function assertInterestScreeningGate(
  client: DbClient,
  partyId: string,
  preferredState: string | null,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; reason: 'ny_report_required' | 'ny_report_expired' }> {
  if ((preferredState ?? '').toUpperCase() !== 'NY') {
    return { ok: true };
  }
  const report = await getLatestValidNyReport(client, partyId, now);
  if (!report) return { ok: false, reason: 'ny_report_required' };
  if (!report.fresh) return { ok: false, reason: 'ny_report_expired' };
  return { ok: true };
}

export async function recordApplicantSuppliedReport(
  client: DbClient,
  input: {
    partyId: string;
    completedAt: Date;
    stateJurisdiction: string;
    storageKey?: string | null;
    originalFilename?: string | null;
    contentType?: string | null;
    now?: Date;
  },
): Promise<ScreeningReportView> {
  const now = input.now ?? new Date();
  const state = input.stateJurisdiction.toUpperCase();
  if (state !== 'NY') {
    throw new AppError('applicant-supplied path is NY-only', 'validation_error', 400);
  }
  const age = now.getTime() - input.completedAt.getTime();
  if (age < 0 || age > FRESHNESS_MS) {
    throw new AppError(
      'completion date must be within the last 30 days',
      'report_stale',
      400,
    );
  }

  const { rows } = await client.query<{
    id: string;
    report_source: string;
    completed_at: Date;
    state_jurisdiction: string;
    compliance_tag: string | null;
  }>(
    `insert into applicant_screening_submission (
       party_id, report_source, completed_at, state_jurisdiction,
       storage_key, original_filename, content_type
     ) values ($1,'applicant_supplied',$2,$3,$4,$5,$6)
     returning id, report_source, completed_at, state_jurisdiction, compliance_tag`,
    [
      input.partyId,
      input.completedAt,
      state,
      input.storageKey ?? null,
      input.originalFilename ?? null,
      input.contentType ?? null,
    ],
  );
  const row = rows[0]!;
  return {
    id: row.id,
    report_source: row.report_source,
    completed_at: row.completed_at.toISOString(),
    state_jurisdiction: row.state_jurisdiction,
    compliance_tag: row.compliance_tag,
    fresh: true,
  };
}

export async function recordApplicantPurchasedReport(
  client: DbClient,
  input: {
    partyId: string;
    stateJurisdiction: string;
    completedAt?: Date;
  },
): Promise<ScreeningReportView> {
  const completedAt = input.completedAt ?? new Date();
  const { rows } = await client.query<{
    id: string;
    report_source: string;
    completed_at: Date;
    state_jurisdiction: string;
    compliance_tag: string | null;
  }>(
    `insert into applicant_screening_submission (
       party_id, report_source, completed_at, state_jurisdiction, compliance_tag
     ) values ($1,'applicant_purchased',$2,$3,'interim_v1')
     returning id, report_source, completed_at, state_jurisdiction, compliance_tag`,
    [input.partyId, completedAt, input.stateJurisdiction.toUpperCase()],
  );
  const row = rows[0]!;
  return {
    id: row.id,
    report_source: row.report_source,
    completed_at: row.completed_at.toISOString(),
    state_jurisdiction: row.state_jurisdiction,
    compliance_tag: row.compliance_tag,
    fresh: true,
  };
}
