import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ReplicaQueryClient,
  getBrokerPerformance,
  ensureBrokerPerformance,
} from '../../src/modules/brokerage/index.js';
import { AppError } from '../../src/modules/shared/errors.js';
import {
  createOrg,
  createPartyWithIdentity,
  grantRole,
} from '../../src/modules/identity/index.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'part-b', 'B-4');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

describe('B-4 — Broker performance dashboard', () => {
  let db: TestDb;
  let orgId: string;
  let peerOrgId: string;
  let adminPartyId: string;
  let renterPartyId: string;
  let submarketId: string;

  beforeAll(async () => {
    db = await startTestDb();
    await withBypass(db.pool, async (c) => {
      const org = await createOrg(c, {
        kind: 'brokerage',
        legalName: 'B4 Broker',
        displayName: 'B4',
      });
      orgId = org.id;
      const peer = await createOrg(c, {
        kind: 'brokerage',
        legalName: 'B4 Peer',
        displayName: 'Peer',
      });
      peerOrgId = peer.id;

      const admin = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'b4-admin@example.com' },
      });
      adminPartyId = admin.partyId;
      await grantRole(c, {
        partyId: adminPartyId,
        orgId,
        role: 'broker_admin',
      });

      const renter = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'b4-renter@example.com' },
      });
      renterPartyId = renter.partyId;

      await c.query(
        `insert into config_version (
           id, namespace, version, payload, effective_from,
           proposed_by_party_id, approved_by_party_id, approved_at
         ) values ($1,'broker_economics','b4-1',$2::jsonb, now(), $3, $3, now())`,
        [
          randomUUID(),
          JSON.stringify({ blended_broker_margin: 50000 }),
          adminPartyId,
        ],
      );

      submarketId = randomUUID();
      await c.query(
        `insert into submarket (id, name, metro_code, boundary, version, is_active)
         values (
           $1, 'B4 SM', 'TEST',
           ST_GeogFromText('POLYGON((-97.8 30.2,-97.7 30.2,-97.7 30.3,-97.8 30.3,-97.8 30.2))'),
           'v1', true
         )`,
        [submarketId],
      );

      await ensureBrokerPerformance(c, orgId);
      await ensureBrokerPerformance(c, peerOrgId);
      await c.query(
        `update broker_performance set
           leads_offered = 10, leads_accepted = 5, placements_closed = 2,
           close_rate = 0.4, median_response_seconds = 120,
           leakage_rate = 0.1, dispute_count = 1,
           prior_leads_offered = 8, prior_leads_accepted = 3,
           prior_placements_closed = 1, prior_close_rate = 0.25,
           prior_median_response_seconds = 200, prior_leakage_rate = 0.2,
           prior_dispute_count = 0, window_days = 90
         where org_id = $1`,
        [orgId],
      );
      await c.query(
        `update broker_performance set close_rate = 0.8, leads_offered = 5
         where org_id = $1`,
        [peerOrgId],
      );

      await c.query(
        `insert into broker_coverage (org_id, submarket_id, is_active)
         values ($1,$2,true), ($3,$2,true)`,
        [orgId, submarketId, peerOrgId],
      );
      await c.query(
        `insert into broker_performance_submarket (
           org_id, submarket_id, window_days, leads_offered, leads_accepted,
           placements_closed, close_rate, median_response_seconds
         ) values ($1,$2,90,10,5,2,0.4,120)`,
        [orgId, submarketId],
      );
    });
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('broker org member; rank percentile; trend prior; replica log; ev_per_lead from config', async () => {
    await withBypass(db.pool, async (c) => {
      const replica = new ReplicaQueryClient(c);
      const perf = await getBrokerPerformance(replica, c, {
        partyId: adminPartyId,
        orgId,
        windowDays: 90,
      });

      expect(perf.ev_per_lead).toBe(0.4 * 50000);
      expect(perf.trend).toMatchObject({
        leads_offered: 8,
        close_rate: 0.25,
      });
      expect(typeof perf.rank_in_submarket).toBe('number');
      expect(perf.rank_in_submarket).toBeGreaterThanOrEqual(0);
      expect(perf.rank_in_submarket).toBeLessThanOrEqual(100);
      // Must not expose peer org identifiers
      expect(JSON.stringify(perf)).not.toContain(peerOrgId);

      expect(replica.queryLog.length).toBeGreaterThan(0);
      expect(replica.queryLog.every((e) => e.path === 'replica')).toBe(true);

      writeEvidence('performance.json', JSON.stringify({ perf, log: replica.queryLog.length }, null, 2) + '\n');

      // Change margin → ev changes
      await c.query(
        `insert into config_version (
           id, namespace, version, payload, effective_from,
           proposed_by_party_id, approved_by_party_id, approved_at
         ) values ($1,'broker_economics','b4-2',$2::jsonb, now() + interval '1 second', $3, $3, now())`,
        [
          randomUUID(),
          JSON.stringify({ blended_broker_margin: 100000 }),
          adminPartyId,
        ],
      );
      // bump effective_from to be clearly latest
      await c.query(
        `update config_version set effective_from = now() where version = 'b4-2'`,
      );

      const perf2 = await getBrokerPerformance(new ReplicaQueryClient(c), c, {
        partyId: adminPartyId,
        orgId,
      });
      expect(perf2.ev_per_lead).toBe(0.4 * 100000);
      expect(perf2.ev_per_lead).not.toBe(perf.ev_per_lead);

      let forbidden = 0;
      try {
        await getBrokerPerformance(new ReplicaQueryClient(c), c, {
          partyId: renterPartyId,
          orgId,
        });
      } catch (err) {
        forbidden = (err as AppError).status;
      }
      expect(forbidden).toBe(403);
    });
  });
});
