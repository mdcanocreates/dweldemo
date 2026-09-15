import { createHash, randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { resolveConfig } from '../config/index.js';
import { getObjectStore } from '../../infra/object-store/index.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';

export async function resolveRemittanceVarianceThresholdCents(
  client: DbClient,
  asOf = new Date(),
): Promise<number> {
  const cfg = await resolveConfig(client, 'solar_remittance', asOf);
  if (!cfg || cfg.variance_threshold_cents == null) {
    throw new AppError(
      'variance_threshold_cents missing from solar_remittance config',
      'config_required',
      500,
    );
  }
  return Number(cfg.variance_threshold_cents);
}

/**
 * Monthly proactive statement for prior calendar month installed deals.
 */
export async function generateSolarRemittanceStatement(
  client: DbClient,
  input: {
    partnerOrgId: string;
    periodStart: string;
    periodEnd: string;
    clock?: Clock;
  },
): Promise<{
  statementId: string;
  dealCount: number;
  expectedTotalCents: number;
  documentId: string;
}> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();

  const { rows: deals } = await client.query<{
    id: string;
    status: string;
    installed_at: Date | null;
    approved_cashback_cents: number;
    net_to_rbit_cents: string;
  }>(
    `select d.id, d.status, d.installed_at,
            uw.approved_cashback_cents, uw.net_to_rbit_cents::text
     from solar_deal d
     join lateral (
       select approved_cashback_cents, net_to_rbit_cents
       from solar_underwriting_decision u
       where u.solar_deal_id = d.id
       order by u.computed_at desc
       limit 1
     ) uw on true
     where d.partner_org_id = $1
       and d.status = 'installed'
       and d.installed_at::date >= $2::date
       and d.installed_at::date <= $3::date`,
    [input.partnerOrgId, input.periodStart, input.periodEnd],
  );

  let expectedTotal = 0;
  for (const d of deals) {
    expectedTotal += Number(d.net_to_rbit_cents);
  }

  const statementId = randomUUID();
  await client.query(
    `insert into solar_remittance_statement (
       id, partner_org_id, period_start, period_end, deal_count,
       expected_total_cents, generated_at, status
     ) values ($1,$2,$3::date,$4::date,$5,$6,$7,'draft')`,
    [
      statementId,
      input.partnerOrgId,
      input.periodStart,
      input.periodEnd,
      deals.length,
      expectedTotal,
      now,
    ],
  );

  for (const d of deals) {
    const remittance = Number(d.net_to_rbit_cents);
    await client.query(
      `insert into solar_remittance_statement_line (
         statement_id, solar_deal_id, approved_cashback_cents,
         net_to_rbit_cents, expected_remittance_cents, deal_installed_at, deal_status
       ) values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        statementId,
        d.id,
        d.approved_cashback_cents,
        Number(d.net_to_rbit_cents),
        remittance,
        d.installed_at,
        d.status,
      ],
    );
  }

  const pdfBody = Buffer.from(
    `RBIT Solar Remittance Statement\npartner=${input.partnerOrgId}\nperiod=${input.periodStart}..${input.periodEnd}\ndeals=${deals.length}\nexpected_cents=${expectedTotal}\n`,
    'utf8',
  );
  const storageKey = `solar/statements/${statementId}.pdf`;
  await getObjectStore().put({
    key: storageKey,
    body: pdfBody,
    contentType: 'application/pdf',
  });

  const documentId = randomUUID();
  const contentHash = createHash('sha256').update(pdfBody).digest('hex');
  await client.query(
    `insert into document (
       id, org_id, doc_type, retention_class, storage_key,
       content_hash, content_type, size_bytes, scan_status
     ) values ($1,$2,'solar_remittance_statement','standard',$3,$4,'application/pdf',$5,'clean')`,
    [documentId, input.partnerOrgId, storageKey, contentHash, pdfBody.length],
  );

  await client.query(
    `update solar_remittance_statement
     set document_id = $2, status = 'sent', sent_at = $3
     where id = $1`,
    [statementId, documentId, now],
  );

  await emitDomainEvent(client, {
    aggregateType: 'solar_remittance_statement',
    aggregateId: statementId,
    eventType: 'solar_remittance_statement.sent',
    payload: {
      partner_org_id: input.partnerOrgId,
      deal_count: deals.length,
      expected_total_cents: expectedTotal,
      document_id: documentId,
    },
    actorKind: 'system',
    occurredAt: now,
  });

  return {
    statementId,
    dealCount: deals.length,
    expectedTotalCents: expectedTotal,
    documentId,
  };
}

export async function matchRemittanceToStatement(
  client: DbClient,
  input: {
    statementId: string;
    receivedAmountCents: number;
    clock?: Clock;
  },
): Promise<{ status: 'matched' | 'variance'; varianceCents: number }> {
  const clock = input.clock ?? systemClock;
  const threshold = await resolveRemittanceVarianceThresholdCents(client, clock.now());

  const { rows } = await client.query<{ expected_total_cents: string }>(
    `select expected_total_cents::text from solar_remittance_statement where id = $1 for update`,
    [input.statementId],
  );
  if (!rows[0]) throw new AppError('statement not found', 'not_found', 404);

  const expected = Number(rows[0].expected_total_cents);
  const variance = Math.abs(input.receivedAmountCents - expected);
  const status = variance < threshold ? 'matched' : 'variance';

  await client.query(
    `update solar_remittance_statement set status = $2 where id = $1`,
    [input.statementId, status],
  );

  if (status === 'variance') {
    await emitDomainEvent(client, {
      aggregateType: 'solar_remittance_statement',
      aggregateId: input.statementId,
      eventType: 'solar_remittance_statement.variance',
      payload: {
        expected_total_cents: expected,
        received_amount_cents: input.receivedAmountCents,
        variance_cents: variance,
        threshold_cents: threshold,
      },
      actorKind: 'system',
      occurredAt: clock.now(),
    });
  }

  return { status, varianceCents: input.receivedAmountCents - expected };
}
