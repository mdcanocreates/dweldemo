import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizePackageRecord } from './normalize.js';
import type { NormalizedPackageRecord, PackageKind } from './types.js';

export type PackageFileSpec = {
  packageKind: PackageKind;
  packageName: string;
  providerKey: string;
  relativePath: string;
};

/** Known data files only. README / REPLIT_PROMPT files are intentionally omitted. */
export const PACKAGE_FILE_SPECS: PackageFileSpec[] = [
  {
    packageKind: 'deal_listings_510',
    packageName: 'Dwel_Deal_Listings_510',
    providerKey: 'rent_com_deal_package',
    relativePath: 'Dwel_Deal_Listings_510/dwel_deal_listings.json',
  },
  {
    packageKind: 'deal_contacts_510',
    packageName: 'Dwel_Deal_Contacts',
    providerKey: 'rent_com_deal_package',
    relativePath: 'Dwel_Deal_Contacts/dwel_deal_listings.json',
  },
  {
    packageKind: 'deals_with_email_143',
    packageName: 'Dwel_Listings_With_Emails_643',
    providerKey: 'rent_com_deal_package',
    relativePath: 'Dwel_Listings_With_Emails_643/dwel_deals_with_email.json',
  },
  {
    packageKind: 'hud_with_email_500',
    packageName: 'Dwel_Listings_With_Emails_643',
    providerKey: 'hud_assisted_package',
    relativePath: 'Dwel_Listings_With_Emails_643/dwel_hud_with_email.json',
  },
  {
    packageKind: 'hud_listings_500',
    packageName: 'Dwel_HUD_500_Listings',
    providerKey: 'hud_assisted_package',
    relativePath: 'Dwel_HUD_500_Listings/dwel_hud_listings.json',
  },
  {
    packageKind: 'hud_pm_emails_500',
    packageName: 'Dwel_HUD_500_PM_Emails',
    providerKey: 'hud_assisted_package',
    relativePath: 'Dwel_HUD_500_PM_Emails/hud_pm_email_listings.json',
  },
];

export async function loadPackageRecords(
  packageRoot: string,
  specs: PackageFileSpec[] = PACKAGE_FILE_SPECS,
): Promise<NormalizedPackageRecord[]> {
  const out: NormalizedPackageRecord[] = [];
  for (const spec of specs) {
    const full = path.join(packageRoot, spec.relativePath);
    const rawText = await readFile(full, 'utf8');
    const parsed = JSON.parse(rawText) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`expected array in ${spec.relativePath}`);
    }
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const normalized = normalizePackageRecord(
        spec.packageKind,
        spec.packageName,
        spec.providerKey,
        item as Record<string, unknown>,
      );
      if (normalized) out.push(normalized);
    }
  }
  return out;
}
