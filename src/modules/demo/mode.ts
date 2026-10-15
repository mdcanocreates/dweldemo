/**
 * Demo mode gates — meeting demo only.
 * Never silently route normal applications into the demo screening provider.
 */

export const DEMO_TERMS_VERSION = '2026-10-demo-v1';

export function isDemoModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.DWEL_DEMO_ENABLED?.trim().toLowerCase();
  return v === '1' || v === 'true';
}

/** Canonical demo org slug / name markers used when seeding demo tenants. */
export function isDemoOrgSlug(slugOrName: string | null | undefined): boolean {
  if (!slugOrName) return false;
  const s = slugOrName.trim().toLowerCase();
  return s === 'dwel-demo' || s === 'demo' || s.startsWith('demo-') || s.includes('dwel-demo');
}
