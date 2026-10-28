import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emitDomainEvent } from '../../src/modules/audit/index.js';
import { issueEmailCode, verifyEmailCode } from '../../src/modules/auth/email-code.js';
import { restoreSnapshotFromFreezeEvent } from '../../src/modules/renter/intake.js';
import { INTAKE_FROZEN_EVENT } from '../../src/modules/renter/lifecycle.js';
import {
  handleCreateInterestApplication,
  handleGetApplicationIntakeDetail,
  handleGetRenterProfile,
  handleListMyApplications,
  handleUpsertRenterIntake,
  handleUpsertRenterProfile,
} from '../../src/http/renter-handlers.js';
import { resetApplicationCreationRateLimits } from '../../src/modules/applications/index.js';
import { createOrg } from '../../src/modules/identity/index.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

function mockRes() {
  let statusCode = 0;
  let body = '';
  const res = {
    writeHead(code: number) {
      statusCode = code;
    },
    end(chunk?: string) {
      body = chunk ?? '';
    },
  } as unknown as ServerResponse;
  return {
    res,
    get status() {
      return statusCode;
    },
    get json() {
      return body ? (JSON.parse(body) as Record<string, unknown>) : null;
    },
  };
}

function mockReq(path: string, auth: string, body?: unknown): IncomingMessage {
  const raw = body !== undefined ? JSON.stringify(body) : '';
  return {
    method: body !== undefined ? 'POST' : 'GET',
    url: path,
    headers: {
      host: 'localhost',
      authorization: `Bearer ${auth}`,
      'x-forwarded-for': '127.0.0.1',
    },
    async *[Symbol.asyncIterator]() {
      if (raw) yield Buffer.from(raw);
    },
  } as unknown as IncomingMessage;
}

async function signIn(db: TestDb, email: string, when: Date) {
  const clock = { now: () => when };
  return withBypass(db.pool, async (client) => {
    const issued = await issueEmailCode(client, db.kms, {
      email,
      purpose: 'sign_in',
      clock,
    });
    if (!issued.code || !issued.partyId) throw new Error('email code was not issued');
    const session = await verifyEmailCode(client, {
      email,
      code: issued.code,
      purpose: 'sign_in',
      clock,
    });
    return { partyId: issued.partyId, credential: session.credential };
  });
}

