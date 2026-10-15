import type { IncomingMessage } from 'node:http';
import { withSystemBypass } from '../db/bypass.js';
import type { DbPool } from '../db/pool.js';
import { getKmsProvider } from '../infra/crypto/kms.js';
import { platformEmailHmac } from '../modules/auth/passwordless.js';
import { readPartyIdentity } from '../modules/identity/party.js';
import { requireSession } from './session-auth.js';
import type { SessionIdentity } from '../modules/auth/session.js';

export type PreviewRole = 'renter' | 'landlord' | 'broker';

/** Seeded Fake Oaks Properties — Home Provider preview org. */
export const PREVIEW_LANDLORD_ORG_ID = 'a1000000-0000-4000-8000-000000000010';
/** Seeded Fake Horizon Realty — Broker preview org. */
export const PREVIEW_BROKER_ORG_ID = 'a1000000-0000-4000-8000-000000000020';
/** Seeded renter email used to resolve preview_party_id (never trust client). */
export const PREVIEW_RENTER_EMAIL = 'mdcanocreates@gmail.com';

export const PREVIEW_ROLES: PreviewRole[] = ['renter', 'landlord', 'broker'];

export type PreviewContext = {
  enabled: true;
  role: PreviewRole;
  previewOrgId: string | null;
  previewPartyId: string | null;
  email: string;
  sessionPartyId: string;
};

export type PreviewCookiePayload = {
  role: PreviewRole;
  orgId: string | null;
  partyId: string | null;
};

export function previewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DWEL_INTERNAL_PREVIEW_ENABLED === 'true';
}

export function previewAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.DWEL_INTERNAL_PREVIEW_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Server-side map only — never accept arbitrary client org IDs. */
export function mapPreviewRoleToContext(role: PreviewRole): {
  orgId: string | null;
  renterEmail: string | null;
} {
  if (role === 'landlord') {
    return { orgId: PREVIEW_LANDLORD_ORG_ID, renterEmail: null };
  }
  if (role === 'broker') {
    return { orgId: PREVIEW_BROKER_ORG_ID, renterEmail: null };
  }
  return { orgId: null, renterEmail: PREVIEW_RENTER_EMAIL };
}

export function parsePreviewCookie(req: IncomingMessage): PreviewCookiePayload | null {
  const raw = req.headers.cookie ?? '';
  const match = /(?:^|;\s*)dwel_preview=([^;]+)/.exec(raw);
  if (!match?.[1]) {
    // Backward-compat: role-only cookie from earlier preview build
    const legacy = /(?:^|;\s*)dwel_preview_role=([^;]+)/.exec(raw);
    if (!legacy?.[1]) return null;
    const role = decodeURIComponent(legacy[1]) as PreviewRole;
    if (!PREVIEW_ROLES.includes(role)) return null;
    const mapped = mapPreviewRoleToContext(role);
    return { role, orgId: mapped.orgId, partyId: null };
  }
  try {
    const json = Buffer.from(decodeURIComponent(match[1]), 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as PreviewCookiePayload;
    if (!PREVIEW_ROLES.includes(parsed.role)) return null;
    const mapped = mapPreviewRoleToContext(parsed.role);
    // Re-bind org from server map — ignore forged org ids
    return {
      role: parsed.role,
      orgId: mapped.orgId,
      partyId: parsed.role === 'renter' && parsed.partyId ? parsed.partyId : null,
    };
  } catch {
    return null;
  }
}

export function previewCookieHeaders(payload: PreviewCookiePayload | null): string[] {
  // Clear legacy role cookie and set/clear structured preview cookie
  const clearLegacy = 'dwel_preview_role=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly';
  if (!payload) {
    return [clearLegacy, 'dwel_preview=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly'];
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return [
    clearLegacy,
    `dwel_preview=${encodeURIComponent(encoded)}; Path=/; Max-Age=${60 * 60 * 8}; SameSite=Lax; HttpOnly`,
  ];
}

export async function resolvePreviewEmail(
  pool: DbPool,
  partyId: string,
): Promise<string | null> {
  const allow = previewAllowlist();
  const matched = await withSystemBypass(pool, async (client) => {
    for (const email of allow) {
      const hmacHex = platformEmailHmac(email).toString('hex');
      const { rows } = await client.query<{ party_id: string }>(
        `select party_id from external_identity_ref
         where vendor = 'email' and vendor_subject_id = $1 and party_id = $2`,
        [hmacHex, partyId],
      );
      if (rows[0]) return email;
    }
    return null;
  });
  if (matched) return matched;

  try {
    const party = await withSystemBypass(pool, (client) =>
      readPartyIdentity(client, getKmsProvider(), partyId),
    );
    return party.email?.trim().toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export async function lookupPartyIdByEmail(
  pool: DbPool,
  email: string,
): Promise<string | null> {
  const hmacHex = platformEmailHmac(email).toString('hex');
  return withSystemBypass(pool, async (client) => {
    const { rows } = await client.query<{ party_id: string }>(
      `select party_id from external_identity_ref
       where vendor = 'email' and vendor_subject_id = $1
       limit 1`,
      [hmacHex],
    );
    return rows[0]?.party_id ?? null;
  });
}

/**
 * Authorize preview for the current session. Does not mutate party_role.
 */
export async function authorizePreviewAccount(
  pool: DbPool,
  req: IncomingMessage,
): Promise<
  | { ok: true; email: string; partyId: string; sessionId: string; identity: SessionIdentity }
  | { ok: false; code: string; message: string; status: number }
> {
  if (!previewEnabled()) {
    return {
      ok: false,
      code: 'preview_disabled',
      message: 'Internal preview is not enabled',
      status: 403,
    };
  }
  const allow = previewAllowlist();
  if (allow.length === 0) {
    return {
      ok: false,
      code: 'preview_misconfigured',
      message: 'Preview allowlist is empty',
      status: 403,
    };
  }

  const identity = await requireSession(pool, req);
  const email = await resolvePreviewEmail(pool, identity.partyId);
  if (!email || !allow.includes(email)) {
    return {
      ok: false,
      code: 'preview_forbidden',
      message: 'Not authorized for internal preview',
      status: 403,
    };
  }
  return {
    ok: true,
    email,
    partyId: identity.partyId,
    sessionId: identity.sessionId,
    identity,
  };
}

/**
 * Active preview context for API handlers.
 * Re-validates allowlist on every request — cookie alone is never enough.
 */
export async function resolveActivePreviewContext(
  pool: DbPool,
  req: IncomingMessage,
): Promise<PreviewContext | null> {
  const cookie = parsePreviewCookie(req);
  if (!cookie) return null;

  const authz = await authorizePreviewAccount(pool, req);
  if (!authz.ok) return null;

  const mapped = mapPreviewRoleToContext(cookie.role);
  let previewPartyId: string | null = null;
  if (cookie.role === 'renter') {
    // Resolve seeded renter party server-side; ignore forged party ids unless they match seed email
    previewPartyId = await lookupPartyIdByEmail(pool, PREVIEW_RENTER_EMAIL);
  }

  return {
    enabled: true,
    role: cookie.role,
    previewOrgId: mapped.orgId,
    previewPartyId,
    email: authz.email,
    sessionPartyId: authz.partyId,
  };
}

/** True when this request is in active internal preview (allowlisted + cookie). */
export async function isPreviewRequest(pool: DbPool, req: IncomingMessage): Promise<boolean> {
  return Boolean(await resolveActivePreviewContext(pool, req));
}
