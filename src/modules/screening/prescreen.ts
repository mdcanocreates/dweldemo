import type { DbClient } from '../../db/pool.js';
import { appendAdminAction, emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { runDevicePrescreen } from './device-prescreen.js';

export type PrescreenInput = {
  applicationId: string;
  partyId: string;
  orgId: string;
  rentMaxCents?: number | null;
  listingRentCents?: number | null;
  statedMonthlyIncomeCents?: number | null;
  householdSize?: number | null;
  deviceId?: string | null;
};

export type PrescreenResult = {
  passed: boolean;
  reasonCodes: string[];
  /** Device gate failure — stay at prescreen_failed; generic applicant message. */
  deviceGate?: {
    failed: boolean;
    applicantMessage: string;
    signalId: string | null;
    breachReasons: string[];
  };
};

/**
 * Cheap rules filter before any paid vendor call (§7.7 + B-3 device gate).
 * Never rejects on a protected characteristic.
 * Device threshold breaches do not auto-confirm fraud — review queue only.
 */
export async function runPrescreen(
  client: DbClient,
  input: PrescreenInput,
  clock: Clock = systemClock,
): Promise<PrescreenResult> {
  const reasonCodes: string[] = [];
  const now = clock.now();

  if (input.deviceId) {
    const device = await runDevicePrescreen(client, {
      applicationId: input.applicationId,
      partyId: input.partyId,
      deviceId: input.deviceId,
      clock,
    });
    if (!device.passed) {
      await appendAdminAction(client, {
        actorPartyId: input.partyId,
        action: 'application.prescreen',
        targetType: 'application',
        targetId: input.applicationId,
        afterState: {
          passed: false,
          device_gate: true,
          breach_reasons: device.breachReasons,
        },
      });
      return {
        passed: false,
        reasonCodes: [],
        deviceGate: {
          failed: true,
          applicantMessage: device.applicantMessage,
          signalId: device.signalId,
          breachReasons: device.breachReasons,
        },
      };
    }
  }

  // Income-to-rent: if both present, require >= 2.5× (config-free structural check;
  // ratio threshold could move to config later — not a pricing constant).
  if (
    input.statedMonthlyIncomeCents != null &&
    input.listingRentCents != null &&
    input.listingRentCents > 0
  ) {
    const ratio = input.statedMonthlyIncomeCents / input.listingRentCents;
    if (ratio < 2.5) {
      reasonCodes.push('income_to_rent_below_threshold');
    }
  }

  if (input.householdSize != null && input.householdSize < 1) {
    reasonCodes.push('invalid_household_size');
  }

  // Incomplete application structural checks
  if (input.listingRentCents == null && input.rentMaxCents == null) {
    reasonCodes.push('missing_rent_context');
  }

  const passed = reasonCodes.length === 0;

  await appendAdminAction(client, {
    actorPartyId: input.partyId,
    action: 'application.prescreen',
    targetType: 'application',
    targetId: input.applicationId,
    afterState: { passed, reason_codes: reasonCodes },
  });

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: input.applicationId,
    eventType: passed ? 'application.prescreen_passed' : 'application.prescreen_failed',
    payload: { reason_codes: reasonCodes, passed },
    actorPartyId: input.partyId,
    actorKind: 'system',
    occurredAt: now,
  });

  return { passed, reasonCodes };
}
