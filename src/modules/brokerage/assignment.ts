import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { resolveConfig } from '../config/index.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import { isLicenseEligible } from './profile.js';

export type AssignmentCandidate = {
  orgId: string;
  priority: number;
  closeRate: number;
  leakageRate: number;
  medianResponseSeconds: number;
  lastOfferedAt: Date | null;
  openLeads: number;
  maxOpenLeads: number;
  rankReasons: string[];
};

async function listingSubmarketId(
  client: DbClient,
  listingId: string,
): Promise<{ submarketId: string; listingOrgId: string }> {
  const { rows } = await client.query<{
    submarket_id: string | null;
    org_id: string;
  }>(
    `select a.submarket_id, l.org_id
     from listing l
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address a on a.id = p.address_id
     where l.id = $1`,
    [listingId],
  );
  if (!rows[0]) throw new AppError('listing not found', 'LISTING_NOT_FOUND');
  if (!rows[0].submarket_id) {
    throw new AppError('listing has no submarket', 'LISTING_NO_SUBMARKET');
  }
  return { submarketId: rows[0].submarket_id, listingOrgId: rows[0].org_id };
}

export async function rankEligibleBrokers(
  client: DbClient,
  input: { listingId: string; clock?: Clock },
): Promise<AssignmentCandidate[]> {
  const clock = input.clock ?? systemClock;
  const { submarketId, listingOrgId } = await listingSubmarketId(
    client,
    input.listingId,
  );

  const { rows } = await client.query<{
    org_id: string;
    priority: number;
    close_rate: string | null;
    leakage_rate: string | null;
    median_response_seconds: number | null;
    max_open_leads: number;
    last_offered_at: Date | null;
    open_leads: string;
  }>(
    `select bc.org_id, bc.priority,
            bp.close_rate::text, bp.leakage_rate::text, bp.median_response_seconds,
            pr.max_open_leads,
            (
              select max(lo.offered_at) from lead_offer lo where lo.broker_org_id = bc.org_id
            ) as last_offered_at,
            (
              select count(*)::text from lead_offer lo
              join lead ld on ld.id = lo.lead_id
              where lo.broker_org_id = bc.org_id
                and lo.response = 'accepted'
                and ld.status in ('purchased','released','offered')
            ) as open_leads
     from broker_coverage bc
     join broker_profile pr on pr.org_id = bc.org_id
     left join broker_performance bp on bp.org_id = bc.org_id
     where bc.submarket_id = $1 and bc.is_active = true`,
    [submarketId],
  );

  const candidates: AssignmentCandidate[] = [];
  for (const r of rows) {
    if (r.org_id === listingOrgId) continue; // conflict of interest
    const gate = await isLicenseEligible(client, {
      orgId: r.org_id,
      submarketId,
      clock,
    });
    if (!gate.eligible) continue;
    const openLeads = Number(r.open_leads);
    if (openLeads >= r.max_open_leads) continue;

    candidates.push({
      orgId: r.org_id,
      priority: r.priority,
      closeRate: r.close_rate != null ? Number(r.close_rate) : 0,
      leakageRate: r.leakage_rate != null ? Number(r.leakage_rate) : 1,
      medianResponseSeconds: r.median_response_seconds ?? Number.MAX_SAFE_INTEGER,
      lastOfferedAt: r.last_offered_at,
      openLeads,
      maxOpenLeads: r.max_open_leads,
      rankReasons: ['license_ok', 'coverage_ok', 'capacity_ok'],
    });
  }

  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.closeRate !== a.closeRate) return b.closeRate - a.closeRate;
    if (a.leakageRate !== b.leakageRate) return a.leakageRate - b.leakageRate;
    if (a.medianResponseSeconds !== b.medianResponseSeconds) {
      return a.medianResponseSeconds - b.medianResponseSeconds;
    }
    const aLast = a.lastOfferedAt?.getTime() ?? 0;
    const bLast = b.lastOfferedAt?.getTime() ?? 0;
    return aLast - bLast;
  });

  return candidates;
}

