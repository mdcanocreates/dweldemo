/**
 * Read-only inventory of migrations 0068-0073.
 * Refuses any host that looks like Aurora or RDS. Does not apply SQL.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wanted = ['0068', '0069', '0070', '0071', '0072', '0073'];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isRemoteProduction(host: string): boolean {
  return (
    host.includes('amazonaws.com') ||
    host.includes('aurora') ||
    host.includes('rds') ||
    host.includes('cluster-')
  );
}

async function main(): Promise<void> {
  const files = (await readdir(path.join(root, 'migrations')))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const prefixes = new Map<string, string[]>();
  for (const file of files) {
    const prefix = file.slice(0, 4);
    const list = prefixes.get(prefix) ?? [];
    list.push(file);
    prefixes.set(prefix, list);
  }
  const duplicates = [...prefixes.entries()].filter(([, list]) => list.length > 1);
  const present = wanted.map((prefix) => ({
    prefix,
    file: files.find((name) => name.startsWith(prefix)) ?? null,
  }));
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
  const host = databaseUrl ? hostOf(databaseUrl) : '';
  const report: Record<string, unknown> = {
    migrations: present,
    duplicate_prefixes: duplicates.map(([prefix, list]) => ({ prefix, files: list })),
    deployed_schema: 'not_queried',
    duplicate_open_applications: 'not_queried',
    aurora_migration_0073: 'not_applied',
  };

  if (!databaseUrl) {
    report.deployed_schema = 'unavailable_no_database_url';
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (isRemoteProduction(host)) {
    report.deployed_schema = 'refused_remote_host';
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 2;
    return;
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const applied = await client.query<{ id: string }>(
      `select id from schema_migrations where id like '006%' or id like '007%' order by id`,
    );
    report.deployed_schema = 'local_read_only';
    report.applied_migrations = applied.rows.map((row) => row.id);
    try {
      const dupes = await client.query<{ party_id: string; listing_id: string; record_kind: string; n: string }>(
        `select party_id::text, listing_id::text, record_kind, count(*)::text as n
         from application
         where listing_id is not null
           and closed_at is null
           and status not in ('declined', 'withdrawn', 'closed')
         group by party_id, listing_id, record_kind
         having count(*) > 1`,
      );
      report.duplicate_open_applications = dupes.rows;
    } catch {
      report.duplicate_open_applications = 'record_kind_column_absent';
    }
  } finally {
    await client.end();
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'audit failed');
  process.exit(1);
});
