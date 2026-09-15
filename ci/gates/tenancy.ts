import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Tenant / party columns accepted by §3.1 gate. */
const TENANT_COLUMNS = [
  'org_id',
  'broker_org_id',
  'partner_org_id',
  'granted_to_org_id',
  'party_id',
  'recipient_party_id',
  'grantee_org_id',
  'grantee_party_id',
  'payer_org_id',
] as const;


type GlobalTables = { tables: string[]; description?: string };

/**
 * §3.1 / §16.5 tenancy gate.
 * Fail if any public app table lacks a tenant column + RLS policy,
 * or membership in GLOBAL_TABLES (reference data only).
 *
 * Env:
 *   DATABASE_URL — required
 *   TENANCY_INJECT_VIOLATION=1 — deliberate unscoped table then expect failure
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL required');
    process.exit(2);
  }

  await migrate(connectionString);

  const client = new pg.Client({ connectionString });
  await client.connect();

  const inject = process.env.TENANCY_INJECT_VIOLATION === '1';
  if (inject) {
    await client.query(`
      create table if not exists deliberate_unscoped (
        id uuid primary key default gen_random_uuid(),
        note text not null
      )
    `);
  }

  try {
    const allowlist = JSON.parse(
      await readFile(path.join(ROOT, 'GLOBAL_TABLES.json'), 'utf8'),
    ) as GlobalTables;
    const allowed = new Set(allowlist.tables);

    const { rows: tables } = await client.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
      order by table_name
    `);

    const failures: string[] = [];

    for (const { table_name } of tables) {
      if (allowed.has(table_name)) continue;

      const { rows: cols } = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = $1
           and column_name = any($2::text[])`,
        [table_name, [...TENANT_COLUMNS]],
      );

      const { rows: rls } = await client.query<{ rowsecurity: boolean }>(
        `select c.relrowsecurity as rowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = $1`,
        [table_name],
      );

      const { rows: policies } = await client.query<{ policyname: string; qual: string | null }>(
        `select policyname, qual from pg_policies
         where schemaname = 'public' and tablename = $1`,
        [table_name],
      );

      if (!rls[0]?.rowsecurity) {
        failures.push(`${table_name}: RLS not enabled and not in GLOBAL_TABLES`);
        continue;
      }
      if (policies.length === 0) {
        failures.push(`${table_name}: RLS enabled but no policy`);
        continue;
      }

      const hasTenantCol = cols.length > 0;
      const policyUsesSession = policies.some(
        (p) =>
          p.qual != null &&
          (p.qual.includes('rbit.current_org_id') ||
            p.qual.includes('rbit.current_party_id')),
      );

      // JOIN/PARTY policies may lack a local tenant column but bind session GUCs.
      if (!hasTenantCol && !policyUsesSession) {
        failures.push(
          `${table_name}: missing tenant/party column and policy does not bind rbit.current_org_id|current_party_id`,
        );
      }
    }

    if (inject) {
      await client.query(`drop table if exists deliberate_unscoped`);
      if (failures.some((f) => f.startsWith('deliberate_unscoped'))) {
        console.log('tenancy-gate: FAIL (expected) — deliberate_unscoped detected');
        console.log(failures.join('\n'));
        await client.end();
        process.exit(1);
      }
      console.error('tenancy-gate: expected deliberate_unscoped failure was not detected');
      await client.end();
      process.exit(2);
    }

    if (failures.length) {
      console.error('tenancy-gate: FAIL');
      for (const f of failures) console.error(`  - ${f}`);
      await client.end();
      process.exit(1);
    }

    console.log('tenancy-gate: PASS');
    console.log(`checked ${tables.length} tables; allowlist size ${allowed.size}`);
    await client.end();
  } catch (err) {
    if (inject) {
      await client.query(`drop table if exists deliberate_unscoped`).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
