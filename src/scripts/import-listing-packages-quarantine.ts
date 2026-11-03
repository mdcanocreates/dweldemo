/**
 * Dry-run or quarantine-write for listingpackages ZIP extracts.
 * Never publishes public listings.
 */
import pg from 'pg';
import { resolveDatabaseUrl } from '../db/database-url.js';
import { loadRdsSslConfig } from '../db/rds-ssl.js';
import type { DbClient } from '../db/pool.js';
import {
  importExternalListingPackages,
  loadPackageRecords,
} from '../modules/external-listings/index.js';

const { Client } = pg;

function resolveSsl(): pg.ClientConfig['ssl'] | undefined {
  const caPath = process.env.RDS_CA_BUNDLE_PATH ?? '/certs/rds-global-bundle.pem';
  try {
    return loadRdsSslConfig(caPath);
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const packageRoot = process.env.PACKAGE_ROOT?.trim();
  if (!packageRoot) throw new Error('PACKAGE_ROOT is required');
  const dryRun = process.env.DRY_RUN !== '0';
  const batchId =
    process.env.BATCH_ID?.trim() ||
    `zip-quarantine-${new Date().toISOString().slice(0, 10)}`;

  const records = await loadPackageRecords(packageRoot);
  const client = new Client({
    connectionString: resolveDatabaseUrl(),
    ssl: resolveSsl(),
  });
  await client.connect();
  try {
    await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
    const result = await importExternalListingPackages(client as unknown as DbClient, {
      batchId,
      packageRoot,
      records,
      dryRun,
    });
    console.log(
      JSON.stringify(
        {
          batchId,
          mode: result.mode,
          recordsSeen: result.report.recordsSeen,
          distinctExternalIds: result.report.distinctExternalIds,
          dealIds: result.report.dealIds,
          hudIds: result.report.hudIds,
          addressCollisionGroups: result.report.addressCollisionGroups,
          rightsApprovedForPublish: result.report.rightsApprovedForPublish,
          snapshotsWritten: result.snapshotsWritten,
          candidatesWritten: result.candidatesWritten,
          contactsWritten: result.contactsWritten,
          offersWritten: result.offersWritten,
          publishedListingsTouched: result.publishedListingsTouched,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
