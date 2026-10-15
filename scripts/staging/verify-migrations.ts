/**
 * Post-migrate assertions for disposable DB (0001→0066+).
 * Usage: DATABASE_URL=postgres://... npx tsx scripts/staging/verify-migrations.ts
 */
import pg from 'pg';

const url = process.env.DATABASE_URL ?? '';
if (!url || /rds\.amazonaws\.com|rbitfinancial\.com/i.test(url)) {
  console.error('verify-migrations: refusing non-local DATABASE_URL');
  process.exit(1);
}

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const mig = await client.query<{ id: string }>(
      `select id from schema_migrations order by id`,
    );
    const names = mig.rows.map((r) => r.id);
    console.log(`migrations_applied=${names.length}`);
    console.log(`first=${names[0] ?? 'none'}`);
    console.log(`last=${names[names.length - 1] ?? 'none'}`);

    const need = [
      '0064_charter_v3_transaction_spine.sql',
      '0065_partner_attribution_lease_delegation.sql',
      '0066_missing_info_documents.sql',
      '0067_checkr_tenant_screening.sql',
      '0068_screening_provider_orchestration.sql',
    ];
    for (const n of need) {
      if (!names.includes(n)) {
        throw new Error(`missing required migration: ${n}`);
      }
    }

    const tables = [
      'party',
      'org',
      'application',
      'missing_info_request',
      'missing_info_request_document',
      'checkr_tenant_screening',
      'screening_provider_setting',
      'provider_screening',
    ];
    for (const t of tables) {
      const r = await client.query(
        `select to_regclass($1) as reg`,
        [`public.${t}`],
      );
      if (!r.rows[0]?.reg) throw new Error(`missing table ${t}`);
    }

    const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1::text[])`,
      [['application', 'missing_info_request_document']],
    );
    for (const row of rls.rows) {
      console.log(`rls ${row.relname}=${row.relrowsecurity}`);
    }

    console.log('verify-migrations: ok');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
