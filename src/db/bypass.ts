import type { DbPool } from './pool.js';
import type pg from 'pg';

/**
 * System path for anonymous public API handlers (token hash lookup, webhook ingest,
 * rate-limit config). Uses transaction-local bypass only (is_local=true).
 */
export async function withSystemBypass<T>(
  pool: DbPool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
    try {
      const result = await fn(client);
      await client.query(`select set_config('rbit.bypass_rls', 'off', true)`);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  } finally {
    client.release();
  }
}
