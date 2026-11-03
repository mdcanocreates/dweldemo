import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertNoPublicContactLeak,
  collapseAuthoritativeByExternalId,
  loadPackageRecords,
  parseOfferType,
  reconcilePackageRecords,
  toPublicSafeCandidate,
} from '../../src/modules/external-listings/index.js';

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/external-listings/mini-packages',
);

describe('external listing quarantine', () => {
  it('reconciles overlapping deal and HUD ids without summing package counts', async () => {
    const records = await loadPackageRecords(fixtureRoot);
    const report = reconcilePackageRecords(records, [fixtureRoot]);

    expect(report.recordsSeen).toBeGreaterThan(report.distinctExternalIds);
    expect(report.dealIds.sharedObserved).toBe(1);
    expect(report.dealIds.additionalFrom143).toBe(1);
    expect(report.dealIds.distinctDealIds).toBe(3);
    expect(report.hudIds.sharedObserved).toBe(1);
    expect(report.hudIds.onlyInProfiles).toBe(2);
    expect(report.hudIds.onlyInPmEmails).toBe(1);
    expect(report.addressCollisionGroups).toBeGreaterThanOrEqual(1);
    expect(report.crossSourceAddressGroups).toBeGreaterThanOrEqual(1);
    expect(report.rightsApprovedForPublish).toBe(0);
    expect(report.projectedIncentiveClaims).toBeGreaterThan(0);
  });

  it('prefers email-enriched deal snapshots and keeps offers as property-advertised text', async () => {
    const records = await loadPackageRecords(fixtureRoot);
    const collapsed = collapseAuthoritativeByExternalId(records);
    const shared = collapsed.find((row) => row.externalId === 'rent_shared_1');
    expect(shared?.contact?.email).toBe('manager@example.test');
    expect(parseOfferType('8 weeks free', ['8 weeks free'])).toBe('weeks_free');
    expect(parseOfferType('6 weeks free', [])).toBe('weeks_free');
  });

  it('strips contacts and projected Dwel math from public-safe shapes', async () => {
    const records = await loadPackageRecords(fixtureRoot);
    const withEmail = records.find((row) => row.contact?.email);
    expect(withEmail).toBeTruthy();
    const safe = toPublicSafeCandidate(withEmail!);
    expect(assertNoPublicContactLeak(safe)).toEqual([]);
    expect(safe).not.toHaveProperty('owner_email');
    expect(safe.contacts_omitted).toBe(true);
    expect(safe.photos_omitted).toBe(true);
    expect(safe).not.toHaveProperty('dwel_incentive_estimate_usd');
    expect(safe).not.toHaveProperty('total_move_in_savings_estimate_usd');
  });
});
