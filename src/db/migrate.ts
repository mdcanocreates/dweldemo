import { readdir, readFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { resolveDatabaseUrl } from './database-url.js';
import { loadRdsSslConfig } from './rds-ssl.js';

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function resolveMigrationsDir(): Promise<string> {
  if (process.env.MIGRATIONS_DIR?.trim()) {
    return path.resolve(process.env.MIGRATIONS_DIR.trim());
  }
  const candidates = [
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(__dirname, '../../migrations'),
    path.resolve(__dirname, '../../../migrations'),
  ];
  for (const dir of candidates) {
    try {
      await access(dir, fsConstants.R_OK);
      return dir;
    } catch {
      // try next
    }
  }
  throw new Error(`migrations directory not found (tried: ${candidates.join(', ')})`);
}

function resolveSsl(): pg.ClientConfig['ssl'] | undefined {
  const caPath = process.env.RDS_CA_BUNDLE_PATH ?? '/certs/rds-global-bundle.pem';
  try {
    return loadRdsSslConfig(caPath);
  } catch {
    return undefined;
  }
}

export async function migrate(connectionString: string): Promise<string[]> {
  const migrationsDir = await resolveMigrationsDir();
  const client = new Client({
    connectionString,
    ssl: resolveSsl(),
  });
  await client.connect();
  const applied: string[] = [];

  try {
    await client.query(`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query(
        `select 1 from schema_migrations where id = $1`,
        [file],
      );
      if (rows.length > 0) continue;

      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(`insert into schema_migrations (id) values ($1)`, [file]);
        await client.query('commit');
        applied.push(file);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }

    return applied;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const connectionString = resolveDatabaseUrl();
  const applied = await migrate(connectionString);
  console.log(JSON.stringify({ applied }, null, 2));
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
