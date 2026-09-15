import type { DbClient } from '../../db/pool.js';
import { SECTION_18_NAMESPACES } from './section18.js';

export class ProductionConfigBlockedError extends Error {
  constructor(
    message: string,
    readonly decisions: string[],
    readonly namespace: string,
  ) {
    super(message);
    this.name = 'ProductionConfigBlockedError';
  }
}

/**
 * R-2: if NODE_ENV=production, refuse to boot when any §18-dependent
 * config namespace lacks approved_by_party_id or still carries provisional:true.
 * Does not fire in development/test.
 */
export async function assertProductionConfigReady(
  client: DbClient,
  env: string | undefined = process.env.NODE_ENV,
): Promise<{ ok: true } | never> {
  if (env !== 'production') {
    return { ok: true };
  }

  for (const entry of SECTION_18_NAMESPACES) {
    const { rows } = await client.query<{
      id: string;
      version: string;
      approved_by_party_id: string | null;
      payload: Record<string, unknown>;
    }>(
      `select id, version, approved_by_party_id, payload
       from config_version
       where namespace = $1
       order by effective_from desc nulls last, approved_at desc nulls last
       limit 1`,
      [entry.namespace],
    );
    const row = rows[0];
    const decisionList = entry.decisions.join(', ');

    if (!row) {
      throw new ProductionConfigBlockedError(
        `Production boot blocked: config namespace '${entry.namespace}' missing (§18 ${decisionList}). Escalate to decision owner — do not invent a default.`,
        [...entry.decisions],
        entry.namespace,
      );
    }
    if (!row.approved_by_party_id) {
      throw new ProductionConfigBlockedError(
        `Production boot blocked: config namespace '${entry.namespace}' version '${row.version}' lacks approved_by_party_id (§18 ${decisionList}). Dual approval required.`,
        [...entry.decisions],
        entry.namespace,
      );
    }
    if (row.payload?.provisional === true) {
      throw new ProductionConfigBlockedError(
        `Production boot blocked: config namespace '${entry.namespace}' version '${row.version}' is still marked provisional (§18 ${decisionList}). Replace with a non-provisional approved config_version after the decision resolves.`,
        [...entry.decisions],
        entry.namespace,
      );
    }
  }

  return { ok: true };
}
