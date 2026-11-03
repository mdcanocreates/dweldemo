import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  importExternalListingPackages,
  loadPackageRecords,
} from '../../src/modules/external-listings/index.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/external-listings/mini-packages',
);

describe('external listing quarantine import', () => {
  let db: TestDb;
  let appPool: DbPool;

  beforeAll(async () => {
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
  }, 180_000);

  afterAll(async () => {
    await appPool?.end();
    await db?.stop();
  });

  it('dry-runs without writing candidates and never touches public listings', async () => {
    const records = await loadPackageRecords(fixtureRoot);
    const before = await withBypass(db.pool, async (client) => {
      const listings = await client.query<{ count: string }>(`select count(*)::text as count from listing`);
      return Number(listings.rows[0]!.count);
    });

    const result = await withBypass(db.pool, (client) =>
      importExternalListingPackages(client, {
        batchId: 'dry-run-mini-1',
        packageRoot: fixtureRoot,
        records,
        dryRun: true,
      }),
    );

    expect(result.mode).toBe('dry_run');
    expect(result.publishedListingsTouched).toBe(0);
    expect(result.candidatesWritten).toBe(0);
    expect(result.snapshotsWritten).toBe(0);

    await withBypass(db.pool, async (client) => {
      const candidates = await client.query<{ count: string }>(
        `select count(*)::text as count from external_property_candidate`,
      );
      const listings = await client.query<{ count: string }>(`select count(*)::text as count from listing`);
      const runs = await client.query<{ mode: string }>(
        `select mode from external_import_run where batch_id = 'dry-run-mini-1'`,
      );
      expect(Number(candidates.rows[0]!.count)).toBe(0);
      expect(Number(listings.rows[0]!.count)).toBe(before);
      expect(runs.rows[0]?.mode).toBe('dry_run');
    });
  });

  it('writes quarantine rows idempotently without publishing or leaking contacts to listing', async () => {
    const records = await loadPackageRecords(fixtureRoot);
    const first = await withBypass(db.pool, (client) =>
      importExternalListingPackages(client, {
        batchId: 'quarantine-mini-1',
        packageRoot: fixtureRoot,
        records,
        dryRun: false,
      }),
    );
    const second = await withBypass(db.pool, (client) =>
      importExternalListingPackages(client, {
        batchId: 'quarantine-mini-1-retry',
        packageRoot: fixtureRoot,
        records,
        dryRun: false,
      }),
    );

    expect(first.publishedListingsTouched).toBe(0);
    expect(second.publishedListingsTouched).toBe(0);
    expect(first.candidatesWritten).toBeGreaterThan(0);

    await withBypass(db.pool, async (client) => {
      const candidates = await client.query<{ count: string }>(
        `select count(*)::text as count from external_property_candidate`,
      );
      const contacts = await client.query<{ count: string }>(
        `select count(*)::text as count from property_contact_candidate`,
      );
      const approved = await client.query<{ count: string }>(
        `select count(*)::text as count from external_property_candidate
         where review_state = 'approved_for_publish' or rights_validated = true`,
      );
      const listings = await client.query<{ count: string }>(`select count(*)::text as count from listing`);
      const publicCols = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'listing'
           and column_name in ('owner_email', 'contact_email', 'pm_contact_name')`,
      );

      expect(Number(candidates.rows[0]!.count)).toBe(first.candidatesWritten);
      expect(Number(contacts.rows[0]!.count)).toBeGreaterThan(0);
      expect(Number(approved.rows[0]!.count)).toBe(0);
      expect(Number(listings.rows[0]!.count)).toBe(0);
      expect(publicCols.rows).toEqual([]);
    });

    const denied = await appPool.query(`select count(*)::text as count from property_contact_candidate`);
    expect(Number(denied.rows[0]!.count)).toBe(0);
  });
});
