/**
 * Dry-run reconciliation for extracted listing package JSON.
 * Does not execute package READMEs/prompts, send email, or publish listings.
 *
 * Usage:
 *   npx tsx scripts/external-listings/reconcile-packages.ts <packageRoot> [reportOut]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadPackageRecords, reconcilePackageRecords } from '../../src/modules/external-listings/index.js';

async function main(): Promise<void> {
  const packageRoot = process.argv[2];
  if (!packageRoot) {
    console.error('Usage: npx tsx scripts/external-listings/reconcile-packages.ts <packageRoot> [reportOut]');
    process.exit(2);
  }
  const reportOut =
    process.argv[3] ??
    path.resolve('evidence/external-listings/2026-11-02-reconciliation.json');

  const records = await loadPackageRecords(path.resolve(packageRoot));
  const report = reconcilePackageRecords(records, [path.resolve(packageRoot)]);
  await mkdir(path.dirname(reportOut), { recursive: true });
  await writeFile(reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    reportOut,
    recordsSeen: report.recordsSeen,
    distinctExternalIds: report.distinctExternalIds,
    distinctDealIds: report.dealIds.distinctDealIds,
    distinctHudIds: report.hudIds.distinctHudIds,
    sharedDealIds: report.dealIds.sharedObserved,
    sharedHudIds: report.hudIds.sharedObserved,
    addressCollisionGroups: report.addressCollisionGroups,
    rightsApprovedForPublish: report.rightsApprovedForPublish,
  }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
