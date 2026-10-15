/**
 * LOCAL-ONLY UI inspection mode (#/internal/ui-preview).
 * Never enables in production builds. Does not create real sessions
 * or grant access to protected backend routes.
 */

export type UiPreviewRole = 'renter' | 'landlord' | 'broker';

const STORAGE_KEY = 'dwel.ui_preview.v1';

type Stored = {
  active: boolean;
  role: UiPreviewRole;
};

function readStored(): Stored | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
}

function writeStored(value: Stored | null): void {
  try {
    if (!value) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Hard refuse production — Vite production builds + NODE_ENV/APP_ENV guards. */
export function isUiPreviewAllowed(): boolean {
  if (!import.meta.env.DEV) return false;
  if (import.meta.env.PROD) return false;
  const appEnv = String(import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE ?? '').toLowerCase();
  if (appEnv === 'production' || appEnv === 'prod') return false;
  return true;
}

export function isUiPreviewPath(
  hash = typeof window !== 'undefined' ? window.location.hash : '',
): boolean {
  return hash.startsWith('#/internal/ui-preview') || hash.includes('ui_preview=1');
}

export function isUiPreviewActive(): boolean {
  if (!isUiPreviewAllowed()) return false;
  const stored = readStored();
  if (stored?.active) return true;
  return isUiPreviewPath();
}

export function getUiPreviewRole(): UiPreviewRole | null {
  if (!isUiPreviewActive()) return null;
  return readStored()?.role ?? 'renter';
}

export function startUiPreview(role: UiPreviewRole = 'renter'): void {
  if (!isUiPreviewAllowed()) {
    throw new Error('UI preview is disabled outside local development');
  }
  writeStored({ active: true, role });
}

export function setUiPreviewRole(role: UiPreviewRole): void {
  if (!isUiPreviewAllowed()) return;
  writeStored({ active: true, role });
}

export function stopUiPreview(): void {
  writeStored(null);
}

export function uiPreviewHomeForRole(role: UiPreviewRole): string {
  if (role === 'landlord') return '/dashboard';
  if (role === 'broker') return '/broker/dashboard';
  return '/home';
}
