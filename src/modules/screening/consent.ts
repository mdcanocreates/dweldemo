import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { resolveConfig } from '../config/index.js';
import { emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';

/**
 * Resolve the active screening disclosure version for the environment.
 * Fails closed when not configured — no default, no placeholder text.
 */
export async function resolveDisclosureVersion(
  client: DbClient,
  asOf: Date,
): Promise<string> {
  const cfg = await resolveConfig(client, 'screening_disclosure', asOf);
  const version = cfg?.disclosure_version;
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new AppError(
      'screening_disclosure.disclosure_version not configured',
      'disclosure_version_required',
      503,
    );
  }
  return version.trim();
}

export type RecordScreeningConsentInput = {
  applicationId: string;
  /** When omitted, server resolves from screening_disclosure config (fail closed). */
  disclosureVersion?: string;
  consentIp?: string | null;
  consentUserAgent?: string | null;
  clock?: Clock;
};

/**
 * Persist application-scoped screening consent.
 * disclosure_version is taken from trusted config unless an exact match is supplied
 * (tests may pass the configured version explicitly).
 */
export async function recordScreeningConsent(
  client: DbClient,
  input: RecordScreeningConsentInput,
): Promise<{ consentId: string; disclosureVersion: string }> {
  const clock = input.clock ?? systemClock;
  const configured = await resolveDisclosureVersion(client, clock.now());
  if (input.disclosureVersion != null && input.disclosureVersion !== configured) {
    throw new AppError(
      'disclosure version mismatch',
      'disclosure_version_mismatch',
      409,
    );
  }
  const disclosureVersion = configured;

  const { rows: apps } = await client.query<{ id: string }>(
    `select id from application where id = $1`,
    [input.applicationId],
  );
  if (!apps[0]) {
    throw new AppError('application not found', 'application_not_found', 404);
  }

  const consentId = randomUUID();
  try {
    await client.query(
      `insert into screening_consent (
         id, application_id, disclosure_version, consented_at, consent_ip, consent_user_agent
       ) values ($1::uuid, $2, $3, $4, $5::inet, $6)`,
      [
        consentId,
        input.applicationId,
        disclosureVersion,
        clock.now(),
        input.consentIp ?? null,
        input.consentUserAgent ?? null,
      ],
    );
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      throw new AppError(
        'screening consent already recorded',
        'screening_consent_exists',
        409,
      );
    }
    throw err;
  }

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: input.applicationId,
    eventType: 'application.screening_consent_recorded',
    payload: { disclosure_version: disclosureVersion },
    actorKind: 'user',
    occurredAt: clock.now(),
  });

  return { consentId, disclosureVersion };
}

export async function assertScreeningConsentRecorded(
  client: DbClient,
  applicationId: string,
): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `select id from screening_consent where application_id = $1`,
    [applicationId],
  );
  if (!rows[0]) {
    throw new AppError(
      'screening consent required before authorization',
      'screening_consent_required',
      422,
    );
  }
}
