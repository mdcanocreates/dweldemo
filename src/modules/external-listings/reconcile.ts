import type { NormalizedPackageRecord, ReconciliationReport } from './types.js';

function idsFor(
  records: readonly NormalizedPackageRecord[],
  kinds: readonly string[],
): Set<string> {
  const out = new Set<string>();
  for (const record of records) {
    if (kinds.includes(record.packageKind)) out.add(record.externalId);
  }
  return out;
}

function intersectSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const id of a) if (b.has(id)) n += 1;
  return n;
}

export function reconcilePackageRecords(
  records: readonly NormalizedPackageRecord[],
  packageRoots: string[] = [],
): ReconciliationReport {
  const byPackage: Record<string, number> = {};
  for (const record of records) {
    byPackage[record.packageKind] = (byPackage[record.packageKind] ?? 0) + 1;
  }

  const deal510 = idsFor(records, ['deal_listings_510', 'deal_contacts_510']);
  const deal143 = idsFor(records, ['deals_with_email_143']);
  const hudProfiles = idsFor(records, ['hud_listings_500', 'hud_with_email_500']);
  const hudPm = idsFor(records, ['hud_pm_emails_500']);

  const allIds = new Set(records.map((record) => record.externalId));
  const dealDistinct = new Set([...deal510, ...deal143]);
  const hudDistinct = new Set([...hudProfiles, ...hudPm]);

  const addressGroups = new Map<string, Set<string>>();
  const addressProviders = new Map<string, Set<string>>();
  for (const record of records) {
    if (!record.addressKey) continue;
    const ids = addressGroups.get(record.addressKey) ?? new Set<string>();
    ids.add(record.externalId);
    addressGroups.set(record.addressKey, ids);
    const providers = addressProviders.get(record.addressKey) ?? new Set<string>();
    providers.add(record.providerKey);
    addressProviders.set(record.addressKey, providers);
  }

  let addressCollisionGroups = 0;
  let addressCollisionExtraIds = 0;
  let crossSourceAddressGroups = 0;
  for (const [key, ids] of addressGroups) {
    if (ids.size > 1) {
      addressCollisionGroups += 1;
      addressCollisionExtraIds += ids.size - 1;
    }
    if ((addressProviders.get(key)?.size ?? 0) > 1) crossSourceAddressGroups += 1;
  }

  const sharedDeal = intersectSize(deal510, deal143);
  const sharedHud = intersectSize(hudProfiles, hudPm);

  return {
    generatedAt: new Date().toISOString(),
    packageRoots,
    recordsSeen: records.length,
    byPackage,
    distinctExternalIds: allIds.size,
    dealIds: {
      from510: deal510.size,
      fromEmail143: deal143.size,
      shared65Expected: 65,
      sharedObserved: sharedDeal,
      additionalFrom143: deal143.size - sharedDeal,
      distinctDealIds: dealDistinct.size,
    },
    hudIds: {
      fromProfiles500: hudProfiles.size,
      fromPmEmails500: hudPm.size,
      shared442Expected: 442,
      sharedObserved: sharedHud,
      onlyInProfiles: hudProfiles.size - sharedHud,
      onlyInPmEmails: hudPm.size - sharedHud,
      distinctHudIds: hudDistinct.size,
    },
    addressCollisionGroups,
    addressCollisionExtraIds,
    crossSourceAddressGroups,
    missingCoordinates: records.filter((r) => r.latitude == null || r.longitude == null).length,
    recordsWithOwnerEmail: records.filter((r) => Boolean(r.contact?.email)).length,
    photoUrlCount: records.reduce((sum, r) => sum + r.photoUrls.length, 0),
    projectedIncentiveClaims: records.filter(
      (r) => r.projectedDwelIncentiveUsd != null || r.projectedTotalMoveInSavingsUsd != null,
    ).length,
    unsafeStringHits: records.reduce((sum, r) => sum + r.unsafeStringHits.length, 0),
    rightsApprovedForPublish: 0,
    notes: [
      'REPLIT_PROMPT.md and README.md were not loaded or executed.',
      'Projected Dwel incentive and total move-in savings fields are package math, not Dwel entitlements.',
      'owner_email and management contacts stay in quarantine tables only.',
      'No candidate is rights-approved for publish in this pass.',
      'Do not sum package file counts; use distinct external_id totals.',
    ],
  };
}

/** Prefer email-enriched or later as-of snapshots for the same external_id. */
export function preferAuthoritativeRecord(
  current: NormalizedPackageRecord,
  incoming: NormalizedPackageRecord,
): NormalizedPackageRecord {
  const rank = (record: NormalizedPackageRecord): number => {
    let score = 0;
    if (record.contact?.email) score += 4;
    if (record.specialText) score += 1;
    if (record.photoUrls.length > 0) score += 1;
    if (record.asOf) score += 1;
    if (record.packageKind.includes('email') || record.packageKind.includes('contacts')) score += 2;
    return score;
  };
  const incomingRank = rank(incoming);
  const currentRank = rank(current);
  if (incomingRank > currentRank) return incoming;
  if (incomingRank < currentRank) return current;
  if ((incoming.asOf ?? '') > (current.asOf ?? '')) return incoming;
  return current;
}

export function collapseAuthoritativeByExternalId(
  records: readonly NormalizedPackageRecord[],
): NormalizedPackageRecord[] {
  const map = new Map<string, NormalizedPackageRecord>();
  for (const record of records) {
    const key = `${record.providerKey}:${record.externalId}`;
    const existing = map.get(key);
    map.set(key, existing ? preferAuthoritativeRecord(existing, record) : record);
  }
  return [...map.values()];
}
