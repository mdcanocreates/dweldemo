import pg from 'pg';

const tables = [
  'application_match_score_history',
  'cc_outbox',
  'internal_action_idempotency',
  'partner_organization',
  'platform_flag',
  'platform_flag_change',
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
for (const t of tables) {
  const r = await client.query(
    `select column_name from information_schema.columns where table_name = $1 order by ordinal_position`,
    [t],
  );
  console.log(t, r.rows.map((x) => x.column_name).join(','));
}
await client.end();
