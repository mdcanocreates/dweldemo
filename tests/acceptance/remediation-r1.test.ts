import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setTenantContext } from '../../src/db/session.js';
import { createOrg, createPartyWithIdentity } from '../../src/modules/identity/index.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'remediation', 'R-1');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

describe('R-1 remediation — lead/lead_offer RLS', () => {
  let db: TestDb;
  let appPool: DbPool;

  beforeAll(async () => {
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
  }, 300_000);

  afterAll(async () => {
    await appPool?.end();
    await db?.stop();
  });

  it('pg_policies includes lead and lead_offer; broker A cannot see broker B offer', async () => {
    const client = await db.pool.connect();
    try {
      const { rows: policies } = await client.query<{
        tablename: string;
        policyname: string;
        qual: string;
      }>(
        `select tablename, policyname, qual from pg_policies
         where schemaname = 'public' and tablename in ('lead','lead_offer','lead_purchase_evidence','screening_report_access')
         order by tablename, policyname`,
      );
      writeEvidence('pg_policies.txt', JSON.stringify(policies, null, 2) + '\n');
      expect(policies.some((p) => p.tablename === 'lead')).toBe(true);
      expect(policies.some((p) => p.tablename === 'lead_offer')).toBe(true);
    } finally {
      client.release();
    }

    const seeded = await withBypass(db.pool, async (c) => {
      const brokerA = await createOrg(c, {
        kind: 'brokerage',
        legalName: 'Broker A',
        displayName: 'A',
      });
      const brokerB = await createOrg(c, {
        kind: 'brokerage',
        legalName: 'Broker B',
        displayName: 'B',
      });
      const party = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'lead-rls@example.com' },
      });
      // Minimal listing/application scaffolding for FK
      const landlord = await createOrg(c, {
        kind: 'landlord',
        legalName: 'LL',
        displayName: 'LL',
      });
      const { rows: addr } = await c.query<{ id: string }>(
        `insert into address (raw_input, normalized_hash, normalizer_vendor, normalizer_version)
         values ('1 R1 St','r1-hash','test','1') returning id`,
      );
      const { rows: prop } = await c.query<{ id: string }>(
        `insert into property (address_id, property_type) values ($1,'sfr') returning id`,
        [addr[0]!.id],
      );
      const { rows: unit } = await c.query<{ id: string }>(
        `insert into unit (property_id, unit_label_normalized) values ($1,'') returning id`,
        [prop[0]!.id],
      );
      const { rows: listing } = await c.query<{ id: string }>(
        `insert into listing (org_id, unit_id, origin, rent_amount_cents, status)
         values ($1,$2,'manual',200000,'active') returning id`,
        [landlord.id, unit[0]!.id],
      );
      const { rows: rp } = await c.query<{ id: string }>(
        `insert into renter_profile (party_id) values ($1) returning id`,
        [party.partyId],
      );
      const { rows: app } = await c.query<{ id: string }>(
        `insert into application (party_id, renter_profile_id, listing_id, unit_id, org_id, entry_point, status)
         values ($1,$2,$3,$4,$5,'renter_initiated','screened') returning id`,
        [party.partyId, rp[0]!.id, listing[0]!.id, unit[0]!.id, landlord.id],
      );
      const leadId = randomUUID();
      await c.query(
        `insert into lead (
           id, application_id, listing_id, party_id, rs_tier, classifier_version,
           rent_amount_cents_at_class, price_book_version, fee_amount_cents, status
         ) values ($1,$2,$3,$4,'RS-3','v1',200000,'pb-1',11500,'offered')`,
        [leadId, app[0]!.id, listing[0]!.id, party.partyId],
      );
      const offerA = randomUUID();
      const offerB = randomUUID();
      await c.query(
        `insert into lead_offer (id, lead_id, broker_org_id, sla_expires_at)
         values ($1,$2,$3, now() + interval '4 hours')`,
        [offerA, leadId, brokerA.id],
      );
      await c.query(
        `insert into lead_offer (id, lead_id, broker_org_id, sla_expires_at, responded_at, response)
         values ($1,$2,$3, now() + interval '4 hours', now(), 'declined')`,
        [offerB, leadId, brokerB.id],
      );
      return { brokerA: brokerA.id, brokerB: brokerB.id, leadId, offerA, offerB };
    });

    const app = await appPool.connect();
    try {
      await app.query('begin');
      await setTenantContext(app, { orgId: seeded.brokerA, bypassRls: false });
      const { rows: offersA } = await app.query<{ id: string; broker_org_id: string }>(
        `select id, broker_org_id::text from lead_offer`,
      );
      const { rows: leadsA } = await app.query<{ id: string }>(`select id from lead`);
      await app.query('commit');

      await app.query('begin');
      await setTenantContext(app, { orgId: seeded.brokerB, bypassRls: false });
      const { rows: offersB } = await app.query<{ id: string; broker_org_id: string }>(
        `select id, broker_org_id::text from lead_offer`,
      );
      await app.query('commit');

      await app.query('begin');
      await setTenantContext(app, { orgId: null, bypassRls: false });
      const { rows: leadsNone } = await app.query(`select id from lead`);
      const { rows: offersNone } = await app.query(`select id from lead_offer`);
      await app.query('commit');

      const report = {
        brokerA_offers: offersA,
        brokerB_offers: offersB,
        brokerA_leads: leadsA.length,
        no_org_leads: leadsNone.length,
        no_org_offers: offersNone.length,
      };
      writeEvidence('broker-isolation.txt', JSON.stringify(report, null, 2) + '\n');

      expect(offersA).toHaveLength(1);
      expect(offersA[0]!.id).toBe(seeded.offerA);
      expect(offersB.every((o) => o.id !== seeded.offerA)).toBe(true);
      expect(offersB.some((o) => o.id === seeded.offerB)).toBe(true);
      expect(leadsA.length).toBeGreaterThanOrEqual(1);
      expect(leadsNone).toHaveLength(0);
      expect(offersNone).toHaveLength(0);
    } finally {
      app.release();
    }
  });

  it('tenancy CI gate passes with reduced allowlist', () => {
    const out = execFileSync('npm', ['run', 'ci:tenancy'], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: db.connectionString },
      encoding: 'utf8',
      shell: true,
    });
    writeEvidence('tenancy-gate.txt', out);
    expect(out).toMatch(/tenancy-gate: PASS/);

    const gt = JSON.parse(readFileSync(path.join(ROOT, 'GLOBAL_TABLES.json'), 'utf8')) as {
      tables: string[];
      description: string;
    };
    expect(gt.description).toMatch(/reference data only/i);
    expect(gt.tables).not.toContain('lead');
    expect(gt.tables).not.toContain('lead_offer');
    expect(gt.tables).not.toContain('solar_deal');
    writeEvidence(
      'allowlist-after.txt',
      JSON.stringify({ removed: ['lead', 'lead_offer', 'lead_purchase_evidence', 'solar_deal', 'solar_partner_remittance', 'screening_report_access'], tables: gt.tables, description: gt.description }, null, 2) +
        '\n',
    );
  });
});
