import type { DbClient } from './pool.js';

/**
 * Sets request-scoped RLS session variables.
 * Application callers must not set bypassRls. Migrator/admin paths may.
 * Callers that enable bypass MUST also write admin_action_log via audit module.
 *
 * Always sets org, party, and bypass on each call so request boundaries are explicit.
 */
export async function setTenantContext(
  client: DbClient,
  opts: {
    orgId?: string | null;
    partyId?: string | null;
    bypassRls?: boolean;
  },
): Promise<void> {
  await client.query(`select set_config('rbit.current_org_id', $1, true)`, [
    opts.orgId ?? '',
  ]);
  await client.query(`select set_config('rbit.current_party_id', $1, true)`, [
    opts.partyId ?? '',
  ]);
  await client.query(`select set_config('rbit.bypass_rls', $1, true)`, [
    opts.bypassRls ? 'on' : 'off',
  ]);
}

export async function clearTenantContext(client: DbClient): Promise<void> {
  await client.query(`select set_config('rbit.current_org_id', '', true)`);
  await client.query(`select set_config('rbit.current_party_id', '', true)`);
  await client.query(`select set_config('rbit.bypass_rls', 'off', true)`);
}
