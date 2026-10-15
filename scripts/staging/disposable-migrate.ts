/**
 * Run migrations 0001→latest against a disposable Postgres URL.
 * Never uses production credentials. Refuses known prod host patterns.
 *
 * Examples:
 *   DATABASE_URL=postgres://rbit:rbit@localhost:5433/rbit_dev npm run staging:disposable-migrate
 *   DATABASE_URL=postgres://rbit:rbit@localhost:5432/rbit_ci npm run staging:disposable-migrate
 */
import { migrate } from '../../src/db/migrate.js';

const url = process.env.DATABASE_URL ?? '';
if (!url) {
  console.error('disposable-migrate: DATABASE_URL required');
  process.exit(1);
}

const forbidden = [
  'rbitfinancial.com',
  'rds.amazonaws.com',
  'dwel.rbitfinancial',
  'cluster-ro-',
];
const lower = url.toLowerCase();
for (const f of forbidden) {
  if (lower.includes(f)) {
    console.error(`disposable-migrate: refusing URL that looks like remote/prod (${f})`);
    process.exit(1);
  }
}

if (!/localhost|127\.0\.0\.1|postgres:/.test(lower)) {
  console.error(
    'disposable-migrate: URL host must be localhost/127.0.0.1 or docker service "postgres"',
  );
  process.exit(1);
}

console.log('disposable-migrate: starting (0001→latest)');
await migrate(url);
console.log('disposable-migrate: ok');
