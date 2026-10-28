import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  handleInternalCaseAction,
  handleInternalListPartnerReviews,
} from '../../src/http/internal-handlers.js';
import { assertAdmin } from '../../src/modules/admin/index.js';
import { createOrg, createPartyWithIdentity, grantRole } from '../../src/modules/identity/index.js';
import { AppError } from '../../src/modules/shared/errors.js';
import {
  decidePartnerIntake,
  latestPartnerIntake,
  submitPartnerIntake,
} from '../../src/modules/partner/index.js';
import { listPartnerReviewWorkItems } from '../../src/modules/internal/index.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';

const SERVICE_TOKEN = 'test-internal-token-32chars!!';

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
      return body ? JSON.parse(body) : null;
    },
  };
}

function mockReq(
  path: string,
  opts?: { method?: string; auth?: string; headers?: Record<string, string>; body?: unknown },
): IncomingMessage {
  const headers: Record<string, string> = {
    host: 'localhost',
    ...(opts?.auth ? { authorization: opts.auth } : {}),
    ...(opts?.headers ?? {}),
  };
  const raw = opts?.body !== undefined ? JSON.stringify(opts.body) : '';
  return {
    method: opts?.method ?? 'GET',
    url: path,
    headers,
    async *[Symbol.asyncIterator]() {
      if (raw) yield Buffer.from(raw);
    },
  } as unknown as IncomingMessage;
}

