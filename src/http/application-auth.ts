import type { IncomingMessage } from 'node:http';
import type { DbClient } from '../db/pool.js';
import { validateApplicationAccessToken } from '../modules/auth/index.js';
import { AppError } from '../modules/shared/errors.js';
import { getClientIp } from './request.js';

export type ApplicationAuth = {
  applicationId: string;
  partyId: string;
  orgId: string;
  tokenId: string;
};

/**
 * Resolve application access from Authorization: Bearer <token> (or X-Application-Access-Token).
 * Returns trusted party/org from the application row — never from client-supplied tenant IDs.
 */
export async function requireApplicationAccess(
  client: DbClient,
  req: IncomingMessage,
  applicationId: string,
): Promise<ApplicationAuth> {
  const header = req.headers.authorization;
  const alt = req.headers['x-application-access-token'];
  let token: string | null = null;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    token = header.slice(7).trim();
  } else if (typeof alt === 'string') {
    token = alt.trim();
  }
  if (!token) {
    throw new AppError('application access token required', 'application_access_required', 401);
  }

  const { tokenId } = await validateApplicationAccessToken(client, {
    applicationId,
    token,
    ip: getClientIp(req),
  });

  const { rows } = await client.query<{ party_id: string; org_id: string }>(
    `select party_id, org_id from application where id = $1`,
    [applicationId],
  );
  const app = rows[0];
  if (!app) {
    throw new AppError('application not found', 'application_not_found', 404);
  }

  return {
    applicationId,
    partyId: app.party_id,
    orgId: app.org_id,
    tokenId,
  };
}
