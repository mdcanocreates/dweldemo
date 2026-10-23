import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPartyWithIdentity } from '../../src/modules/identity/index.js';
import { decidePartnerIntake, submitPartnerIntake } from '../../src/modules/partner/index.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';

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
});
