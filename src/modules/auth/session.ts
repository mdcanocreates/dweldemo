import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';

export type SessionIdentity = {
  sessionId: string;
  partyId: string;
  roles: Array<{ role: string; orgId: string | null }>;
};

export async function loadSessionIdentity(
  client: DbClient,
  sessionId: string,
): Promise<SessionIdentity> {
  const { rows } = await client.query<{
    id: string;
    party_id: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `select id, party_id, expires_at, revoked_at
     from session
     where id = $1`,
    [sessionId],
  );
  const session = rows[0];
  if (!session || session.revoked_at || session.expires_at.getTime() < Date.now()) {
    throw new AppError('session invalid or expired', 'auth_session_invalid', 401);
  }

  await client.query(`update session set last_seen_at = now() where id = $1`, [sessionId]);

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
