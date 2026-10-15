/**
 * Netlify demo host mode — navigation/UX only.
 * Never invents sessions or bypasses server authorization.
 */
export function isNetlifyDemoMode(): boolean {
  const flag = String(import.meta.env.VITE_DWEL_NETLIFY_DEMO ?? '').toLowerCase();
  return flag === 'true' || flag === '1';
}

export type NetlifyDemoRole = 'renter' | 'broker' | 'landlord';

/** Login deep-links — role query is return-path convenience only. */
export const NETLIFY_DEMO_ROLE_LOGIN: Record<
  NetlifyDemoRole,
  { label: string; href: string }
> = {
  renter: {
    label: 'Renter',
    href: '/auth/login?returnTo=%2Frenter&role=renter',
  },
  broker: {
    label: 'Broker',
    href: '/auth/login?returnTo=%2Fpartner%2Fbroker&role=broker',
  },
  landlord: {
    label: 'Home Provider',
    href: '/auth/login?returnTo=%2Fpartner%2Flandlord&role=landlord',
  },
};
