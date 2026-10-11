import type { DbClient } from '../../db/pool.js';
import { listCashbackForParty } from '../cashback/index.js';

/**
 * Aggregate screening reports + cashback eligibility across the renter's applications.
 */
export async function getScreeningCenter(
  client: DbClient,
  partyId: string,
): Promise<{
  applications: Array<{
    application_id: string;
    listing_id: string | null;
    status: string;
    reports: Array<{
      report_kind: string;
      status: string;
      issued_at: string | null;
    }>;
  }>;
  ny_submissions: Array<{
    id: string;
    report_source: string;
    completed_at: string;
    state_jurisdiction: string;
    compliance_tag: string | null;
  }>;
  cashback: Awaited<ReturnType<typeof listCashbackForParty>>;
}> {
  const { rows: apps } = await client.query<{
    id: string;
    listing_id: string | null;
    status: string;
  }>(
    `select id, listing_id, status
     from application
     where party_id = $1
     order by created_at desc`,
    [partyId],
  );

  const appIds = apps.map((a) => a.id);
  const reportsByApp = new Map<
    string,
    Array<{ report_kind: string; status: string; issued_at: string | null }>
  >();
  for (const id of appIds) reportsByApp.set(id, []);

  if (appIds.length) {
    const { rows: reports } = await client.query<{
      application_id: string;
      report_kind: string;
      status: string;
      issued_at: Date | null;
    }>(
      `select distinct on (so.application_id, sr.report_kind)
              so.application_id::text as application_id,
              sr.report_kind, sr.status, sr.issued_at
       from screening_order so
       join screening_report sr on sr.screening_order_id = so.id
       where so.application_id = any($1::uuid[])
       order by so.application_id, sr.report_kind, so.created_at desc, sr.issued_at desc nulls last`,
      [appIds],
    );
    for (const r of reports) {
      reportsByApp.get(r.application_id)?.push({
        report_kind: r.report_kind,
        status: r.status,
        issued_at: r.issued_at?.toISOString() ?? null,
      });
    }
  }

  const { rows: ny } = await client.query<{
    id: string;
    report_source: string;
    completed_at: Date;
    state_jurisdiction: string;
    compliance_tag: string | null;
  }>(
    `select id, report_source, completed_at, state_jurisdiction, compliance_tag
     from applicant_screening_submission
     where party_id = $1
     order by completed_at desc`,
    [partyId],
  );

  const cashback = await listCashbackForParty(client, partyId);

  return {
    applications: apps.map((a) => ({
      application_id: a.id,
      listing_id: a.listing_id,
      status: a.status,
      reports: reportsByApp.get(a.id) ?? [],
    })),
    ny_submissions: ny.map((n) => ({
      id: n.id,
      report_source: n.report_source,
      completed_at: n.completed_at.toISOString(),
      state_jurisdiction: n.state_jurisdiction,
      compliance_tag: n.compliance_tag,
    })),
    cashback,
  };
}
