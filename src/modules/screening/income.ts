import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { appendAdminAction, emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import { resolveVerificationConfidence } from './config.js';
import { recomputeBadge } from './badge.js';
import { archiveVendorRequest, archiveVendorResponse, recordVendorCost } from './archive.js';
import { getVendorRegistry } from '../vendors/index.js';

export async function recordIncomeVerification(
  client: DbClient,
  input: {
    partyId: string;
    method: 'plaid_bank' | 'plaid_payroll' | 'vendor_payroll' | 'document' | 'stated';
    monthlyIncomeCents?: number | null;
    vendorRef?: string | null;
    evidenceRef?: string | null;
    applicationId?: string | null;
    clock?: Clock;
    useVendor?: boolean;
  },
): Promise<{ id: string; confidence: number }> {
  const clock = input.clock ?? systemClock;
  const confidence = await resolveVerificationConfidence(client, input.method, clock);
  let monthly = input.monthlyIncomeCents ?? null;
  let vendorRef = input.vendorRef ?? null;
  let costCents = 0;
  let vendorName = 'manual';

  if (input.useVendor !== false && (input.method.startsWith('plaid') || input.method === 'vendor_payroll')) {
    const correlationId = randomUUID();
    const income = getVendorRegistry().incomeVerification();
    vendorName = income.vendorName;
    await archiveVendorRequest(client, {
      vendor: vendorName,
      capability: 'income',
      correlationId,
      applicationId: input.applicationId,
      requestPayload: {
        party_id: input.partyId,
        method: input.method,
      },
    });
    const result = await income.verify(
      {
        partyId: input.partyId,
        method: input.method,
        statedMonthlyIncomeCents: input.monthlyIncomeCents ?? undefined,
      },
      {
        correlationId,
        partyId: input.partyId,
        applicationId: input.applicationId ?? undefined,
      },
    );
    monthly = result.monthlyIncomeCents;
    vendorRef = result.vendorRef;
    costCents = result.costCents;
    await archiveVendorResponse(client, {
      vendor: vendorName,
      capability: 'income',
      correlationId,
      applicationId: input.applicationId,
      responsePayload: {
        vendor_ref: result.vendorRef,
        status: result.status,
        monthly_income_cents: result.monthlyIncomeCents,
        method: result.method,
      },
    });
    if (costCents > 0) {
      await recordVendorCost(client, {
        vendor: vendorName,
        capability: 'income',
        amountCents: costCents,
        applicationId: input.applicationId,
        correlationId,
        occurredAt: clock.now(),
      });
    }
  }

  const id = randomUUID();
  await client.query(
    `insert into income_verification (
       id, party_id, method, confidence, monthly_income_cents,
       verified_at, vendor_ref, evidence_ref
     ) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      input.partyId,
      input.method,
      confidence,
      monthly,
      clock.now(),
      vendorRef,
      input.evidenceRef ?? null,
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'income_verification',
    aggregateId: id,
    eventType: 'income_verification.recorded',
    payload: {
      party_id: input.partyId,
      method: input.method,
      confidence,
      vendor: vendorName,
    },
    actorKind: 'system',
    occurredAt: clock.now(),
  });

  await recomputeBadge(client, input.partyId, clock);
  return { id, confidence };
}

export async function bestIncomeConfidence(
  client: DbClient,
  partyId: string,
): Promise<number> {
  const { rows } = await client.query<{ confidence: string }>(
    `select confidence::text from income_verification
     where party_id = $1
     order by confidence desc
     limit 1`,
    [partyId],
  );
  return rows[0] ? Number(rows[0].confidence) : 0;
}

export function assertMethodHierarchy(methods: string[]): void {
  // Scoring surface: plaid_bank > plaid_payroll > vendor_payroll > document > stated
  const rank: Record<string, number> = {
    plaid_bank: 5,
    plaid_payroll: 4,
    vendor_payroll: 3,
    document: 2,
    stated: 1,
  };
  for (const m of methods) {
    if (!(m in rank)) throw new AppError(`unknown income method ${m}`, 'invalid_method', 400);
  }
}
