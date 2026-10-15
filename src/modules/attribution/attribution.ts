import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';

export type VisitorAttributionRow = {
  id: string;
  visitor_key: string;
  partner_org_id: string | null;
  campaign_id: string | null;
  landing_path: string | null;
  http_referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

export type PartyAcquisitionRow = {
  party_id: string;
  first_touch_id: string | null;
  last_touch_id: string | null;
  acquisition_partner_org_id: string | null;
  acquisition_campaign_id: string | null;
  bound_at: string;
};

export type PartnerFunnelMetrics = {
  partner_code: string;
  partner_name: string;
  visitors: number;
  parties_acquired: number;
  applications: number;
};

function mapVisitor(row: {
  id: string;
  visitor_key: string;
  partner_org_id: string | null;
  campaign_id: string | null;
  landing_path: string | null;
  http_referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
}): VisitorAttributionRow {
  return {
    id: row.id,
    visitor_key: row.visitor_key,
    partner_org_id: row.partner_org_id,
    campaign_id: row.campaign_id,
    landing_path: row.landing_path,
    http_referrer: row.http_referrer,
    utm_source: row.utm_source,
    utm_medium: row.utm_medium,
    utm_campaign: row.utm_campaign,
    utm_content: row.utm_content,
    first_seen_at: row.first_seen_at.toISOString(),
    last_seen_at: row.last_seen_at.toISOString(),
  };
}

/**
 * Record or refresh visitor attribution from public ?ref= / ?campaign= / UTM params.
 * First-touch partner fields on an existing visitor_key are not overwritten.
 */
export async function recordVisitorAttribution(
  client: DbClient,
  input: {
    partnerCode?: string | null;
    campaignCode?: string | null;
    visitorKey?: string | null;
    landingPath?: string | null;
    httpReferrer?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
  },
): Promise<VisitorAttributionRow> {
  const visitorKey =
    input.visitorKey?.trim() ||
    `vk_${randomUUID().replace(/-/g, '')}`;

  let partnerOrgId: string | null = null;
  let campaignId: string | null = null;

  if (input.partnerCode?.trim()) {
    const { rows: partners } = await client.query<{ id: string }>(
      `select id from partner_organization
       where lower(partner_code) = lower($1) and status = 'active'
       limit 1`,
      [input.partnerCode.trim()],
    );
    partnerOrgId = partners[0]?.id ?? null;
  }

  if (partnerOrgId && input.campaignCode?.trim()) {
    const { rows: camps } = await client.query<{ id: string }>(
      `select id from partner_campaign
       where partner_org_id = $1
         and lower(campaign_code) = lower($2)
         and status = 'active'
       limit 1`,
      [partnerOrgId, input.campaignCode.trim()],
    );
    campaignId = camps[0]?.id ?? null;
  }

  const { rows } = await client.query<{
    id: string;
    visitor_key: string;
    partner_org_id: string | null;
    campaign_id: string | null;
    landing_path: string | null;
    http_referrer: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    first_seen_at: Date;
    last_seen_at: Date;
  }>(
    `insert into visitor_attribution (
       visitor_key, partner_org_id, campaign_id, landing_path, http_referrer,
       utm_source, utm_medium, utm_campaign, utm_content
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (visitor_key) do update set
       last_seen_at = now(),
       landing_path = coalesce(excluded.landing_path, visitor_attribution.landing_path),
       http_referrer = coalesce(excluded.http_referrer, visitor_attribution.http_referrer),
       utm_source = coalesce(excluded.utm_source, visitor_attribution.utm_source),
       utm_medium = coalesce(excluded.utm_medium, visitor_attribution.utm_medium),
       utm_campaign = coalesce(excluded.utm_campaign, visitor_attribution.utm_campaign),
       utm_content = coalesce(excluded.utm_content, visitor_attribution.utm_content),
       -- first-touch partner/campaign immutable once set
       partner_org_id = coalesce(visitor_attribution.partner_org_id, excluded.partner_org_id),
       campaign_id = coalesce(visitor_attribution.campaign_id, excluded.campaign_id)
     returning *`,
    [
      visitorKey,
      partnerOrgId,
      campaignId,
      input.landingPath?.slice(0, 500) ?? null,
      input.httpReferrer?.slice(0, 500) ?? null,
      input.utmSource?.slice(0, 120) ?? null,
      input.utmMedium?.slice(0, 120) ?? null,
      input.utmCampaign?.slice(0, 120) ?? null,
      input.utmContent?.slice(0, 120) ?? null,
    ],
  );

  return mapVisitor(rows[0]!);
}

/**
 * Bind visitor attribution to a party on auth redeem / first session.
 * First touch is immutable; last touch may refresh.
 */
export async function bindPartyAcquisition(
  client: DbClient,
  input: { partyId: string; visitorKey: string },
): Promise<PartyAcquisitionRow> {
  const { rows: visitors } = await client.query<{
    id: string;
    partner_org_id: string | null;
    campaign_id: string | null;
  }>(
    `select id, partner_org_id, campaign_id from visitor_attribution where visitor_key = $1`,
    [input.visitorKey],
  );
  const visit = visitors[0];
  if (!visit) {
    throw new AppError('visitor attribution not found', 'visitor_not_found', 404);
  }

  const { rows } = await client.query<{
    party_id: string;
    first_touch_id: string | null;
    last_touch_id: string | null;
    acquisition_partner_org_id: string | null;
    acquisition_campaign_id: string | null;
    bound_at: Date;
  }>(
    `insert into party_acquisition (
       party_id, first_touch_id, last_touch_id,
       acquisition_partner_org_id, acquisition_campaign_id
     ) values ($1,$2,$2,$3,$4)
     on conflict (party_id) do update set
       last_touch_id = excluded.last_touch_id,
       updated_at = now()
       -- first_touch_id and acquisition_* stay first-touch immutable
     returning *`,
    [input.partyId, visit.id, visit.partner_org_id, visit.campaign_id],
  );
  const r = rows[0]!;
  return {
    party_id: r.party_id,
    first_touch_id: r.first_touch_id,
    last_touch_id: r.last_touch_id,
    acquisition_partner_org_id: r.acquisition_partner_org_id,
    acquisition_campaign_id: r.acquisition_campaign_id,
    bound_at: r.bound_at.toISOString(),
  };
}

/** Snapshot party acquisition onto application at interest create (idempotent). */
export async function snapshotApplicationAttribution(
  client: DbClient,
  applicationId: string,
  partyId: string,
): Promise<void> {
  await client.query(
    `update application a
     set
       acquisition_first_touch_id = coalesce(a.acquisition_first_touch_id, pa.first_touch_id),
       acquisition_last_touch_id = coalesce(pa.last_touch_id, a.acquisition_last_touch_id),
       acquisition_partner_org_id = coalesce(a.acquisition_partner_org_id, pa.acquisition_partner_org_id),
       acquisition_campaign_id = coalesce(a.acquisition_campaign_id, pa.acquisition_campaign_id)
     from party_acquisition pa
     where a.id = $1
       and pa.party_id = $2
       and a.acquisition_first_touch_id is null`,
    [applicationId, partyId],
  );
}

export async function getPartnerFunnelMetrics(
  client: DbClient,
  partnerCode: string,
): Promise<PartnerFunnelMetrics> {
  const { rows: partners } = await client.query<{ id: string; name: string; partner_code: string }>(
    `select id, name, partner_code from partner_organization
     where lower(partner_code) = lower($1)`,
    [partnerCode],
  );
  const partner = partners[0];
  if (!partner) {
    throw new AppError('partner not found', 'partner_not_found', 404);
  }

  const { rows: counts } = await client.query<{
    visitors: string;
    parties: string;
    applications: string;
  }>(
    `select
       (select count(*)::text from visitor_attribution where partner_org_id = $1) as visitors,
       (select count(*)::text from party_acquisition where acquisition_partner_org_id = $1) as parties,
       (select count(*)::text from application where acquisition_partner_org_id = $1) as applications`,
    [partner.id],
  );

  return {
    partner_code: partner.partner_code,
    partner_name: partner.name,
    visitors: Number(counts[0]?.visitors ?? 0),
    parties_acquired: Number(counts[0]?.parties ?? 0),
    applications: Number(counts[0]?.applications ?? 0),
  };
}
