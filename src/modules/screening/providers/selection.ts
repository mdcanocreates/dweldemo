import type { DbClient } from '../../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { emitDomainEvent } from '../../audit/index.js';
import { assessCertnAvailability } from '../../vendors/certn-availability.js';
import { assessCheckrAvailability } from '../../vendors/checkr/availability.js';
import type {
  ScreeningProviderId,
  ScreeningProviderSelection,
} from './types.js';

export type ProviderReadiness = {
  provider: ScreeningProviderId;
  infrastructureReady: boolean;
  reason: string | null;
  mode: string | null;
};

export function assessProviderInfrastructure(
  env: NodeJS.ProcessEnv = process.env,
): Record<ScreeningProviderId, ProviderReadiness> {
  const certn = assessCertnAvailability(env);
  const checkr = assessCheckrAvailability(env);
  return {
    certn: {
      provider: 'certn',
      infrastructureReady: certn.available,
      reason: certn.available ? null : certn.reason,
      mode: certn.available ? 'sandbox' : null,
    },
    checkr_tenant: {
      provider: 'checkr_tenant',
      infrastructureReady: checkr.available,
      reason: checkr.available ? null : checkr.reason,
      mode: checkr.available ? checkr.mode : null,
    },
  };
}

export async function getSelectedScreeningProvider(
  client: DbClient,
): Promise<ScreeningProviderSelection> {
  const { rows } = await client.query<{ selected_provider: ScreeningProviderSelection }>(
    `select selected_provider from screening_provider_setting where id = 'default'`,
  );
  return rows[0]?.selected_provider ?? 'disabled';
}

/**
 * Resolve provider for a NEW screening order.
 * Admin selection ∩ infrastructure readiness. Fail closed when disabled/misconfigured.
 */
export async function resolveProviderForNewScreening(
  client: DbClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScreeningProviderId> {
  const selected = await getSelectedScreeningProvider(client);
  if (selected === 'disabled') {
    throw new AppError(
      'screening provider disabled',
      'SCREENING_PROVIDER_UNAVAILABLE',
      503,
    );
  }
  const readiness = assessProviderInfrastructure(env)[selected];
  if (!readiness.infrastructureReady) {
    throw new AppError(
      `screening provider ${selected} not configured`,
      'SCREENING_PROVIDER_UNAVAILABLE',
      503,
    );
  }
  return selected;
}

export async function listSelectableProviders(
  client: DbClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  selected: ScreeningProviderSelection;
  providers: Array<ProviderReadiness & { selectable: boolean }>;
}> {
  const selected = await getSelectedScreeningProvider(client);
  const readiness = assessProviderInfrastructure(env);
  return {
    selected,
    providers: (Object.values(readiness) as ProviderReadiness[]).map((p) => ({
      ...p,
      selectable: p.infrastructureReady,
    })),
  };
}

/**
 * Super-admin only. Only allow selecting infrastructure-ready providers (or disabled).
 * Persists audit row with actor, timestamp, old/new.
 */
export async function setSelectedScreeningProvider(
  client: DbClient,
  input: {
    provider: ScreeningProviderSelection;
    actorPartyId: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ previous: ScreeningProviderSelection; selected: ScreeningProviderSelection }> {
  if (input.provider !== 'disabled') {
    const readiness = assessProviderInfrastructure(env)[input.provider];
    if (!readiness.infrastructureReady) {
      throw new AppError(
        `cannot select ${input.provider}: infrastructure not ready (${readiness.reason})`,
        'screening_provider_not_ready',
        422,
      );
    }
  }

  const { rows: prev } = await client.query<{ selected_provider: ScreeningProviderSelection }>(
    `select selected_provider from screening_provider_setting where id = 'default' for update`,
  );
  const previous = prev[0]?.selected_provider ?? 'disabled';
  if (previous === input.provider) {
    return { previous, selected: input.provider };
  }

  await client.query(
    `update screening_provider_setting
     set selected_provider = $1, updated_at = now(), updated_by_party_id = $2
     where id = 'default'`,
    [input.provider, input.actorPartyId],
  );
  await client.query(
    `insert into screening_provider_setting_change (previous_value, new_value, actor_party_id)
     values ($1,$2,$3)`,
    [previous, input.provider, input.actorPartyId],
  );
  await emitDomainEvent(client, {
    aggregateType: 'screening_provider_setting',
    aggregateId: 'default',
    eventType: 'screening_provider.default_changed',
    payload: { previous, selected: input.provider },
    actorPartyId: input.actorPartyId,
    actorKind: 'admin',
  });

  return { previous, selected: input.provider };
}

export async function listProviderSettingHistory(
  client: DbClient,
  limit = 50,
): Promise<
  Array<{
    id: string;
    previous_value: string;
    new_value: string;
    actor_party_id: string;
    created_at: Date;
  }>
> {
  const { rows } = await client.query(
    `select id, previous_value, new_value, actor_party_id, created_at
     from screening_provider_setting_change
     order by created_at desc
     limit $1`,
    [Math.min(limit, 200)],
  );
  return rows;
}
