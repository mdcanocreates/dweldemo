/**
 * TEST_ONLY / evidence helper — §10.3 tier table for assertions.
 * Production fee amounts live in config_version (migrations/0040), not in src/.
 */
export type PriceBookTierSeed = {
  tier: string;
  rentMinCents: number;
  rentMaxCents: number | null;
  feeCents: number;
};

export function specSeedPriceBookTiers(): PriceBookTierSeed[] {
  return [
    { tier: 'RS-1', rentMinCents: 80000, rentMaxCents: 119900, feeCents: 6500 },
    { tier: 'RS-2', rentMinCents: 120000, rentMaxCents: 159900, feeCents: 9000 },
    { tier: 'RS-3', rentMinCents: 160000, rentMaxCents: 199900, feeCents: 11500 },
    { tier: 'RS-4', rentMinCents: 200000, rentMaxCents: 249900, feeCents: 14000 },
    { tier: 'RS-5', rentMinCents: 250000, rentMaxCents: 299900, feeCents: 17000 },
    { tier: 'RS-6', rentMinCents: 300000, rentMaxCents: 399900, feeCents: 21000 },
    { tier: 'RS-7', rentMinCents: 400000, rentMaxCents: 599900, feeCents: 29000 },
    { tier: 'RS-8', rentMinCents: 600000, rentMaxCents: 899900, feeCents: 43000 },
    { tier: 'RS-9', rentMinCents: 900000, rentMaxCents: 1499900, feeCents: 66500 },
    { tier: 'RS-10', rentMinCents: 1500000, rentMaxCents: 2499900, feeCents: 107000 },
    { tier: 'RS-11', rentMinCents: 2500000, rentMaxCents: 4499900, feeCents: 182000 },
    { tier: 'RS-12', rentMinCents: 4500000, rentMaxCents: null, feeCents: 240000 },
  ];
}

export function tiersAsConfigPayload(): Array<{
  tier: string;
  rent_min_cents: number;
  rent_max_cents: number | null;
  fee_cents: number;
}> {
  return specSeedPriceBookTiers().map((t) => ({
    tier: t.tier,
    rent_min_cents: t.rentMinCents,
    rent_max_cents: t.rentMaxCents,
    fee_cents: t.feeCents,
  }));
}
