import { createHash, randomBytes } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import { sessionLifetimeMs } from './rbit-auth/index.js';

export type SessionIdentity = {
  sessionId: string;
  partyId: string;
  roles: Array<{ role: string; orgId: string | null }>;
};

export async function insertUserSession(
  client: DbClient,
  input: {
    partyId: string;
    remember: boolean;
    deviceFingerprint?: string | null;
    now: Date;
    elevationTtlMs: number;
  },
): Promise<{ sessionId: string; credential: string; absoluteExpiresAt: Date }> {
  const lifetime = sessionLifetimeMs(input.remember);
  const absoluteExpiresAt = new Date(input.now.getTime() + lifetime.absoluteMs);
  const idleExpiresAt = new Date(
    Math.min(input.now.getTime() + lifetime.idleMs, absoluteExpiresAt.getTime()),
  );
  const credential = randomBytes(32).toString('base64url');
  const secretHash = createHash('sha256').update(credential).digest();
  const sessionId = (
    await client.query<{ id: string }>(
      `insert into session (
         party_id, device_fingerprint, expires_at, elevated_until,
         secret_hash, idle_expires_at, absolute_expires_at, remember_device,
         credential_rotated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning id`,
      [
        input.partyId,
        input.deviceFingerprint ?? null,
        absoluteExpiresAt,
        new Date(input.now.getTime() + input.elevationTtlMs),
        secretHash,
        idleExpiresAt,
        absoluteExpiresAt,
        input.remember,
        input.now,
      ],
    )
  ).rows[0]!.id;
  return { sessionId, credential, absoluteExpiresAt };
}

export async function loadSessionIdentity(
  client: DbClient,
  presented: string,
): Promise<SessionIdentity> {
  const secretHash = createHash('sha256').update(presented).digest();
  const allowLegacyId = process.env.AUTH_LEGACY_SESSION_BEARER !== '0';
  const { rows } = await client.query<{
    id: string;
    party_id: string;
    expires_at: Date;
    revoked_at: Date | null;
    idle_expires_at: Date | null;
    absolute_expires_at: Date | null;
    remember_device: boolean | null;
  }>(
    `select id, party_id, expires_at, revoked_at,
            idle_expires_at, absolute_expires_at, remember_device
     from session
     where secret_hash = $1
        or (
          previous_secret_hash = $1
          and previous_secret_valid_until is not null
          and previous_secret_valid_until > now()
        )
        or ($2::boolean and id::text = $3)
     limit 1`,
    [secretHash, allowLegacyId, presented],
  );
  const session = rows[0];
  const now = Date.now();
  const absoluteMs = session?.absolute_expires_at?.getTime() ?? session?.expires_at.getTime();
  const idleMs = session?.idle_expires_at?.getTime() ?? absoluteMs;
  if (
    !session ||
    session.revoked_at ||
    (absoluteMs != null && absoluteMs <= now) ||
    (idleMs != null && idleMs <= now)
  ) {
    throw new AppError('session invalid or expired', 'auth_session_invalid', 401);
  }

  const nextIdle = new Date(
    Math.min(now + (session.remember_device ? 30 : 1) * 24 * 60 * 60 * 1000, absoluteMs ?? now),
  );
  await client.query(
    `update session
     set last_seen_at = now(),
         idle_expires_at = least($2, coalesce(absolute_expires_at, expires_at))
     where id = $1
       and last_seen_at < now() - interval '2 minutes'`,
    [session.id, nextIdle],
  );

  const { rows: roles } = await client.query<{ role: string; org_id: string | null }>(
    `select role, org_id from party_role where party_id = $1`,
    [session.party_id],
  );

  return {
    sessionId: session.id,
    partyId: session.party_id,
    roles: roles.map((r) => ({ role: r.role, orgId: r.org_id })),
  };
}

export async function revokeSession(client: DbClient, sessionId: string): Promise<void> {
  await client.query(`update session set revoked_at = now() where id = $1 and revoked_at is null`, [
    sessionId,
  ]);
}

export function pickOrgForRole(
  identity: SessionIdentity,
  roles: string[],
): { role: string; orgId: string } | null {
  for (const role of roles) {
    const match = identity.roles.find((r) => r.role === role && r.orgId);
    if (match?.orgId) return { role: match.role, orgId: match.orgId };
  }
  return null;
}
