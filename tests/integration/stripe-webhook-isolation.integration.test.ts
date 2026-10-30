/**
 * Application-role sessions cannot read or write stripe_webhook_event.
 * The trusted worker path sets rbit.bypass_rls for that transaction only.
 * Disposable Postgres. No Stripe network call and no Aurora connection.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppPool, startTestDb, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

describe('stripe webhook table isolation', () => {
  let db: TestDb;
  let appPool: DbPool;

  beforeAll(async () => {
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
  }, 180_000);

  afterAll(async () => {
    await appPool?.end();
    await db?.stop();
  });

  it('hides the table from a normal tenant session and accepts one trusted insert', async () => {
    const client = await appPool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('rbit.current_org_id', gen_random_uuid()::text, true)`);
      await client.query(`select set_config('rbit.current_party_id', gen_random_uuid()::text, true)`);
      await client.query(`select set_config('rbit.bypass_rls', 'off', true)`);
      const visible = await client.query<{ n: string }>(
        `select count(*)::text as n from stripe_webhook_event`,
      );
      expect(visible.rows[0]?.n).toBe('0');
      await expect(
        client.query(
          `insert into stripe_webhook_event (mode, provider_event_id, event_type, livemode, disposition)
           values ('test', 'evt_tenant', 'payment_intent.succeeded', false, 'ignored')`,
        ),
      ).rejects.toThrow(/row-level security|permission denied/i);
      await client.query('rollback');

      await client.query('begin');
      await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
      const first = await client.query(
        `insert into stripe_webhook_event (mode, provider_event_id, event_type, livemode, disposition)
         values ('test', 'evt_trusted', 'payment_intent.succeeded', false, 'ignored')
         on conflict (provider_event_id) do nothing
         returning id`,
      );
      const second = await client.query(
        `insert into stripe_webhook_event (mode, provider_event_id, event_type, livemode, disposition)
         values ('test', 'evt_trusted', 'payment_intent.succeeded', false, 'ignored')
         on conflict (provider_event_id) do nothing
         returning id`,
      );
      expect(first.rowCount).toBe(1);
      expect(second.rowCount).toBe(0);
      await client.query('commit');
    } finally {
      client.release();
    }
  });
});
