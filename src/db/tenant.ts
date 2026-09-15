import type { DbPool } from './pool.js';
import type pg from 'pg';
import { setTenantContext, clearTenantContext } from './session.js';

/**
 * Run work under an explicit tenant context (no RLS bypass).
 * Tenant identity must come from trusted server-side relationships.
 *
 * Uses transaction-local GUCs only (set_config is_local=true via setTenantContext).
 * Context is cleared before COMMIT so a pooled connection cannot retain tenant
 * identity after the transaction ends.
 */
export async function withTenantContext<T>(
  pool: DbPool,
  opts: { orgId?: string | null; partyId?: string | null },
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await setTenantContext(client, {
      orgId: opts.orgId ?? null,
      partyId: opts.partyId ?? null,
      bypassRls: false,
    });
    try {
      const result = await fn(client);
      await clearTenantContext(client);
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
