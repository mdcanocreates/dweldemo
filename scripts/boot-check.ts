/**
 * Production boot gate for §18 config (R-2).
 * Usage: DATABASE_URL=... NODE_ENV=production npx tsx scripts/boot-check.ts
 */
import pg from 'pg';
import { assertProductionConfigReady } from '../src/modules/config/index.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL required');
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await assertProductionConfigReady(client, process.env.NODE_ENV);
    console.log('boot-check: OK');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(1);
});