describe('partner intake', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('stores a landlord lead, keeps one open submission, and approval links an org role', async () => {
    await withBypass(db.pool, async (client) => {
      const applicant = await createPartyWithIdentity(client, db.kms, {
        identity: { email: `landlord-${Date.now()}@example.com`, givenName: 'Ada', familyName: 'Owner' },
      });
      const reviewer = await createPartyWithIdentity(client, db.kms, {
        identity: { email: `reviewer-${Date.now()}@example.com` },
      });
      const first = await submitPartnerIntake(client, applicant.partyId, {
        role: 'landlord',
        fullName: 'Ada Owner',
        email: 'ada@example.com',
        phone: '3125550100',
        organizationName: 'Oak Holdings',
        market: 'Chicago',
        portfolioSize: '42',
        propertyTypes: 'multifamily, single family',
        notes: 'Want inbound applicants',
      });
      expect(first.status).toBe('new');
      const again = await submitPartnerIntake(client, applicant.partyId, {
        role: 'landlord',
        fullName: 'Ada Owner',
        email: 'ada@example.com',
        phone: '3125550100',
        organizationName: 'Oak Holdings',
        market: 'Chicago',
        portfolioSize: '42',
        propertyTypes: 'multifamily',
      });
      expect(again.id).toBe(first.id);

      const approved = await decidePartnerIntake(client, {
        intakeId: first.id,
        decision: 'approved',
        actorPartyId: reviewer.partyId,
      });
      expect(approved.status).toBe('approved');
      expect(approved.org_id).toBeTruthy();
      const { rows } = await client.query<{ role: string; org_id: string }>(
        `select role, org_id from party_role where party_id = $1 and role = 'landlord'`,
        [applicant.partyId],
      );
      expect(rows[0]?.org_id).toBe(approved.org_id);
    });
  });

  it('stores a broker lead and rejection does not grant a portal role', async () => {
    await withBypass(db.pool, async (client) => {
      const applicant = await createPartyWithIdentity(client, db.kms, {
        identity: { email: `broker-${Date.now()}@example.com` },
      });
      const reviewer = await createPartyWithIdentity(client, db.kms, {
        identity: { email: `reviewer-b-${Date.now()}@example.com` },
      });
      const intake = await submitPartnerIntake(client, applicant.partyId, {
        role: 'broker',
        fullName: 'Bea Broker',
        email: 'bea@example.com',
        phone: '3125550199',
        organizationName: 'Horizon Realty',
        market: 'Chicago, Evanston',
        portfolioSize: 'team of 6',
        notes: 'Looking for listing distribution',
      });
      const rejected = await decidePartnerIntake(client, {
        intakeId: intake.id,
        decision: 'rejected',
        actorPartyId: reviewer.partyId,
      });
      expect(rejected.status).toBe('rejected');
      expect(rejected.org_id).toBeNull();
      const { rows } = await client.query(
        `select 1 from party_role where party_id = $1 and role = 'broker'`,
        [applicant.partyId],
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('shows a pending home-provider intake in the admin queue and keeps other provider records', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = SERVICE_TOKEN;
    const deps = { pool: db.pool };
    const existing = await withBypass(db.pool, async (client) => {
      const party = await createPartyWithIdentity(client, db.kms, {
        identity: { email: `existing-${Date.now()}@example.com` },
      });
      const org = await createOrg(client, {
        kind: 'landlord',
        legalName: 'Existing Holdings',
        displayName: 'Existing Holdings',
      });
      await grantRole(client, { partyId: party.partyId, orgId: org.id, role: 'landlord' });
      const selfId = randomUUID();
      await client.query(
        `insert into landlord_self_execution (
           id, org_id, submitted_by_party_id, license_state, license_type, license_number,
           business_entity_name, status
         ) values ($1,$2,$3,'TX','owner_occupant','L-1','Existing Holdings','pending')`,
        [selfId, org.id, party.partyId],
      );
      return { partyId: party.partyId, orgId: org.id, selfId };
    });

    const applicant = await withBypass(db.pool, async (client) =>
      createPartyWithIdentity(client, db.kms, {
        identity: { email: `intake-${Date.now()}@example.com`, givenName: 'Ned', familyName: 'New' },
      }),
    );
    const reviewer = await withBypass(db.pool, async (client) =>
      createPartyWithIdentity(client, db.kms, {
        identity: { email: `admin-${Date.now()}@example.com` },
      }),
    );

    const first = await withBypass(db.pool, (client) =>
      submitPartnerIntake(client, applicant.partyId, {
        role: 'landlord',
        fullName: 'Ned New',
        email: 'ned@example.com',
        phone: '3125550101',
        organizationName: 'New Homes',
        market: 'Chicago',
        portfolioSize: '2',
        propertyTypes: 'single family',
      }),
    );
    const retry = await withBypass(db.pool, (client) =>
      submitPartnerIntake(client, applicant.partyId, {
        role: 'landlord',
        fullName: 'Ned New',
        email: 'ned@example.com',
        phone: '3125550101',
        organizationName: 'Changed Name',
        market: 'Chicago',
        portfolioSize: '9',
        propertyTypes: 'condo',
      }),
    );
    expect(retry.id).toBe(first.id);
    expect(retry.organization_name).toBe('New Homes');
    expect(retry.status).toBe('new');

    const pending = await withBypass(db.pool, (client) =>
      listPartnerReviewWorkItems(client, { status: 'pending', limit: 50, offset: 0 }),
    );
    const intakeItem = pending.items.find((item) => item.sourceId === `partner-intake:${first.id}`);
    expect(intakeItem?.kind).toBe('home_provider_partner_review');
    expect(intakeItem?.sourceStatus).toBe('new');
    expect(intakeItem?.requiresAttention).toBe(true);
    const selfItem = pending.items.find((item) => item.sourceId === `partner-review:${existing.selfId}`);
    expect(selfItem?.kind).toBe('partner_review');
    expect(selfItem?.sourceStatus).toBe('pending');

    const unauth = mockRes();
    await handleInternalListPartnerReviews(
      mockReq('/internal/v1/partner-reviews?status=pending'),
      unauth.res,
      deps,
    );
    expect(unauth.status).toBe(401);

    const denied = mockRes();
    await handleInternalCaseAction(
      mockReq(`/internal/v1/cases/partner-intake:${first.id}/actions/approve`, {
        method: 'POST',
        auth: `Bearer ${SERVICE_TOKEN}`,
        headers: {
          'idempotency-key': randomUUID(),
          'x-rbit-actor-subject': applicant.partyId,
        },
        body: {},
      }),
      denied.res,
      deps,
      `partner-intake:${first.id}`,
      'approve',
    );
    expect(denied.status).toBe(403);

    await expect(
      withBypass(db.pool, (client) => assertAdmin(client, applicant.partyId)),
    ).rejects.toBeInstanceOf(AppError);

    const infoKey = randomUUID();
    const info = mockRes();
    await withBypass(db.pool, (client) =>
      grantRole(client, { partyId: reviewer.partyId, role: 'rbit_admin' }),
    );
    await handleInternalCaseAction(
      mockReq(`/internal/v1/cases/partner-intake:${first.id}/actions/request_information`, {
        method: 'POST',
        auth: `Bearer ${SERVICE_TOKEN}`,
        headers: {
          'idempotency-key': infoKey,
          'x-rbit-actor-subject': reviewer.partyId,
        },
        body: { reason: 'Need the property list' },
      }),
      info.res,
      deps,
      `partner-intake:${first.id}`,
      'request_information',
    );
    expect(info.status).toBe(200);
    const afterInfo = await withBypass(db.pool, (client) =>
      latestPartnerIntake(client, applicant.partyId, 'landlord'),
    );
    expect(afterInfo?.status).toBe('under_review');
    expect(afterInfo?.org_id).toBeNull();

    const approveKey = randomUUID();
    const approved = mockRes();
    await handleInternalCaseAction(
      mockReq(`/internal/v1/cases/partner-intake:${first.id}/actions/approve`, {
        method: 'POST',
        auth: `Bearer ${SERVICE_TOKEN}`,
        headers: {
          'idempotency-key': approveKey,
          'x-rbit-actor-subject': reviewer.partyId,
        },
        body: {},
      }),
      approved.res,
      deps,
      `partner-intake:${first.id}`,
      'approve',
    );
    expect(approved.status).toBe(200);
    const replay = mockRes();
    await handleInternalCaseAction(
      mockReq(`/internal/v1/cases/partner-intake:${first.id}/actions/approve`, {
        method: 'POST',
        auth: `Bearer ${SERVICE_TOKEN}`,
        headers: {
          'idempotency-key': approveKey,
          'x-rbit-actor-subject': reviewer.partyId,
        },
        body: {},
      }),
      replay.res,
      deps,
      `partner-intake:${first.id}`,
      'approve',
    );
    expect(replay.json).toEqual(approved.json);

    const saved = await withBypass(db.pool, async (client) => {
      const intake = await latestPartnerIntake(client, applicant.partyId, 'landlord');
      const roles = await client.query<{ role: string; org_id: string }>(
        `select role, org_id from party_role where party_id = $1 and role = 'landlord' and revoked_at is null`,
        [applicant.partyId],
      );
      const again = await submitPartnerIntake(client, applicant.partyId, {
        role: 'landlord',
        fullName: 'Ned New',
        email: 'ned@example.com',
        phone: '3125550101',
        organizationName: 'Should Not Duplicate',
        market: 'Chicago',
        portfolioSize: '2',
        propertyTypes: 'single family',
      });
      const count = await client.query<{ n: string }>(
        `select count(*)::text as n from partner_intake where party_id = $1 and role = 'landlord'`,
        [applicant.partyId],
      );
      const existingRole = await client.query<{ org_id: string }>(
        `select org_id from party_role where party_id = $1 and role = 'landlord' and revoked_at is null`,
        [existing.partyId],
      );
      const self = await client.query<{ status: string }>(
        `select status from landlord_self_execution where id = $1`,
        [existing.selfId],
      );
      const stillPending = await listPartnerReviewWorkItems(client, { status: 'pending' });
      return { intake, roles: roles.rows, again, count: count.rows[0]?.n, existingRole: existingRole.rows, self: self.rows[0], stillPending };
    });
    expect(saved.intake?.status).toBe('approved');
    expect(saved.intake?.org_id).toBeTruthy();
    expect(saved.roles).toHaveLength(1);
    expect(saved.roles[0]?.org_id).toBe(saved.intake?.org_id);
    expect(saved.again.id).toBe(first.id);
    expect(saved.count).toBe('1');
    expect(saved.existingRole[0]?.org_id).toBe(existing.orgId);
    expect(saved.self?.status).toBe('pending');
    expect(saved.stillPending.items.some((item) => item.sourceId === `partner-intake:${first.id}`)).toBe(
      false,
    );

    const rejectedApplicant = await withBypass(db.pool, (client) =>
      createPartyWithIdentity(client, db.kms, {
        identity: { email: `reject-${Date.now()}@example.com` },
      }),
    );
    const rejectedIntake = await withBypass(db.pool, (client) =>
      submitPartnerIntake(client, rejectedApplicant.partyId, {
        role: 'landlord',
        fullName: 'No Access',
        email: 'no@example.com',
        phone: '3125550102',
        organizationName: 'Closed Door',
        market: 'Chicago',
        portfolioSize: '1',
        propertyTypes: 'condo',
      }),
    );
    const rejected = mockRes();
    await handleInternalCaseAction(
      mockReq(`/internal/v1/cases/partner-intake:${rejectedIntake.id}/actions/decline`, {
        method: 'POST',
        auth: `Bearer ${SERVICE_TOKEN}`,
        headers: {
          'idempotency-key': randomUUID(),
          'x-rbit-actor-subject': reviewer.partyId,
        },
        body: { reason: 'Not a fit' },
      }),
      rejected.res,
      deps,
      `partner-intake:${rejectedIntake.id}`,
      'decline',
    );
    expect(rejected.status).toBe(200);
    const deniedRole = await withBypass(db.pool, (client) =>
      client.query(
        `select 1 from party_role where party_id = $1 and role = 'landlord' and revoked_at is null`,
        [rejectedApplicant.partyId],
      ),
    );
    expect(deniedRole.rows).toHaveLength(0);
    const rejectedRow = await withBypass(db.pool, (client) =>
      latestPartnerIntake(client, rejectedApplicant.partyId, 'landlord'),
    );
    expect(rejectedRow?.status).toBe('rejected');
    expect(rejectedRow?.org_id).toBeNull();
  });

  it('lets a Control Center cognito subject decide without becoming a Dwel party', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = SERVICE_TOKEN;
    const deps = { pool: db.pool };
    const applicant = await withBypass(db.pool, (client) =>
      createPartyWithIdentity(client, db.kms, {
        identity: { email: `cc-${Date.now()}@example.com`, givenName: 'Cam', familyName: 'Staff' },
      }),
    );
    const intake = await withBypass(db.pool, (client) =>
      submitPartnerIntake(client, applicant.partyId, {
        role: 'broker',
        fullName: 'Cam Staff',
        email: 'cam@example.com',
        phone: '3125550199',
        organizationName: 'Staff Brokerage',
        market: 'Columbus',
        portfolioSize: '4',
        propertyTypes: 'multifamily',
      }),
    );
    const subject = `cognito:${randomUUID()}`;

    const missing = mockRes();
    await handleInternalCaseAction(
      mockReq(`/internal/v1/cases/partner-intake:${intake.id}/actions/approve`, {
        method: 'POST',
        headers: {
          'idempotency-key': randomUUID(),
          'x-rbit-actor-subject': subject,
        },
        body: {},
      }),
      missing.res,
      deps,
      `partner-intake:${intake.id}`,
      'approve',
    );
    expect(missing.status).toBe(401);

    const infoKey = randomUUID();
    const info = mockRes();
    await handleInternalCaseAction(
      mockReq(`/internal/v1/cases/partner-intake:${intake.id}/actions/request_information`, {
        method: 'POST',
        auth: `Bearer ${SERVICE_TOKEN}`,
        headers: {
          'idempotency-key': infoKey,
          'x-rbit-actor-subject': subject,
        },
        body: { reason: 'Send the brokerage license' },
      }),
      info.res,
      deps,
      `partner-intake:${intake.id}`,
      'request_information',
    );
    expect(info.status).toBe(200);
    const afterInfo = await withBypass(db.pool, (client) =>
      latestPartnerIntake(client, applicant.partyId, 'broker'),
    );
    expect(afterInfo?.status).toBe('under_review');
    expect(afterInfo?.org_id).toBeNull();

    const approveKey = randomUUID();
    const approved = mockRes();
    await handleInternalCaseAction(
      mockReq(`/internal/v1/cases/partner-intake:${intake.id}/actions/approve`, {
        method: 'POST',
        auth: `Bearer ${SERVICE_TOKEN}`,
        headers: {
          'idempotency-key': approveKey,
          'x-rbit-actor-subject': subject,
        },
        body: {},
      }),
      approved.res,
      deps,
      `partner-intake:${intake.id}`,
      'approve',
    );
    expect(approved.status).toBe(200);
    const replay = mockRes();
    await handleInternalCaseAction(
      mockReq(`/internal/v1/cases/partner-intake:${intake.id}/actions/approve`, {
        method: 'POST',
        auth: `Bearer ${SERVICE_TOKEN}`,
        headers: {
          'idempotency-key': approveKey,
          'x-rbit-actor-subject': subject,
        },
        body: {},
      }),
      replay.res,
      deps,
      `partner-intake:${intake.id}`,
      'approve',
    );
    expect(replay.json).toEqual(approved.json);

    const saved = await withBypass(db.pool, async (client) => {
      const row = await latestPartnerIntake(client, applicant.partyId, 'broker');
      const roles = await client.query<{ role: string }>(
        `select role from party_role where party_id = $1 and role = 'broker' and revoked_at is null`,
        [applicant.partyId],
      );
      const audit = await client.query<{ actor_party_id: string; after_state: { actor_subject?: string } }>(
        `select actor_party_id, after_state
         from admin_action_log
         where target_id = $1 and action = 'partner_intake.decide'
         order by seq desc
         limit 1`,
        [intake.id],
      );
      const staffParty = await client.query(
        `select 1 from party where id = $1`,
        [audit.rows[0]?.actor_party_id],
      );
      return { row, roles: roles.rows, audit: audit.rows[0], staffParty: staffParty.rowCount };
    });
    expect(saved.row?.status).toBe('approved');
    expect(saved.row?.org_id).toBeTruthy();
    expect(saved.roles).toEqual([{ role: 'broker' }]);
    expect(saved.audit?.after_state.actor_subject).toBe(subject);
    expect(saved.staffParty).toBe(0);
  });
});