describe('renter lifecycle', () => {
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

  it('saves a profile across sign-in, tracks each home, and does not invent old snapshots', async () => {
    resetApplicationCreationRateLimits();
    const email = `renter-${randomUUID().slice(0, 8)}@example.com`;
    const first = await signIn(db, email, new Date());
    const deps = { pool: appPool };

    const saved = mockRes();
    await handleUpsertRenterProfile(
      mockReq('/v1/renter/profile', first.credential, {
        given_name: 'Ada',
        family_name: 'Renter',
        phone: '+15125550100',
        email,
        annual_income_cents: null,
        move_in_urgency: 'flexible',
        bedrooms_min: 2,
        rent_max_cents: 180000,
        state: 'TX',
        has_pets: false,
        household_size: 1,
      }),
      saved.res,
      deps,
    );
    expect(saved.status).toBe(200);

    const again = await signIn(db, email, new Date(Date.now() + 120_000));
    expect(again.partyId).toBe(first.partyId);
    const loaded = mockRes();
    await handleGetRenterProfile(mockReq('/v1/renter/profile', again.credential), loaded.res, deps);
    expect(loaded.status).toBe(200);
    expect(loaded.json?.profile).toMatchObject({
      given_name: 'Ada',
      family_name: 'Renter',
      email,
      preferred_state: 'TX',
      rent_max_cents: 180000,
    });

    const homes = await withBypass(db.pool, async (client) => {
      const org = await createOrg(client, {
        kind: 'landlord',
        legalName: 'Lifecycle Homes',
        displayName: 'Lifecycle',
      });
      async function home(line1: string, rent: number, status: string) {
        const address = await client.query<{ id: string }>(
          `insert into address (
             raw_input, line1, city, state, postal_code, normalized_hash,
             normalizer_vendor, normalizer_version
           ) values ($1,$1,'Austin','TX','78701',$2,'test','1')
           returning id`,
          [line1, `hash-${randomUUID()}`],
        );
        const property = await client.query<{ id: string }>(
          `insert into property (address_id, property_type) values ($1,'sfr') returning id`,
          [address.rows[0]!.id],
        );
        const unit = await client.query<{ id: string }>(
          `insert into unit (property_id, unit_label_normalized) values ($1,'1') returning id`,
          [property.rows[0]!.id],
        );
        const listing = await client.query<{ id: string }>(
          `insert into listing (org_id, unit_id, origin, rent_amount_cents, status)
           values ($1,$2,'manual',$3,$4) returning id`,
          [org.id, unit.rows[0]!.id, rent, status],
        );
        return { listingId: listing.rows[0]!.id, unitId: unit.rows[0]!.id, orgId: org.id };
      }
      const oak = await home('410 Renter Lane', 180000, 'active');
      const pine = await home('12 Pine Court', 160000, 'active');
      const archive = await home('88 Archive Road', 140000, 'paused');
      const profile = await client.query<{ id: string }>(
        `select id from renter_profile where party_id = $1`,
        [first.partyId],
      );
      const historical = await client.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, listing_id, unit_id, org_id, entry_point, status
         ) values ($1,$2,$3,$4,$5,'renter_initiated','draft')
         returning id`,
        [first.partyId, profile.rows[0]!.id, archive.listingId, archive.unitId, archive.orgId],
      );
      await emitDomainEvent(client, {
        aggregateType: 'application',
        aggregateId: historical.rows[0]!.id,
        eventType: 'application.access_token_issued',
        payload: { application_id: historical.rows[0]!.id },
        actorKind: 'system',
      });
      const recoverableHome = await home('9 Recovered Street', 150000, 'active');
      const recoverable = await client.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, listing_id, unit_id, org_id, entry_point, status
         ) values ($1,$2,$3,$4,$5,'renter_initiated','awaiting_landlord_interest')
         returning id`,
        [
          first.partyId,
          profile.rows[0]!.id,
          recoverableHome.listingId,
          recoverableHome.unitId,
          recoverableHome.orgId,
        ],
      );
      const stored = {
        captured_at: '2026-01-01T00:00:00.000Z',
        contact: { given_name: 'Historical', family_name: 'Renter', email, phone_e164: '+15125550100' },
        intake: {
          current_address_line1: '1 Stored Ave',
          current_address_city: 'Austin',
          employer_name: 'Stored Co',
          job_title: 'Clerk',
        },
      };
      const event = await emitDomainEvent(client, {
        aggregateType: 'application',
        aggregateId: recoverable.rows[0]!.id,
        eventType: INTAKE_FROZEN_EVENT,
        payload: { source: INTAKE_FROZEN_EVENT, snapshot: stored },
        actorKind: 'system',
      });
      const frozen = await client.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, listing_id, unit_id, org_id, entry_point, status, intake_snapshot
         ) values ($1,$2,$3,$4,$5,'renter_initiated','approved',$6::jsonb)
         returning id`,
        [
          first.partyId,
          profile.rows[0]!.id,
          pine.listingId,
          pine.unitId,
          pine.orgId,
          JSON.stringify({
            captured_at: '2026-02-01T00:00:00.000Z',
            contact: { given_name: 'Frozen', family_name: 'Renter' },
            intake: { employer_name: 'Original Co', job_title: 'Lead', current_address_line1: '2 Frozen St' },
          }),
        ],
      );
      await client.query(
        `insert into config_version (
           id, namespace, version, payload, effective_from,
           proposed_by_party_id, approved_by_party_id, approved_at
         ) values (
           gen_random_uuid(), 'application_access', 'renter-e2e',
           '{"token_ttl_ms":604800000}'::jsonb, now(), $1, $1, now()
         )`,
        [first.partyId],
      );
      return { oak, historicalId: historical.rows[0]!.id, recoverableId: recoverable.rows[0]!.id, eventId: event.id, frozenId: frozen.rows[0]!.id, stored };
    });

    const intake = mockRes();
    await handleUpsertRenterIntake(
      mockReq('/v1/renter/intake', again.credential, {
        current_address_line1: '500 Current St',
        current_address_city: 'Austin',
        current_address_state: 'TX',
        current_address_postal: '78702',
        employer_name: 'Current Co',
        job_title: 'Analyst',
        mark_complete: true,
      }),
      intake.res,
      deps,
    );
    expect(intake.status).toBe(200);

    const interest = mockRes();
    await handleCreateInterestApplication(
      mockReq('/v1/applications/interest', again.credential, { listing_id: homes.oak.listingId }),
      interest.res,
      deps,
    );
    expect(interest.status, JSON.stringify(interest.json)).toBe(201);
    const applicationId = String(interest.json?.application_id);
    const replay = mockRes();
    await handleCreateInterestApplication(
      mockReq('/v1/applications/interest', again.credential, { listing_id: homes.oak.listingId }),
      replay.res,
      deps,
    );
    expect(replay.status).toBe(200);
    expect(replay.json?.application_id).toBe(applicationId);
    expect(replay.json?.reused).toBe(true);

    const renamed = mockRes();
    await handleUpsertRenterProfile(
      mockReq('/v1/renter/profile', again.credential, {
        given_name: 'Eden',
        family_name: 'Renter',
        phone: '+15125550100',
        email,
        annual_income_cents: null,
        move_in_urgency: 'flexible',
        bedrooms_min: 2,
        rent_max_cents: 190000,
        state: 'TX',
        has_pets: false,
        household_size: 1,
      }),
      renamed.res,
      deps,
    );
    expect(renamed.status).toBe(200);

    const detail = mockRes();
    await handleGetApplicationIntakeDetail(
      mockReq(`/v1/applications/${applicationId}/details`, again.credential),
      detail.res,
      deps,
      applicationId,
    );
    expect(detail.status).toBe(200);
    const dossier = detail.json?.dossier as {
      mode: string;
      contact: { given_name: { value: string | null } };
      current_account: { contact: { given_name: { value: string | null } } } | null;
    };
    expect(dossier.mode).toBe('frozen_snapshot');
    expect(dossier.contact.given_name.value).toBe('Ada');
    expect(dossier.current_account?.contact.given_name.value).toBe('Eden');
    const renamedProfile = mockRes();
    await handleGetRenterProfile(
      mockReq('/v1/renter/profile', again.credential),
      renamedProfile.res,
      deps,
    );
    expect((renamedProfile.json?.profile as { given_name: string }).given_name).toBe('Eden');
    expect((detail.json?.listing as { line1: string }).line1).toBe('410 Renter Lane');
    expect((detail.json?.progress as { status_label: string; next_step: string }).status_label).toBe(
      'Interest sent',
    );
    expect((detail.json?.progress as { next_step: string }).next_step).toMatch(/this home/i);

    const list = mockRes();
    await handleListMyApplications(mockReq('/v1/renter/applications', again.credential), list.res, deps);
    expect(list.status).toBe(200);
    const applications = list.json?.applications as Array<{
      application_id: string;
      listing: { line1: string | null; rent_amount_cents: number | null } | null;
      progress: { status_label: string; next_step: string | null };
    }>;
    const archive = applications.find((row) => row.application_id === homes.historicalId);
    const sent = applications.find((row) => row.application_id === applicationId);
    expect(archive?.listing?.line1).toBe('88 Archive Road');
    expect(archive?.listing?.rent_amount_cents).toBe(140000);
    expect(archive?.progress.status_label).toBe('Started, not sent');
    expect(archive?.progress.next_step).toMatch(/no longer available/i);
    expect(sent?.listing?.line1).toBe('410 Renter Lane');
    expect(sent?.progress.status_label).toBe('Interest sent');

    const stranger = await signIn(db, `other-${randomUUID().slice(0, 8)}@example.com`, new Date());
    const hidden = mockRes();
    await handleListMyApplications(
      mockReq('/v1/renter/applications', stranger.credential),
      hidden.res,
      deps,
    );
    expect(hidden.status).toBe(200);
    expect(hidden.json?.applications).toEqual([]);
    const denied = mockRes();
    await handleGetApplicationIntakeDetail(
      mockReq(`/v1/applications/${applicationId}/details`, stranger.credential),
      denied.res,
      deps,
      applicationId,
    );
    expect(denied.status).toBe(404);

    const report = await withBypass(db.pool, async (client) => ({
      historical: await restoreSnapshotFromFreezeEvent(client, homes.historicalId),
      recoverable: await restoreSnapshotFromFreezeEvent(client, homes.recoverableId),
      frozen: await restoreSnapshotFromFreezeEvent(client, homes.frozenId),
      submitted: await restoreSnapshotFromFreezeEvent(client, applicationId),
    }));
    expect(report.historical.classification).toBe('not_recoverable');
    expect(report.historical.written).toBe(false);
    expect(report.recoverable.classification).toBe('recoverable_from_freeze_event');
    expect(report.recoverable.written).toBe(true);
    expect(report.frozen.written).toBe(false);
    expect(report.submitted.written).toBe(false);
    expect(homes.eventId).toBeTruthy();

    const stored = await withBypass(db.pool, (client) =>
      client.query<{ id: string; intake_snapshot: { contact?: { given_name?: string }; intake?: { employer_name?: string } } | null }>(
        `select id, intake_snapshot from application where id = any($1::uuid[])`,
        [[homes.historicalId, homes.recoverableId, homes.frozenId, applicationId]],
      ),
    );
    const byId = new Map(stored.rows.map((row) => [row.id, row.intake_snapshot]));
    expect(byId.get(homes.historicalId)).toBeNull();
    expect(byId.get(homes.recoverableId)).toMatchObject(homes.stored);
    expect(byId.get(homes.frozenId)?.contact?.given_name).toBe('Frozen');
    expect(byId.get(homes.frozenId)?.intake?.employer_name).toBe('Original Co');
    expect(byId.get(applicationId)?.contact?.given_name).toBe('Ada');
  });
});
