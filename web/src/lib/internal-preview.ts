/** Client mirror of server-authorized internal preview — never trust alone. */
const ROLE_KEY = 'dwel.internal.preview.role';
const AUTH_KEY = 'dwel.internal.preview.authorized';

export type PreviewRole = 'landlord' | 'broker' | 'renter';

export function getPreviewRole(): PreviewRole | null {
  try {
    if (sessionStorage.getItem(AUTH_KEY) !== '1') return null;
    const v = sessionStorage.getItem(ROLE_KEY);
    if (v === 'landlord' || v === 'broker' || v === 'renter') return v;
    return null;
  } catch {
    return null;
  }
}

/**
 * Only call after GET/POST /v1/internal/preview returns allowed: true.
 * Mirrors server preview cookie — does not grant production RBAC.
 */
export function setPreviewRole(role: PreviewRole | null): void {
  try {
    if (role) {
      sessionStorage.setItem(ROLE_KEY, role);
      sessionStorage.setItem(AUTH_KEY, '1');
    } else {
      sessionStorage.removeItem(ROLE_KEY);
      sessionStorage.removeItem(AUTH_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function previewRoleLabel(role: PreviewRole): string {
  if (role === 'landlord') return 'Home Provider';
  if (role === 'broker') return 'Broker';
  return 'Renter';
}
