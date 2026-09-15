import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clearPrescreenAndResume,
  DEVICE_PRESCREEN_GENERIC_MESSAGE,
  runDevicePrescreen,
} from '../../src/modules/screening/index.js';
import { AppError } from '../../src/modules/shared/errors.js';
import { createOrg, createPartyWithIdentity } from '../../src/modules/identity/index.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import {
  resumeTestApplicationFromPrescreen,
  runTestApplicationPipeline,
} from '../helpers/phase1-api.js';
import { seedPhase2TestConfig } from '../helpers/phase2.js';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'part-b', 'B-3');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

describe('B-3 — Device fraud prescreen', () => {
  let db: TestDb;
  let orgId: string;

  beforeAll(async () => {
    db = await startTestDb();
    await withBypass(db.pool, async (c) => {
      await seedPhase2TestConfig(c);
      const org = await createOrg(c, {
        kind: 'landlord',
        legalName: 'B3 LL',
        displayName: 'B3',
      });
      orgId = org.id;
    });
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function seedPartyWithProfile(email: string): Promise<{
    partyId: string;
    profileId: string;
  }> {
    return withBypass(db.pool, async (c) => {
      const p = await createPartyWithIdentity(c, db.kms, { identity: { email } });
      const { rows } = await c.query<{ id: string }>(
        `insert into renter_profile (party_id) values ($1) returning id`,
        [p.partyId],
      );
      return { partyId: p.partyId, profileId: rows[0]!.id };
    });
  }

  it('3 identities on device in 30d → prescreen_failed; no Certn archive; generic message', async () => {
    const deviceId = `dev-ident-${randomUUID()}`;
    const parties = [
      await seedPartyWithProfile(`b3-i1-${randomUUID()}@ex.com`),
      await seedPartyWithProfile(`b3-i2-${randomUUID()}@ex.com`),
      await seedPartyWithProfile(`b3-i3-${randomUUID()}@ex.com`),
    ];

    // Two prior edges
    await withBypass(db.pool, async (c) => {
      for (const p of parties.slice(0, 2)) {
        await c.query(
          `insert into device_identity_edge (device_id, party_id, first_seen_at)
           values ($1,$2, now() - interval '1 day')`,
          [deviceId, p.partyId],
        );
      }
    });

    const third = parties[2]!;
    let caught: AppError | null = null;
    let applicationId = '';
    await withBypass(db.pool, async (c) => {
      try {
        await runTestApplicationPipeline(c, {
          partyId: third.partyId,
          renterProfileId: third.profileId,
          orgId,
          payerKind: 'applicant',
          deviceId,
          listingRentCents: 200_000,
          statedMonthlyIncomeCents: 600_000,
        });
      } catch (err) {
        caught = err as AppError;
      }
      const { rows } = await c.query<{ id: string; status: string }>(
        `select id, status from application where party_id = $1 order by created_at desc limit 1`,
        [third.partyId],
      );
      expect(rows[0]?.status).toBe('prescreen_failed');
      applicationId = rows[0]!.id;
    });

    expect(caught).not.toBeNull();
    expect(caught!.status).toBe(422);
    expect(caught!.message).toBe(DEVICE_PRESCREEN_GENERIC_MESSAGE);
    expect(caught!.message).not.toMatch(/identity|device_velocity|threshold/i);

    const archives = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `select count(*)::text as n from vendor_request_archive
         where application_id = $1`,
        [applicationId],
      );
      const { rows: events } = await c.query<{ event_type: string; payload: unknown }>(
        `select event_type, payload from domain_event
         where aggregate_id = $1 and event_type = 'application_prescreen_failed'`,
        [applicationId],
      );
      const { rows: signals } = await c.query<{ signal_kind: string }>(
        `select signal_kind from fraud_signal where application_id = $1`,
        [applicationId],
      );
      return { n: Number(rows[0]!.n), events, signals };
    });

    expect(archives.n).toBe(0);
    expect(archives.events.length).toBe(1);
    expect(archives.signals[0]?.signal_kind).toBe('device_velocity');
    writeEvidence(
      'identity-threshold.json',
      JSON.stringify({ caught: caught!.message, archives }, null, 2) + '\n',
    );
  });

  it('same party on 4 devices in 7d → prescreen_failed', async () => {
    const party = await seedPartyWithProfile(`b3-d4-${randomUUID()}@ex.com`);
    await withBypass(db.pool, async (c) => {
      for (let i = 0; i < 3; i++) {
        await c.query(
          `insert into device_identity_edge (device_id, party_id, first_seen_at)
           values ($1,$2, now() - interval '1 day')`,
          [`dev-p4-${i}-${randomUUID()}`, party.partyId],
        );
      }
    });

    let status = 0;
    await withBypass(db.pool, async (c) => {
      try {
        await runTestApplicationPipeline(c, {
          partyId: party.partyId,
          renterProfileId: party.profileId,
          orgId,
          payerKind: 'applicant',
          deviceId: `dev-p4-new-${randomUUID()}`,
          listingRentCents: 200_000,
          statedMonthlyIncomeCents: 600_000,
        });
      } catch (err) {
        status = (err as AppError).status;
        expect((err as AppError).message).toBe(DEVICE_PRESCREEN_GENERIC_MESSAGE);
      }
    });
    expect(status).toBe(422);
  });

  it('5 apps from same device in 24h → prescreen_failed', async () => {
    const deviceId = `dev-apps-${randomUUID()}`;
    for (let i = 0; i < 4; i++) {
      const p = await seedPartyWithProfile(`b3-a${i}-${randomUUID()}@ex.com`);
      // Prior apps with unique parties — identity threshold is 3, so use same party for apps count
      // Better: same party, 4 prior applications + 5th fails
      void p;
    }

    const party = await seedPartyWithProfile(`b3-apps-${randomUUID()}@ex.com`);
    await withBypass(db.pool, async (c) => {
      for (let i = 0; i < 4; i++) {
        await c.query(
          `insert into application (
             party_id, renter_profile_id, org_id, entry_point, status, device_id, created_at
           ) values ($1,$2,$3,'renter_initiated','closed',$4, now() - interval '1 hour')`,
          [party.partyId, party.profileId, orgId, deviceId],
        );
      }
    });

    let msg = '';
    await withBypass(db.pool, async (c) => {
      try {
        await runTestApplicationPipeline(c, {
          partyId: party.partyId,
          renterProfileId: party.profileId,
          orgId,
          payerKind: 'applicant',
          deviceId,
          listingRentCents: 200_000,
          statedMonthlyIncomeCents: 600_000,
        });
      } catch (err) {
        msg = (err as AppError).message;
      }
    });
    expect(msg).toBe(DEVICE_PRESCREEN_GENERIC_MESSAGE);
  });

  it('thresholds from config; admin clear resumes from prescreen', async () => {
    const deviceId = `dev-clear-${randomUUID()}`;
    const parties: Array<{ partyId: string; profileId: string }> = [];
    for (let i = 0; i < 3; i++) {
      parties.push(await seedPartyWithProfile(`b3-c${i}-${randomUUID()}@ex.com`));
    }
    await withBypass(db.pool, async (c) => {
      for (const p of parties.slice(0, 2)) {
        await c.query(
          `insert into device_identity_edge (device_id, party_id) values ($1,$2)`,
          [deviceId, p.partyId],
        );
      }
    });

    const third = parties[2]!;
    let applicationId = '';
    let signalId = '';
    await withBypass(db.pool, async (c) => {
      try {
        await runTestApplicationPipeline(c, {
          partyId: third.partyId,
          renterProfileId: third.profileId,
          orgId,
          payerKind: 'applicant',
          deviceId,
          listingRentCents: 200_000,
          statedMonthlyIncomeCents: 600_000,
        });
      } catch {
        /* expected */
      }
      const { rows: apps } = await c.query<{ id: string }>(
        `select id from application where party_id = $1 order by created_at desc limit 1`,
        [third.partyId],
      );
      const { rows: sigs } = await c.query<{ id: string; detail: { thresholds: unknown } }>(
        `select id, detail from fraud_signal where application_id = $1`,
        [apps[0]!.id],
      );
      applicationId = apps[0]!.id;
      signalId = sigs[0]!.id;
      expect(sigs[0]!.detail.thresholds).toMatchObject({
        device_identity_count_30d_threshold: 3,
      });
    });

    const admin = await withBypass(db.pool, async (c) => {
      const a = await createPartyWithIdentity(c, db.kms, {
        identity: { email: `b3-admin-${randomUUID()}@ex.com` },
      });
      await clearPrescreenAndResume(c, {
        applicationId,
        signalId,
        reviewerPartyId: a.partyId,
      });
      return a.partyId;
    });

    const resumed = await withBypass(db.pool, (c) =>
      resumeTestApplicationFromPrescreen(c, {
        applicationId,
        partyId: third.partyId,
        renterProfileId: third.profileId,
        orgId,
        payerKind: 'applicant',
        listingRentCents: 200_000,
        statedMonthlyIncomeCents: 600_000,
        skipDeviceGate: true,
      }),
    );

    expect(resumed.orderId).toBeTruthy();
    const archives = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `select count(*)::text as n from vendor_request_archive
         where application_id = $1`,
        [applicationId],
      );
      return Number(rows[0]!.n);
    });
    expect(archives).toBeGreaterThanOrEqual(1);
    writeEvidence(
      'admin-clear-resume.json',
      JSON.stringify({ applicationId, resumed, admin, archives }, null, 2) + '\n',
    );
  });

  it('direct device gate uses config thresholds (not literals alone)', async () => {
    const result = await withBypass(db.pool, async (c) => {
      const cfg = await c.query<{ payload: Record<string, number> }>(
        `select payload from config_version
         where namespace = 'fraud_thresholds' and approved_by_party_id is not null
         order by effective_from desc limit 1`,
      );
      expect(cfg.rows[0]!.payload.device_identity_count_30d_threshold).toBe(3);
      expect(cfg.rows[0]!.payload.device_application_count_24h_threshold).toBe(5);
      expect(cfg.rows[0]!.payload.party_device_count_7d_threshold).toBe(4);

      const p = await createPartyWithIdentity(c, db.kms, {
        identity: { email: `b3-cfg-${randomUUID()}@ex.com` },
      });
      const { rows: rp } = await c.query<{ id: string }>(
        `insert into renter_profile (party_id) values ($1) returning id`,
        [p.partyId],
      );
      const appId = randomUUID();
      await c.query(
        `insert into application (
           id, party_id, renter_profile_id, org_id, entry_point, status, device_id
         ) values ($1,$2,$3,$4,'renter_initiated','prescreen',$5)`,
        [appId, p.partyId, rp[0]!.id, orgId, 'solo-device'],
      );
      return runDevicePrescreen(c, {
        applicationId: appId,
        partyId: p.partyId,
        deviceId: 'solo-device',
      });
    });
    expect(result.passed).toBe(true);
  });
});
