import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.js';
import { createPool, type DbPool } from '../../src/db/pool.js';
import { LocalKmsProvider } from '../../src/infra/crypto/kms.js';

export type TestDb = {
  container: StartedPostgreSqlContainer;
  pool: DbPool;
  connectionString: string;
  kms: LocalKmsProvider;
  stop(): Promise<void>;
};

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgis/postgis:16-3.4')
    .withDatabase('rbit_test')
    .withUsername('rbit')
    .withPassword('rbit')
    .start();

  const connectionString = container.getConnectionUri();
  await migrate(connectionString);
  const pool = createPool(connectionString);
  const kms = new LocalKmsProvider();

  return {
    container,
    pool,
    connectionString,
    kms,
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}

export async function withBypass<T>(
  pool: DbPool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** App-role pool: non-superuser so FORCE RLS is actually enforced. */
export function createAppPool(connectionString: string): DbPool {
  const url = new URL(connectionString);
  url.username = 'rbit_app_user';
  url.password = 'rbit_app_user';
  return createPool(url.toString());
}
