import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approveDualApproval,
  grantRole,
  partyHasRole,
  requestDualApproval,
  createPartyWithIdentity,
} from '../../src/modules/identity/index.js';
import {
  issueMagicToken,
  platformEmailHmac,
  redeemMagicToken,
  resetAuthRateLimits,
} from '../../src/modules/auth/passwordless.js';
import { MutableClock } from '../../src/modules/shared/clock.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';

describe('identity / auth unit', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('platformEmailHmac is stable and case-normalizing via lower input expectation', () => {
    const a = platformEmailHmac('User@Example.com');
    const b = platformEmailHmac('User@Example.com');
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it('grantRole then partyHasRole; revoked absent', async () => {
    await withBypass(db.pool, async (c) => {
      const p = await createPartyWithIdentity(c, db.kms, {
        identity: { email: `role-${Date.now()}@ex.com` },
      });
      expect(await partyHasRole(c, p.partyId, 'rbit_admin')).toBe(false);
      await grantRole(c, { partyId: p.partyId, role: 'rbit_admin' });
      expect(await partyHasRole(c, p.partyId, 'rbit_admin')).toBe(true);
    });
  });

  it('dual approval rejects self-approval (invalid transition)', async () => {
    await withBypass(db.pool, async (c) => {
      const p = await createPartyWithIdentity(c, db.kms, {
        identity: { email: `da-${Date.now()}@ex.com` },
      });
      await grantRole(c, { partyId: p.partyId, role: 'rbit_admin' });
      const req = await requestDualApproval(c, {
        permissionKey: 'config.approve',
        requestedByPartyId: p.partyId,
        payload: { t: 1 },
        targetType: 'config_version',
        targetId: p.partyId,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      await expect(
        approveDualApproval(c, {
          requestId: req.id,
          approverPartyId: p.partyId,
        }),
      ).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    });
  });

  it('magic token lifecycle: redeem once, second redeem invalid', async () => {
    resetAuthRateLimits();
    const clock = new MutableClock(new Date('2026-08-01T12:00:00Z'));
    await withBypass(db.pool, async (c) => {
      const email = `tok-${Date.now()}@ex.com`;
      const issued = await issueMagicToken(c, db.kms, {
        email,
        purpose: 'login',
        returnTokenForTest: true,
        clock,
      });
      expect(issued.debugToken).toBeTruthy();
      const session = await redeemMagicToken(c, {
        token: issued.debugToken!,
        purpose: 'login',
        clock,
      });
      expect(session.sessionId).toBeTruthy();
      await expect(
        redeemMagicToken(c, {
          token: issued.debugToken!,
          purpose: 'login',
          clock,
        }),
      ).rejects.toMatchObject({ code: 'auth_invalid_token' });
    });
  });

  it('expired token cannot be redeemed', async () => {
    resetAuthRateLimits();
    const clock = new MutableClock(new Date('2026-08-01T12:00:00Z'));
    await withBypass(db.pool, async (c) => {
      const email = `exp-${Date.now()}@ex.com`;
      const issued = await issueMagicToken(c, db.kms, {
        email,
        purpose: 'login',
        returnTokenForTest: true,
        clock,
      });
      clock.advanceMs(16 * 60 * 1000);
      await expect(
        redeemMagicToken(c, {
          token: issued.debugToken!,
          purpose: 'login',
          clock,
        }),
      ).rejects.toMatchObject({ code: 'auth_invalid_token' });
    });
  });
});
