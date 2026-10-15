/**
 * Standalone Netlify demo (VITE_DWEL_NETLIFY_DEMO).
 * Local email gate + in-memory session only — never production auth or API access.
 */

export type NetlifyDemoRole = 'renter' | 'broker' | 'landlord';

export const NETLIFY_DEMO_EMAILS = [
  'info@rbitfinancial.com',
  'mdcano@rbitfinancial.com',
  'addison@rbitfinancial.com',
  'michaelsorge@rbitfinancial.com',
] as const;

const STORAGE_KEY = 'dwel.netlify_demo.v1';
const DEMO_EVENT = 'dwel-netlify-demo';

type Stored = {
  active: boolean;
  email: string;
  role: NetlifyDemoRole;
};

export function isNetlifyDemoMode(): boolean {
  const flag = String(import.meta.env.VITE_DWEL_NETLIFY_DEMO ?? '').toLowerCase();
  return flag === 'true' || flag === '1';
}

/** True when this build must never call a live Dwel API. */
export function shouldBlockOutboundApi(): boolean {
  return isNetlifyDemoMode();
}

export function normalizeDemoEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isNetlifyDemoEmailAllowed(email: string): boolean {
  const normalized = normalizeDemoEmail(email);
  return (NETLIFY_DEMO_EMAILS as readonly string[]).includes(normalized);
}

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
  if (typeof window !== 'undefined' && typeof Event !== 'undefined') {
    window.dispatchEvent(new Event(DEMO_EVENT));
  }
}

export function isNetlifyDemoSessionActive(): boolean {
  if (!isNetlifyDemoMode()) return false;
  return Boolean(readStored()?.active);
}

export function getNetlifyDemoRole(): NetlifyDemoRole | null {
  if (!isNetlifyDemoSessionActive()) return null;
  return readStored()?.role ?? 'renter';
}

export function getNetlifyDemoEmail(): string | null {
  if (!isNetlifyDemoSessionActive()) return null;
  return readStored()?.email ?? null;
}

export function startNetlifyDemoSession(
  email: string,
  role: NetlifyDemoRole = 'renter',
): { ok: true } | { ok: false; error: string } {
  if (!isNetlifyDemoMode()) {
    return { ok: false, error: 'Netlify demo mode is not enabled in this build.' };
  }
  if (!isNetlifyDemoEmailAllowed(email)) {
    return {
      ok: false,
      error: 'This demo is limited to designated RBIT email addresses.',
    };
  }
  writeStored({
    active: true,
    email: normalizeDemoEmail(email),
    role,
  });
  return { ok: true };
}

export function setNetlifyDemoRole(role: NetlifyDemoRole): void {
  if (!isNetlifyDemoMode()) return;
  const current = readStored();
  if (!current?.active) {
    writeStored({
      active: true,
      email: current?.email ?? NETLIFY_DEMO_EMAILS[0],
      role,
    });
    return;
  }
  writeStored({ ...current, role });
}

export function stopNetlifyDemoSession(): void {
  writeStored(null);
}

export function netlifyDemoHomeForRole(role: NetlifyDemoRole): string {
  if (role === 'landlord') return '/dashboard';
  if (role === 'broker') return '/broker/dashboard';
  return '/home';
}

export function netlifyDemoEventName(): string {
  return DEMO_EVENT;
}

/** Role chrome targets — portals, not magic-link login. */
export const NETLIFY_DEMO_ROLE_ENTRY: Record<
  NetlifyDemoRole,
  { label: string; href: string }
> = {
  renter: { label: 'Renter', href: '/home' },
  broker: { label: 'Broker', href: '/broker/dashboard' },
  landlord: { label: 'Home Provider', href: '/dashboard' },
};

/** @deprecated Prefer NETLIFY_DEMO_ROLE_ENTRY — kept for older tests/docs. */
export const NETLIFY_DEMO_ROLE_LOGIN = {
  renter: {
    label: 'Renter',
    href: '/auth/login?returnTo=%2Fhome&role=renter',
  },
  broker: {
    label: 'Broker',
    href: '/auth/login?returnTo=%2Fbroker%2Fdashboard&role=broker',
  },
  landlord: {
    label: 'Home Provider',
    href: '/auth/login?returnTo=%2Fdashboard&role=landlord',
  },
} as const;
