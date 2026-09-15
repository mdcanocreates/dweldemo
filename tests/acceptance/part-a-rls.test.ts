import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setTenantContext } from '../../src/db/session.js';
import { createOrg, createPartyWithIdentity } from '../../src/modules/identity/index.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'part-a');

const REMEDIATED = [
  'sync_run',
  'raw_record',
  'listing_field_provenance',
  'unit_source_conflict',
  'placement_queue_entry',
  'placement_outcome',
  'screening_order',
  'screening_report',
  'screening_rebate',
  'income_verification',
  'fraud_signal',
  'solar_underwriting_decision',
  'solar_deal_remittance',
  'document_grant',
  'document_access_log',
  'notification',
  'notification_preference',
  'renter_profile',
  'score',
  'feature_snapshot',
  'session',
] as const;

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

type Seed = {
  orgA: string;
  orgB: string;
  partnerA: string;
  partyA: string;
  partyB: string;
  listingA: string;
  listingB: string;
  unitA: string;
  placementA: string;
  syncRunA: string;
  rawRecordA: bigint;
  packageId: string;
  orderA: string;
  reportA: string;
  dealA: string;
  remittanceId: string;
  docA: string;
  grantA: string;
  scoreA: string;
};

describe('Part A — GLOBAL_TABLES RLS remediation', () => {
  let db: TestDb;
  let appPool: DbPool;
  let seed: Seed;

  beforeAll(async () => {
    mkdirSync(EVIDENCE, { recursive: true });
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);

    copyFileSync(
      path.join(ROOT, 'migrations', '0041_rls_part_a_remediation.sql'),
      path.join(EVIDENCE, '0041_rls_part_a_remediation.sql'),
    );

    seed = await withBypass(db.pool, async (c) => {
      const orgA = await createOrg(c, {
        kind: 'landlord',
        legalName: 'Org A',
        displayName: 'A',
      });
      const orgB = await createOrg(c, {
        kind: 'landlord',
        legalName: 'Org B',
        displayName: 'B',
      });
      const partnerA = await createOrg(c, {
        kind: 'solar_partner',
        legalName: 'Partner A',
        displayName: 'PA',
      });
      const partyA = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'party-a-parta@example.com' },
      });
      const partyB = await createPartyWithIdentity(c, db.kms, {
        identity: { email: 'party-b-parta@example.com' },
      });

      const { rows: addr } = await c.query<{ id: string }>(
        `insert into address (raw_input, normalized_hash, normalizer_vendor, normalizer_version)
         values ('1 PartA St','parta-hash','test','1') returning id`,
      );
      const { rows: prop } = await c.query<{ id: string }>(
        `insert into property (address_id, property_type) values ($1,'sfr') returning id`,
        [addr[0]!.id],
      );
      const { rows: unitA } = await c.query<{ id: string }>(
        `insert into unit (property_id, unit_label_normalized) values ($1,'a') returning id`,
        [prop[0]!.id],
      );
      const { rows: unitB } = await c.query<{ id: string }>(
        `insert into unit (property_id, unit_label_normalized) values ($1,'b') returning id`,
        [prop[0]!.id],
      );

      const { rows: listingA } = await c.query<{ id: string }>(
        `insert into listing (org_id, unit_id, origin, rent_amount_cents, status)
         values ($1,$2,'manual',200000,'active') returning id`,
        [orgA.id, unitA[0]!.id],
      );
      const { rows: listingB } = await c.query<{ id: string }>(
        `insert into listing (org_id, unit_id, origin, rent_amount_cents, status)
         values ($1,$2,'manual',210000,'active') returning id`,
        [orgB.id, unitB[0]!.id],
      );

      const { rows: rpA } = await c.query<{ id: string }>(
        `insert into renter_profile (party_id, is_discoverable) values ($1, true) returning id`,
        [partyA.partyId],
      );
      const { rows: rpB } = await c.query<{ id: string }>(
        `insert into renter_profile (party_id, is_discoverable) values ($1, false) returning id`,
        [partyB.partyId],
      );

      const { rows: appA } = await c.query<{ id: string }>(
        `insert into application (party_id, renter_profile_id, listing_id, unit_id, org_id, entry_point, status)
         values ($1,$2,$3,$4,$5,'renter_initiated','screened') returning id`,
        [partyA.partyId, rpA[0]!.id, listingA[0]!.id, unitA[0]!.id, orgA.id],
      );
      const { rows: appB } = await c.query<{ id: string }>(
        `insert into application (party_id, renter_profile_id, listing_id, unit_id, org_id, entry_point, status)
         values ($1,$2,$3,$4,$5,'renter_initiated','screened') returning id`,
        [partyB.partyId, rpB[0]!.id, listingB[0]!.id, unitB[0]!.id, orgB.id],
      );

      const { rows: sourceA } = await c.query<{ id: string }>(
        `insert into source (org_id, name, adapter_kind, status, config, precedence, sync_mode)
         values ($1,'src-a','csv','active','{}'::jsonb,100,'manual') returning id`,
        [orgA.id],
      );
      const { rows: syncRunA } = await c.query<{ id: string }>(
        `insert into sync_run (source_id, run_kind, status) values ($1,'push','succeeded') returning id`,
        [sourceA[0]!.id],
      );
      const { rows: rawA } = await c.query<{ id: string }>(
        `insert into raw_record (source_id, sync_run_id, external_id, payload_hash)
         values ($1,$2,'ext-1','hash-a') returning id::text`,
        [sourceA[0]!.id, syncRunA[0]!.id],
      );

      const { rows: slA } = await c.query<{ id: string }>(
        `insert into source_listing (
           source_id, org_id, external_id, resolution_status, mapped_status, mapping_version
         ) values ($1,$2,'ext-1','resolved','active','v1') returning id`,
        [sourceA[0]!.id, orgA.id],
      );
      await c.query(
        `insert into listing_field_provenance (listing_id, field_name, source_listing_id, value_hash)
         values ($1,'rent',$2,'vh1')`,
        [listingA[0]!.id, slA[0]!.id],
      );
      await c.query(
        `insert into unit_source_conflict (unit_id, field_name, values_seen)
         values ($1,'rent','{"a":1}'::jsonb)`,
        [unitA[0]!.id],
      );

      await c.query(
        `insert into placement_queue_entry (listing_id, application_id, rank_score, rank_position)
         values ($1,$2,1.0,1)`,
        [listingA[0]!.id, appA[0]!.id],
      );

      const { rows: placementA } = await c.query<{ id: string }>(
        `insert into placement (unit_id, listing_id, application_id, party_id, org_id, status)
         values ($1,$2,$3,$4,$5,'closed') returning id`,
        [unitA[0]!.id, listingA[0]!.id, appA[0]!.id, partyA.partyId, orgA.id],
      );
      await c.query(
        `insert into placement_outcome (placement_id, horizon_days, requested_at)
         values ($1,30, now())`,
        [placementA[0]!.id],
      );

      const { rows: pkg } = await c.query<{ id: string }>(
        `insert into screening_package (package_key, version, product_codes, total_cost_cents)
         values ('basic','v1',array['credit'],5000)
         on conflict (package_key, version) do update set total_cost_cents = excluded.total_cost_cents
         returning id`,
      );
      const packageId =
        pkg[0]?.id ??
        (
          await c.query<{ id: string }>(
            `select id from screening_package where package_key='basic' and version='v1'`,
          )
        ).rows[0]!.id;

      const { rows: orderA } = await c.query<{ id: string }>(
        `insert into screening_order (
           party_id, application_id, package_id, payer_kind, payer_org_id,
           amount_charged_cents, status
         ) values ($1,$2,$3,'landlord',$4,5000,'complete') returning id`,
        [partyA.partyId, appA[0]!.id, packageId, orgA.id],
      );
      const { rows: reportA } = await c.query<{ id: string }>(
        `insert into screening_report (
           screening_order_id, party_id, vendor, vendor_report_id, report_kind, status
         ) values ($1,$2,'certn','vr-a','credit','complete') returning id`,
        [orderA[0]!.id, partyA.partyId],
      );
      await c.query(
        `insert into screening_report_access (report_id, granted_to_org_id, application_id)
         values ($1,$2,$3)`,
        [reportA[0]!.id, orgA.id, appA[0]!.id],
      );
      await c.query(
        `insert into screening_rebate (
           screening_order_id, party_id, placement_id, amount_cents, status, expires_at
         ) values ($1,$2,$3,5000,'eligible', now() + interval '30 days')`,
        [orderA[0]!.id, partyA.partyId, placementA[0]!.id],
      );
      await c.query(
        `insert into income_verification (party_id, method, confidence, verified_at)
         values ($1,'stated',0.5, now())`,
        [partyA.partyId],
      );
      await c.query(
        `insert into fraud_signal (party_id, application_id, signal_kind, severity, detail)
         values ($1,$2,'device','low','{}'::jsonb)`,
        [partyA.partyId, appA[0]!.id],
      );

      const cfgId = randomUUID();
      await c.query(
        `insert into config_version (
           id, namespace, version, payload, effective_from,
           proposed_by_party_id, approved_by_party_id, approved_at
         ) values ($1,'solar_underwriting','parta-v1','{}'::jsonb, now(), $2, $2, now())
         on conflict (namespace, version) do nothing`,
        [cfgId, partyA.partyId],
      );
      const { rows: cfg } = await c.query<{ id: string }>(
        `select id from config_version where namespace='solar_underwriting' and version='parta-v1'`,
      );
      const { rows: dealA } = await c.query<{ id: string }>(
        `insert into solar_deal (
           homeowner_party_id, partner_org_id, system_size_kw,
           gross_project_cost_cents, sale_price_cents, status
         ) values ($1,$2,5.0,1000000,900000,'approved') returning id`,
        [partyA.partyId, partnerA.id],
      );
      await c.query(
        `insert into solar_underwriting_decision (
           solar_deal_id, engine_version, config_version_id, tier, tier_cap_cents,
           equation_1_passed, equation_1_net_to_rbit_cents, equation_2_applied,
           approved_cashback_cents, net_to_rbit_cents, decision,
           input_snapshot, explanation
         ) values ($1,'e1',$2,1,10000,true,100,false,5000,100,'approved','{}'::jsonb,'{}'::jsonb)`,
        [dealA[0]!.id, cfg[0]!.id],
      );
      const { rows: rem } = await c.query<{ id: string }>(
        `insert into solar_partner_remittance (
           partner_org_id, period_start, period_end, expected_amount_cents, status
         ) values ($1, current_date, current_date, 5000, 'expected') returning id`,
        [partnerA.id],
      );
      await c.query(
        `insert into solar_deal_remittance (solar_deal_id, remittance_id, amount_cents)
         values ($1,$2,5000)`,
        [dealA[0]!.id, rem[0]!.id],
      );

      const { rows: docA } = await c.query<{ id: string }>(
        `insert into document (
           org_id, owner_party_id, doc_type, retention_class, storage_key,
           content_hash, content_type, size_bytes, scan_status
         ) values ($1,$2,'lease','standard','k1','h1','application/pdf',10,'clean')
         returning id`,
        [orgA.id, partyA.partyId],
      );
      const { rows: grantA } = await c.query<{ id: string }>(
        `insert into document_grant (document_id, grantee_org_id, permission)
         values ($1,$2,'view') returning id`,
        [docA[0]!.id, orgA.id],
      );
      await c.query(
        `insert into document_access_log (document_id, actor_org_id, action)
         values ($1,$2,'view')`,
        [docA[0]!.id, orgA.id],
      );

      await c.query(
        `insert into notification (
           recipient_party_id, channel, event_type, template_key, template_version, payload, status
         ) values ($1,'in_platform','test','t1','1','{}'::jsonb,'queued')`,
        [partyA.partyId],
      );
      await c.query(
        `insert into notification_preference (party_id, channel, event_type, is_enabled)
         values ($1,'email','test', true)
         on conflict do nothing`,
        [partyA.partyId],
      );

      const { rows: scoreA } = await c.query<{ id: string }>(
        `insert into score (
           application_id, renter_profile_id, party_id, model_key, model_version,
           cohort_key, cohort_n, raw_score, feature_snapshot, feature_sources,
           explanation, computed_by
         ) values ($1,$2,$3,'renter_score','rules-v0','c1',50,0.5,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'test')
         returning id`,
        [appA[0]!.id, rpA[0]!.id, partyA.partyId],
      );
      await c.query(
        `insert into feature_snapshot (
           party_id, application_id, computed_at, feature_set_version, features, point_in_time_key
         ) values ($1,$2, now(), 'renter_features-v1', '{}'::jsonb, now())`,
        [partyA.partyId, appA[0]!.id],
      );
      await c.query(
        `insert into session (party_id, expires_at, elevated_until)
         values ($1, now() + interval '1 day', now() + interval '1 hour')`,
        [partyA.partyId],
      );

      // orgB parallel minimal rows so wrong-tenant checks have something to hide
      const { rows: sourceB } = await c.query<{ id: string }>(
        `insert into source (org_id, name, adapter_kind, status, config, precedence, sync_mode)
         values ($1,'src-b','csv','active','{}'::jsonb,100,'manual') returning id`,
        [orgB.id],
      );
      await c.query(
        `insert into sync_run (source_id, run_kind, status) values ($1,'push','succeeded')`,
        [sourceB[0]!.id],
      );
      await c.query(
        `insert into notification (
           recipient_party_id, channel, event_type, template_key, template_version, payload, status
         ) values ($1,'in_platform','test','t1','1','{}'::jsonb,'queued')`,
        [partyB.partyId],
      );

      void appB;
      return {
        orgA: orgA.id,
        orgB: orgB.id,
        partnerA: partnerA.id,
        partyA: partyA.partyId,
        partyB: partyB.partyId,
        listingA: listingA[0]!.id,
        listingB: listingB[0]!.id,
        unitA: unitA[0]!.id,
        placementA: placementA[0]!.id,
        syncRunA: syncRunA[0]!.id,
        rawRecordA: BigInt(rawA[0]!.id),
        packageId,
        orderA: orderA[0]!.id,
        reportA: reportA[0]!.id,
        dealA: dealA[0]!.id,
        remittanceId: rem[0]!.id,
        docA: docA[0]!.id,
        grantA: grantA[0]!.id,
        scoreA: scoreA[0]!.id,
      };
    });
  }, 300_000);

  afterAll(async () => {
    await appPool?.end();
    await db?.stop();
  });

  it('pg_policies exist for every remediating table', async () => {
    const client = await db.pool.connect();
    try {
      const { rows } = await client.query<{ tablename: string; policyname: string; qual: string }>(
        `select tablename, policyname, qual from pg_policies
         where schemaname = 'public' and tablename = any($1::text[])
         order by tablename, policyname`,
        [REMEDIATED],
      );
      writeEvidence('pg_policies.txt', JSON.stringify(rows, null, 2) + '\n');
      for (const t of REMEDIATED) {
        expect(rows.some((r) => r.tablename === t), `missing policy for ${t}`).toBe(true);
      }
    } finally {
      client.release();
    }
  });

  it('app role: no context → 0 rows; correct org/party → expected; wrong tenant hidden', async () => {
    const app = await appPool.connect();
    const lines: string[] = [];

    async function count(sql: string, params: unknown[] = []): Promise<number> {
      const { rows } = await app.query<{ n: string }>(sql, params);
      return Number(rows[0]!.n);
    }

    try {
      await app.query('begin');
      await setTenantContext(app, { orgId: null, partyId: null, bypassRls: false });

      const noCtx: Record<string, number> = {};
      for (const t of REMEDIATED) {
        noCtx[t] = await count(`select count(*)::text as n from ${t}`);
      }
      lines.push('=== no org/party context ===');
      lines.push(JSON.stringify(noCtx, null, 2));
      for (const t of REMEDIATED) {
        expect(noCtx[t], `${t} visible without context`).toBe(0);
      }
      await app.query('commit');

      // Org A (JOIN / DUAL org paths)
      await app.query('begin');
      await setTenantContext(app, {
        orgId: seed.orgA,
        partyId: null,
        bypassRls: false,
      });
      const orgACounts = {
        sync_run: await count(`select count(*)::text as n from sync_run`),
        raw_record: await count(`select count(*)::text as n from raw_record`),
        listing_field_provenance: await count(
          `select count(*)::text as n from listing_field_provenance`,
        ),
        unit_source_conflict: await count(
          `select count(*)::text as n from unit_source_conflict`,
        ),
        placement_queue_entry: await count(
          `select count(*)::text as n from placement_queue_entry`,
        ),
        placement_outcome: await count(`select count(*)::text as n from placement_outcome`),
        screening_order: await count(`select count(*)::text as n from screening_order`),
        screening_report: await count(`select count(*)::text as n from screening_report`),
        fraud_signal: await count(`select count(*)::text as n from fraud_signal`),
        document_grant: await count(`select count(*)::text as n from document_grant`),
        document_access_log: await count(
          `select count(*)::text as n from document_access_log`,
        ),
        score: await count(`select count(*)::text as n from score`),
        renter_profile_discoverable: await count(
          `select count(*)::text as n from renter_profile where is_discoverable`,
        ),
        sync_run_sees_own: await count(
          `select count(*)::text as n from sync_run where id = $1`,
          [seed.syncRunA],
        ),
      };
      lines.push('=== org A context ===');
      lines.push(JSON.stringify(orgACounts, null, 2));
      expect(orgACounts.sync_run).toBeGreaterThanOrEqual(1);
      expect(orgACounts.raw_record).toBeGreaterThanOrEqual(1);
      expect(orgACounts.listing_field_provenance).toBeGreaterThanOrEqual(1);
      expect(orgACounts.unit_source_conflict).toBeGreaterThanOrEqual(1);
      expect(orgACounts.placement_queue_entry).toBeGreaterThanOrEqual(1);
      expect(orgACounts.placement_outcome).toBeGreaterThanOrEqual(1);
      expect(orgACounts.screening_order).toBeGreaterThanOrEqual(1);
      expect(orgACounts.screening_report).toBeGreaterThanOrEqual(1);
      expect(orgACounts.fraud_signal).toBeGreaterThanOrEqual(1);
      expect(orgACounts.document_grant).toBeGreaterThanOrEqual(1);
      expect(orgACounts.document_access_log).toBeGreaterThanOrEqual(1);
      expect(orgACounts.score).toBeGreaterThanOrEqual(1);
      expect(orgACounts.renter_profile_discoverable).toBeGreaterThanOrEqual(1);
      expect(orgACounts.sync_run_sees_own).toBe(1);
      await app.query('commit');

      // Org B cannot see org A sync_run
      await app.query('begin');
      await setTenantContext(app, {
        orgId: seed.orgB,
        partyId: null,
        bypassRls: false,
      });
      const orgBSyncOwn = await count(`select count(*)::text as n from sync_run`);
      const orgBSeesA = await count(`select count(*)::text as n from sync_run where id = $1`, [
        seed.syncRunA,
      ]);
      const orgBOutcomeA = await count(
        `select count(*)::text as n from placement_outcome where placement_id = $1`,
        [seed.placementA],
      );
      lines.push('=== org B context ===');
      lines.push(
        JSON.stringify(
          { sync_run: orgBSyncOwn, sees_orgA_sync: orgBSeesA, sees_orgA_outcome: orgBOutcomeA },
          null,
          2,
        ),
      );
      expect(orgBSeesA).toBe(0);
      expect(orgBOutcomeA).toBe(0);
      expect(orgBSyncOwn).toBeGreaterThanOrEqual(1);
      await app.query('commit');

      // Party A
      await app.query('begin');
      await setTenantContext(app, {
        orgId: null,
        partyId: seed.partyA,
        bypassRls: false,
      });
      const partyACounts = {
        notification: await count(`select count(*)::text as n from notification`),
        notification_preference: await count(
          `select count(*)::text as n from notification_preference`,
        ),
        renter_profile: await count(`select count(*)::text as n from renter_profile`),
        session: await count(`select count(*)::text as n from session`),
        income_verification: await count(
          `select count(*)::text as n from income_verification`,
        ),
        screening_rebate: await count(`select count(*)::text as n from screening_rebate`),
        feature_snapshot: await count(`select count(*)::text as n from feature_snapshot`),
        score: await count(`select count(*)::text as n from score`),
        screening_order: await count(`select count(*)::text as n from screening_order`),
      };
      lines.push('=== party A context ===');
      lines.push(JSON.stringify(partyACounts, null, 2));
      expect(partyACounts.notification).toBeGreaterThanOrEqual(1);
      expect(partyACounts.renter_profile).toBe(1);
      expect(partyACounts.session).toBeGreaterThanOrEqual(1);
      expect(partyACounts.income_verification).toBeGreaterThanOrEqual(1);
      expect(partyACounts.screening_rebate).toBeGreaterThanOrEqual(1);
      expect(partyACounts.feature_snapshot).toBeGreaterThanOrEqual(1);
      expect(partyACounts.score).toBeGreaterThanOrEqual(1);
      expect(partyACounts.screening_order).toBeGreaterThanOrEqual(1);
      await app.query('commit');

      // Party B cannot see party A notification / session
      await app.query('begin');
      await setTenantContext(app, {
        orgId: null,
        partyId: seed.partyB,
        bypassRls: false,
      });
      const partyBNotif = await count(`select count(*)::text as n from notification`);
      const partyBSeesASession = await count(
        `select count(*)::text as n from session where party_id = $1`,
        [seed.partyA],
      );
      const partyBProfile = await count(`select count(*)::text as n from renter_profile`);
      lines.push('=== party B context ===');
      lines.push(
        JSON.stringify(
          {
            notification: partyBNotif,
            sees_partyA_session: partyBSeesASession,
            renter_profile: partyBProfile,
          },
          null,
          2,
        ),
      );
      expect(partyBSeesASession).toBe(0);
      expect(partyBProfile).toBe(1);
      expect(partyBNotif).toBeGreaterThanOrEqual(1);
      await app.query('commit');

      await app.query('begin');
      await setTenantContext(app, {
        orgId: seed.partnerA,
        partyId: null,
        bypassRls: false,
      });
      const uw = await count(`select count(*)::text as n from solar_underwriting_decision`);
      const remRows = await count(`select count(*)::text as n from solar_deal_remittance`);
      lines.push('=== partner org context ===');
      lines.push(
        JSON.stringify(
          { solar_underwriting_decision: uw, solar_deal_remittance: remRows },
          null,
          2,
        ),
      );
      expect(uw).toBeGreaterThanOrEqual(1);
      expect(remRows).toBeGreaterThanOrEqual(1);
      await app.query('commit');

      writeEvidence('isolation-checks.txt', lines.join('\n') + '\n');
    } finally {
      try {
        await app.query('rollback');
      } catch {
        /* ignore */
      }
      app.release();
    }
  });

  it('tenancy CI gate PASS; deliberate inject FAIL; allowlist shrunk', () => {
    const passOut = execFileSync('npm', ['run', 'ci:tenancy'], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: db.connectionString },
      encoding: 'utf8',
      shell: true,
    });
    writeEvidence('tenancy-gate-pass.txt', passOut);
    expect(passOut).toMatch(/tenancy-gate: PASS/);

    let failOut = '';
    let failCode = 0;
    try {
      failOut = execFileSync('npm', ['run', 'ci:tenancy'], {
        cwd: ROOT,
        env: {
          ...process.env,
          DATABASE_URL: db.connectionString,
          TENANCY_INJECT_VIOLATION: '1',
        },
        encoding: 'utf8',
        shell: true,
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      failCode = e.status ?? 1;
      failOut = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    writeEvidence('tenancy-gate-inject-fail.txt', failOut);
    expect(failCode).not.toBe(0);
    expect(failOut).toMatch(/deliberate_unscoped/);

    const gt = JSON.parse(readFileSync(path.join(ROOT, 'GLOBAL_TABLES.json'), 'utf8')) as {
      tables: string[];
      description: string;
      justifications: Record<string, string>;
    };
    writeEvidence('GLOBAL_TABLES.json', JSON.stringify(gt, null, 2) + '\n');
    expect(gt.description).toMatch(/reference data only/i);
    for (const t of REMEDIATED) {
      expect(gt.tables, t).not.toContain(t);
    }
    for (const t of gt.tables) {
      expect(gt.justifications[t], `missing justification for ${t}`).toBeTruthy();
    }
  });
});
