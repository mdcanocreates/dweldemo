/**
 * In-process Secrets Manager stub for credential vault (§6A.7).
 * Production swaps to AWS Secrets Manager; credential_ref is only a handle.
 */

export type StoredCredential = {
  primary: string;
  secondary?: string | null;
  expiresAt?: Date | null;
  oauthRefreshToken?: string | null;
  kind: 'api_key' | 'oauth' | 'hmac_secret' | 'basic';
};

const vault = new Map<string, StoredCredential>();
let seq = 0;

export function resetCredentialVault(): void {
  vault.clear();
  seq = 0;
}

export function putCredential(
  value: StoredCredential,
  ref?: string,
): string {
  const handle = ref ?? `sm:ingestion/cred-${++seq}`;
  vault.set(handle, {
    ...value,
    secondary: value.secondary ?? null,
    expiresAt: value.expiresAt ?? null,
    oauthRefreshToken: value.oauthRefreshToken ?? null,
  });
  return handle;
}

export function getCredential(ref: string): StoredCredential | null {
  return vault.get(ref) ?? null;
}

/** Active secrets during dual-credential rotation window (primary + secondary). */
export function activeSecrets(ref: string): string[] {
  const c = vault.get(ref);
  if (!c) return [];
  const out = [c.primary];
  if (c.secondary) out.push(c.secondary);
  return out;
}

export function rotateCredential(
  ref: string,
  newPrimary: string,
  opts?: { keepOldAsSecondary?: boolean; expiresAt?: Date },
): void {
  const cur = vault.get(ref);
  if (!cur) throw new Error('credential_ref not found');
  vault.set(ref, {
    ...cur,
    secondary: opts?.keepOldAsSecondary === false ? null : cur.primary,
    primary: newPrimary,
    expiresAt: opts?.expiresAt ?? cur.expiresAt,
  });
}

export function completeRotation(ref: string): void {
  const cur = vault.get(ref);
  if (!cur) return;
  vault.set(ref, { ...cur, secondary: null });
}

export async function refreshOAuth(ref: string): Promise<{ ok: boolean; message?: string }> {
  const cur = vault.get(ref);
  if (!cur) return { ok: false, message: 'missing_credential' };
  if (cur.kind !== 'oauth') return { ok: false, message: 'not_oauth' };
  if (!cur.oauthRefreshToken) return { ok: false, message: 'missing_refresh' };
  // Stub refresh — mint new primary without logging secrets.
  const newAccess = `access_refreshed_${Date.now()}`;
  vault.set(ref, {
    ...cur,
    primary: newAccess,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  return { ok: true };
}

/** Never stringify credential material into logs / error_detail. */
export function sanitizeErrorDetail(detail: string, refs: string[] = []): string {
  let out = detail;
  for (const ref of refs) {
    for (const secret of activeSecrets(ref)) {
      if (secret) out = out.split(secret).join('[REDACTED_CREDENTIAL]');
    }
  }
  return out
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|secret|password|token)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

export function credentialExpiryRunwayDays(ref: string, now = new Date()): number | null {
  const c = vault.get(ref);
  if (!c?.expiresAt) return null;
  return (c.expiresAt.getTime() - now.getTime()) / (24 * 3600_000);
}
