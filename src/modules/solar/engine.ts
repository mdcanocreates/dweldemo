/**
 * Two-equation solar underwriting engine (§13.3).
 * Pure function of input_snapshot + config — no DB I/O.
 * Registered as model_key='solar_underwriting', kind='rules'.
 */

export const SOLAR_ENGINE_MODEL_KEY = 'solar_underwriting';
export const SOLAR_ENGINE_VERSION = 'rules-v1';

export type UnderwritingInput = {
  system_size_kw: number;
  gross_project_cost_cents: number;
  sale_price_cents: number;
  redline_cents: number | null;
  /** Snapshot of underwriting config payload at decision time */
  underwriting_config: {
    installed_cost_basis_cents_per_watt: number;
    net_profit_pool_bps: number;
    rbit_share_of_net_bps: number;
    net_to_rbit_floor_cents: number;
    minimum_viable_cashback_cents: number;
  };
  /** Snapshot of resolved tier */
  tier: number;
  tier_cap_cents: number;
  tiers_config_version_id: string;
  underwriting_config_version_id: string;
};

export type UnderwritingResult = {
  tier: number;
  tier_cap_cents: number;
  equation_1_passed: boolean;
  equation_1_net_to_rbit_cents: number;
  equation_2_applied: boolean;
  adjusted_cap_cents: number | null;
  approved_cashback_cents: number;
  net_to_rbit_cents: number;
  decision: 'approved' | 'declined';
  decline_reason: string | null;
  expected_profit_share_cents: number;
  installed_cost_cents: number;
  explanation: Record<string, unknown>;
  input_snapshot: UnderwritingInput;
};

/** Integer-cent expected profit share: gross × pool_bps × share_bps / 100_000_000 */
export function computeExpectedProfitShareCents(
  grossProjectCostCents: number,
  netProfitPoolBps: number,
  rbitShareOfNetBps: number,
): number {
  return Math.floor(
    (grossProjectCostCents * netProfitPoolBps * rbitShareOfNetBps) / 100_000_000,
  );
}

export function runSolarUnderwriting(input: UnderwritingInput): UnderwritingResult {
  const cfg = input.underwriting_config;
  const installedCostCents = Math.round(
    input.system_size_kw * 1000 * cfg.installed_cost_basis_cents_per_watt,
  );
  const expectedProfitShare = computeExpectedProfitShareCents(
    input.gross_project_cost_cents,
    cfg.net_profit_pool_bps,
    cfg.rbit_share_of_net_bps,
  );
  const tierCap = input.tier_cap_cents;
  const floor = cfg.net_to_rbit_floor_cents;
  const minViable = cfg.minimum_viable_cashback_cents;

  // Equation 1 — floor check at full tier cap
  const eq1Net = expectedProfitShare - tierCap;
  if (eq1Net >= floor) {
    const explanation = {
      path: 'equation_1',
      binding_constraint: null,
      message:
        'Net-to-RBIT at full tier cap meets or exceeds floor; approve at full cap.',
      expected_profit_share_cents: expectedProfitShare,
      tier_cap_cents: tierCap,
      net_to_rbit_at_full_cap_cents: eq1Net,
      floor_cents: floor,
      installed_cost_cents: installedCostCents,
    };
    return {
      tier: input.tier,
      tier_cap_cents: tierCap,
      equation_1_passed: true,
      equation_1_net_to_rbit_cents: eq1Net,
      equation_2_applied: false,
      adjusted_cap_cents: null,
      approved_cashback_cents: tierCap,
      net_to_rbit_cents: eq1Net,
      decision: 'approved',
      decline_reason: null,
      expected_profit_share_cents: expectedProfitShare,
      installed_cost_cents: installedCostCents,
      explanation,
      input_snapshot: input,
    };
  }

  // Equation 2 — backward solve for adjusted cap leaving net-to-RBIT at exactly floor
  const adjusted = expectedProfitShare - floor;
  const explanationBase = {
    path: 'equation_2',
    binding_constraint: 'net_to_rbit_floor',
    message:
      'Equation 1 failed; solved maximum cashback that leaves net-to-RBIT at the configured floor.',
    expected_profit_share_cents: expectedProfitShare,
    tier_cap_cents: tierCap,
    equation_1_net_to_rbit_cents: eq1Net,
    floor_cents: floor,
    solved_adjusted_cap_cents: adjusted,
    minimum_viable_cashback_cents: minViable,
    installed_cost_cents: installedCostCents,
  };

  if (adjusted < minViable) {
    return {
      tier: input.tier,
      tier_cap_cents: tierCap,
      equation_1_passed: false,
      equation_1_net_to_rbit_cents: eq1Net,
      equation_2_applied: true,
      adjusted_cap_cents: adjusted,
      approved_cashback_cents: 0,
      net_to_rbit_cents: expectedProfitShare, // no cashback paid
      decision: 'declined',
      decline_reason: 'solved_cap_below_minimum_viable',
      expected_profit_share_cents: expectedProfitShare,
      installed_cost_cents: installedCostCents,
      explanation: {
        ...explanationBase,
        decision: 'declined',
        reason: 'solved_cap_below_minimum_viable',
      },
      input_snapshot: input,
    };
  }

  return {
    tier: input.tier,
    tier_cap_cents: tierCap,
    equation_1_passed: false,
    equation_1_net_to_rbit_cents: eq1Net,
    equation_2_applied: true,
    adjusted_cap_cents: adjusted,
    approved_cashback_cents: adjusted,
    net_to_rbit_cents: floor,
    decision: 'approved',
    decline_reason: null,
    expected_profit_share_cents: expectedProfitShare,
    installed_cost_cents: installedCostCents,
    explanation: {
      ...explanationBase,
      decision: 'approved',
    },
    input_snapshot: input,
  };
}

/** Reproducibility: replay a stored input_snapshot through the named engine version. */
export function replaySolarUnderwriting(
  inputSnapshot: UnderwritingInput,
  engineVersion: string,
): UnderwritingResult {
  if (engineVersion !== SOLAR_ENGINE_VERSION) {
    throw new Error(`unknown solar engine_version: ${engineVersion}`);
  }
  return runSolarUnderwriting(inputSnapshot);
}