async function assignmentConfig(
  client: DbClient,
  asOf: Date,
): Promise<{ slaHours: number; maxReoffers: number }> {
  const cfg = await resolveConfig(client, 'lead_assignment', asOf);
  const slaHours = Number(cfg?.sla_hours ?? 4);
  const maxReoffers = Number(cfg?.max_reoffers ?? 3);
  return { slaHours, maxReoffers };
}

export async function offerLeadToNextBroker(
  client: DbClient,
  input: { leadId: string; clock?: Clock },
): Promise<{
  offerId: string | null;
  brokerOrgId: string | null;
  routedToAdmin: boolean;
  candidates: AssignmentCandidate[];
}> {
  const clock = input.clock ?? systemClock;
  const { rows: leadRows } = await client.query<{
    id: string;
    listing_id: string;
    status: string;
  }>(`select id, listing_id, status from lead where id = $1 for update`, [
    input.leadId,
  ]);
  const lead = leadRows[0];
  if (!lead) throw new AppError('lead not found', 'LEAD_NOT_FOUND');

  const { slaHours, maxReoffers } = await assignmentConfig(client, clock.now());

  const { rows: priorOffers } = await client.query<{ n: string }>(
    `select count(*)::text as n from lead_offer where lead_id = $1`,
    [input.leadId],
  );
  const offerCount = Number(priorOffers[0]!.n);
  if (offerCount >= maxReoffers) {
    await client.query(`update lead set status = 'expired' where id = $1`, [
      input.leadId,
    ]);
    await emitDomainEvent(client, {
      aggregateType: 'lead',
      aggregateId: input.leadId,
      eventType: 'lead.routed_admin_queue',
      payload: { reason: 'max_reoffers', offer_count: offerCount },
      actorKind: 'system',
      occurredAt: clock.now(),
    });
    return {
      offerId: null,
      brokerOrgId: null,
      routedToAdmin: true,
      candidates: [],
    };
  }

  const candidates = await rankEligibleBrokers(client, {
    listingId: lead.listing_id,
    clock,
  });

  const { rows: already } = await client.query<{ broker_org_id: string }>(
    `select broker_org_id from lead_offer where lead_id = $1`,
    [input.leadId],
  );
  const alreadySet = new Set(already.map((a) => a.broker_org_id));
  const next = candidates.find((c) => !alreadySet.has(c.orgId));
  if (!next) {
    await emitDomainEvent(client, {
      aggregateType: 'lead',
      aggregateId: input.leadId,
      eventType: 'lead.routed_admin_queue',
      payload: { reason: 'no_eligible_brokers', candidates },
      actorKind: 'system',
      occurredAt: clock.now(),
    });
    return {
      offerId: null,
      brokerOrgId: null,
      routedToAdmin: true,
      candidates,
    };
  }

  // Close any open offer first (should not exist due to unique index)
  await client.query(
    `update lead_offer
     set responded_at = $2, response = 'expired'
     where lead_id = $1 and responded_at is null`,
    [input.leadId, clock.now()],
  );

  const offerId = randomUUID();
  const slaExpires = new Date(clock.now().getTime() + slaHours * 3600_000);
  await client.query(
    `insert into lead_offer (
       id, lead_id, broker_org_id, offered_at, sla_expires_at
     ) values ($1,$2,$3,$4,$5)`,
    [offerId, input.leadId, next.orgId, clock.now(), slaExpires],
  );

  const newStatus = offerCount > 0 ? 'reoffered' : 'offered';
  await client.query(`update lead set status = $2 where id = $1`, [
    input.leadId,
    newStatus,
  ]);

  await client.query(
    `insert into lead_offer_saga_state (
       lead_id, workflow_id, run_id, status, step, state_payload, updated_at
     ) values ($1,$2,$3,'running','await_sla',$4::jsonb,$5)
     on conflict (lead_id) do update set
       workflow_id = excluded.workflow_id,
       run_id = excluded.run_id,
       status = 'running',
       step = 'await_sla',
       state_payload = excluded.state_payload,
       updated_at = excluded.updated_at`,
    [
      input.leadId,
      `lead-offer-${input.leadId}`,
      randomUUID(),
      JSON.stringify({ offer_id: offerId, sla_expires_at: slaExpires.toISOString() }),
      clock.now(),
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'lead',
    aggregateId: input.leadId,
    eventType: 'lead.offered',
    payload: {
      offer_id: offerId,
      broker_org_id: next.orgId,
      sla_expires_at: slaExpires.toISOString(),
      candidates,
      ranking_inputs: next,
    },
    actorKind: 'system',
    occurredAt: clock.now(),
  });

  await client.query(
    `update broker_performance
     set leads_offered = leads_offered + 1, updated_at = now()
     where org_id = $1`,
    [next.orgId],
  );

  return {
    offerId,
    brokerOrgId: next.orgId,
    routedToAdmin: false,
    candidates,
  };
}

