import type { ConnectionOptions } from 'node:tls';

import pg from 'pg';

const { Pool } = pg;

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient;

export type CreatePoolOptions = {
  connectionString: string;
  /**
   * Explicit TLS settings for Aurora/RDS.
   * Prefer a CA bundle + rejectUnauthorized: true over sslmode in the URL.
   */
  ssl?: boolean | ConnectionOptions;
};

export function createPool(
  connectionStringOrOptions: string | CreatePoolOptions,
): DbPool {
  if (typeof connectionStringOrOptions === 'string') {
    return new Pool({ connectionString: connectionStringOrOptions });
  }

  const { connectionString, ssl } = connectionStringOrOptions;
  return new Pool({
    connectionString,
    ...(ssl !== undefined ? { ssl } : {}),
  });
}

export async function withClient<T>(
  pool: DbPool,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  pool: DbPool,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withClient(pool, async (client) => {
    await client.query('begin');
    try {
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  });
}
