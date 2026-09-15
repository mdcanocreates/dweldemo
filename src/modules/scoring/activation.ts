/**
 * Model activation via config only when gate.met === true (§17 Phase 7).
 */

import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import { evaluatePhase7Gate } from './gate.js';
import { RENTER_SCORE_MODEL_KEY, RULES_V0_VERSION } from './types.js';

export type ActivationResult = {
  activated: boolean;
  modelKey: string;
  version: string;
  gateMet: boolean;
  reason: string;
};

/**
 * Activate a model_registry row. ML activation is blocked unless Phase 7 gate met.
 * Rules models (e.g. rules-v0) may remain / be (re)activated without the ML gate.
 */
export async function activateModelViaConfig(
  client: DbClient,
  input: {
    modelKey: string;
    version: string;
    actorPartyId?: string | null;
  },
  clock: Clock = systemClock,
): Promise<ActivationResult> {
  const { rows } = await client.query<{
    id: string;
    kind: string;
    activated_at: Date | null;
  }>(
    `select id, kind, activated_at from model_registry
     where model_key = $1 and version = $2`,
    [input.modelKey, input.version],
  );
  const model = rows[0];
  if (!model) {
    throw new AppError('model not found in registry', 'model_not_found', 404);
  }

  const gate = await evaluatePhase7Gate(client, clock);

  if (model.kind === 'ml' && !gate.met) {
    return {
      activated: false,
      modelKey: input.modelKey,
      version: input.version,
      gateMet: false,
      reason: gate.reason,
    };
  }

  const now = clock.now();

  // Retire other active versions of the same key
  await client.query(
    `update model_registry
     set retired_at = $3
     where model_key = $1
       and version <> $2
       and activated_at is not null
       and (retired_at is null or retired_at > $3)`,
    [input.modelKey, input.version, now],
  );

  await client.query(
    `update model_registry
     set activated_at = coalesce(activated_at, $3), retired_at = null
     where model_key = $1 and version = $2`,
    [input.modelKey, input.version, now],
  );

  await emitDomainEvent(client, {
    aggregateType: 'model_registry',
    aggregateId: model.id,
    eventType: 'model.activated',
    payload: {
      model_key: input.modelKey,
      version: input.version,
      kind: model.kind,
      gate_met: gate.met,
    },
    actorKind: input.actorPartyId ? 'admin' : 'system',
    actorPartyId: input.actorPartyId ?? undefined,
  });

  return {
    activated: true,
    modelKey: input.modelKey,
    version: input.version,
    gateMet: gate.met,
    reason: model.kind === 'ml' ? 'ML activated after gate met' : 'rules model activated',
  };
}

/** Convenience: attempt to activate ML candidate — must no-op / refuse when unmet. */
export async function tryActivateMlCandidate(
  client: DbClient,
  version = 'ml-v1-candidate',
  clock: Clock = systemClock,
): Promise<ActivationResult> {
  return activateModelViaConfig(
    client,
    { modelKey: RENTER_SCORE_MODEL_KEY, version },
    clock,
  );
}

/** Ensure rules-v0 stays the live scorer when gate unmet. */
export async function assertRulesV0ActiveWhenGateUnmet(
  client: DbClient,
  clock: Clock = systemClock,
): Promise<void> {
  const gate = await evaluatePhase7Gate(client, clock);
  if (gate.met) return;

  const { rows } = await client.query<{ version: string; kind: string }>(
    `select version, kind from model_registry
     where model_key = $1
       and activated_at is not null
       and (retired_at is null or retired_at > now())`,
    [RENTER_SCORE_MODEL_KEY],
  );

  const mlActive = rows.some((r) => r.kind === 'ml');
  if (mlActive) {
    throw new AppError(
      'ML model active while Phase 7 gate unmet',
      'phase7_ml_illegally_active',
      500,
    );
  }

  const rulesActive = rows.some((r) => r.version === RULES_V0_VERSION);
  if (!rulesActive) {
    throw new AppError(
      'rules-v0 must remain active while gate unmet',
      'phase7_rules_v0_inactive',
      500,
    );
  }
}
