import type { DbClient } from '../../db/pool.js';
import { resolveConfig } from '../config/index.js';

export type ScreeningFeeConfig = {
  default_cents: number;
  state_overrides: Record<string, { max_cents: number; note?: string }>;
};

export type ApplicableScreeningFee = {
  amount_cents: number;
  state: string | null;
  default_cents: number;
  capped: boolean;
  note: string | null;
};

const FALLBACK: ScreeningFeeConfig = {
  default_cents: 2900,
  state_overrides: {
    NY: { max_cents: 2000, note: 'RPL §238-a cap' },
  },
};

export async function resolveScreeningFeeConfig(
  client: DbClient,
  at = new Date(),
): Promise<ScreeningFeeConfig> {
  try {
    const cfg = await resolveConfig(client, 'screening_fee_by_state', at);
    const payload = (cfg?.payload ?? {}) as Partial<ScreeningFeeConfig>;
    return {
      default_cents: Number(payload.default_cents ?? FALLBACK.default_cents),
      state_overrides: payload.state_overrides ?? FALLBACK.state_overrides,
    };
  } catch {
    return FALLBACK;
  }
}

export function applyScreeningFee(
  config: ScreeningFeeConfig,
  state: string | null | undefined,
): ApplicableScreeningFee {
  const normalized = state?.trim().toUpperCase() || null;
  const override = normalized ? config.state_overrides[normalized] : undefined;
  if (override && override.max_cents < config.default_cents) {
    return {
      amount_cents: override.max_cents,
      state: normalized,
      default_cents: config.default_cents,
      capped: true,
      note: override.note ?? null,
    };
  }
  return {
    amount_cents: config.default_cents,
    state: normalized,
    default_cents: config.default_cents,
    capped: false,
    note: null,
  };
}

export async function screeningFeeForState(
  client: DbClient,
  state: string | null | undefined,
): Promise<ApplicableScreeningFee> {
  const config = await resolveScreeningFeeConfig(client);
  return applyScreeningFee(config, state);
}