export async function respondToLeadOffer(
  client: DbClient,
  input: {
    offerId: string;
    response: 'accepted' | 'declined';
    declineReason?: string;
    clock?: Clock;
  },
): Promise<{ leadId: string; reoffered: boolean }> {
  const clock = input.clock ?? systemClock;
  const { rows } = await client.query<{
    id: string;
    lead_id: string;
    broker_org_id: string;
    responded_at: Date | null;
  }>(`select id, lead_id, broker_org_id, responded_at from lead_offer where id = $1 for update`, [
    input.offerId,
  ]);
  const offer = rows[0];
  if (!offer) throw new AppError('offer not found', 'OFFER_NOT_FOUND');
  if (offer.responded_at) throw new AppError('offer already responded', 'OFFER_CLOSED');

  await client.query(
    `update lead_offer
     set responded_at = $2, response = $3, decline_reason = $4
     where id = $1`,
    [
      input.offerId,
      clock.now(),
      input.response,
      input.declineReason ?? null,
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'lead_offer',
    aggregateId: input.offerId,
    eventType:
      input.response === 'accepted' ? 'lead_offer.accepted' : 'lead_offer.declined',
    payload: {
      lead_id: offer.lead_id,
      broker_org_id: offer.broker_org_id,
      decline_reason: input.declineReason ?? null,
    },
    actorKind: 'user',
    occurredAt: clock.now(),
  });

  if (input.response === 'accepted') {
    await client.query(
      `update broker_performance
       set leads_accepted = leads_accepted + 1, updated_at = now()
       where org_id = $1`,
      [offer.broker_org_id],
    );
    await client.query(
      `update lead_offer_saga_state
       set status = 'completed', step = 'accepted', updated_at = $2
       where lead_id = $1`,
      [offer.lead_id, clock.now()],
    );
    return { leadId: offer.lead_id, reoffered: false };
  }

  const re = await offerLeadToNextBroker(client, {
    leadId: offer.lead_id,
    clock,
  });
  return { leadId: offer.lead_id, reoffered: re.offerId != null };
}

/** Advance SLA timer (in-process Temporal-style). */
export async function advanceLeadOfferSla(
  client: DbClient,
  input: { leadId: string; clock?: Clock },
): Promise<{ expired: boolean; reoffered: boolean }> {
  const clock = input.clock ?? systemClock;
  const { rows } = await client.query<{
    id: string;
    sla_expires_at: Date;
    responded_at: Date | null;
  }>(
    `select id, sla_expires_at, responded_at from lead_offer
     where lead_id = $1 and responded_at is null
     order by offered_at desc limit 1`,
    [input.leadId],
  );
  const open = rows[0];
  if (!open) return { expired: false, reoffered: false };
  if (open.sla_expires_at > clock.now()) return { expired: false, reoffered: false };

  await client.query(
    `update lead_offer
     set responded_at = $2, response = 'expired'
     where id = $1`,
    [open.id, clock.now()],
  );
  await emitDomainEvent(client, {
    aggregateType: 'lead_offer',
    aggregateId: open.id,
    eventType: 'lead_offer.sla_expired',
    payload: { lead_id: input.leadId },
    actorKind: 'system',
    occurredAt: clock.now(),
  });

  const re = await offerLeadToNextBroker(client, {
    leadId: input.leadId,
    clock,
  });
  return { expired: true, reoffered: re.offerId != null };
}
