/**
 * P9 — Admin console backend: read-model only from reporting schema / replica.
 * Targeted single-record support lookups go through an allowlisted path.
 */

import type pg from 'pg';
import type { DbClient } from '../../db/pool.js';
import {
  getLabelCoverage,
  getSupplyDemandBySubmarket,
  getZeroResultDemandRollup,
} from '../analytics/index.js';

export type QueryLogEntry = {
  sql: string;
  params?: unknown[];
  at: Date;
  path: 'reporting' | 'allowlisted_lookup' | 'forbidden';
};

const ALLOWLISTED_LOOKUP_TABLES = new Set([
  'application',
  'placement',
  'listing',
  'party',
  'org',
  'document',
  'lead',
]);

function classifySql(sql: string): QueryLogEntry['path'] {
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

  if (/\breporting\./.test(normalized)) {
    return 'reporting';
  }

  const m = normalized.match(
    /\bfrom\s+(?:public\.)?([a-z_][a-z0-9_]*)\b[\s\S]*?\bwhere\b[\s\S]*?\bid\s*=\s*\$1\b/,
  );
  if (m && ALLOWLISTED_LOOKUP_TABLES.has(m[1]!) && /\blimit\s+1\b/.test(normalized)) {
    return 'allowlisted_lookup';
  }

  return 'forbidden';
}

/**
 * Query interceptor: logs every SQL and classifies reporting vs allowlisted vs forbidden.
 */
export class AdminQueryInterceptor {
  readonly queryLog: QueryLogEntry[] = [];
  private readonly inner: DbClient;

  constructor(inner: DbClient) {
    this.inner = inner;
  }

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    queryTextOrConfig: string | pg.QueryConfig,
    values?: unknown[],
  ): Promise<pg.QueryResult<T>> {
    const sql =
      typeof queryTextOrConfig === 'string'
        ? queryTextOrConfig
        : queryTextOrConfig.text;
    const params =
      typeof queryTextOrConfig === 'string'
        ? values
        : (queryTextOrConfig.values as unknown[] | undefined);

    const path = classifySql(sql);
    this.queryLog.push({ sql, params, at: new Date(), path });

    if (path === 'forbidden') {
      throw new Error(
        `admin console forbidden primary query: ${sql.slice(0, 120)}`,
      );
    }

    return this.inner.query<T>(queryTextOrConfig as string, values);
  }

  primaryQueryCount(): number {
    return this.queryLog.filter((e) => e.path === 'allowlisted_lookup').length;
  }

  reportingQueryCount(): number {
    return this.queryLog.filter((e) => e.path === 'reporting').length;
  }

  forbiddenAttempts(): QueryLogEntry[] {
    return this.queryLog.filter((e) => e.path === 'forbidden');
  }
}

export type AdminDashboardSnapshot = {
  asOfDate: string;
  supplyDemand: Awaited<ReturnType<typeof getSupplyDemandBySubmarket>>;
  labelCoverage: Awaited<ReturnType<typeof getLabelCoverage>>;
  zeroResultDemand: Awaited<ReturnType<typeof getZeroResultDemandRollup>>;
};

/** Dashboard reads — exclusively reporting.* */
export async function getAdminDashboard(
  client: AdminQueryInterceptor | DbClient,
  asOfDate: string,
): Promise<AdminDashboardSnapshot> {
  // Sequential to avoid pg concurrent query-on-same-client deprecation.
  const supplyDemand = await getSupplyDemandBySubmarket(client as DbClient, asOfDate);
  const labelCoverage = await getLabelCoverage(client as DbClient, asOfDate);
  const zeroResultDemand = await getZeroResultDemandRollup(client as DbClient, asOfDate);
  return { asOfDate, supplyDemand, labelCoverage, zeroResultDemand };
}

/**
 * Targeted single-record support lookup — allowlisted path only.
 */
export async function adminLookupById(
  client: AdminQueryInterceptor | DbClient,
  table: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (!ALLOWLISTED_LOOKUP_TABLES.has(table)) {
    throw new Error(`table not allowlisted for admin lookup: ${table}`);
  }
  const { rows } = await (client as DbClient).query<Record<string, unknown>>(
    `select * from ${table} where id = $1 limit 1`,
    [id],
  );
  return rows[0] ?? null;
}

export function wrapAdminClient(inner: DbClient): AdminQueryInterceptor {
  return new AdminQueryInterceptor(inner);
}
