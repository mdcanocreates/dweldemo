/**
 * Legal approval flags — flip only after Jacob (GC) + Michael sign-off.
 * Do not set any flag to true from Cursor / agent tasks.
 */
export const LEGAL_APPROVED = {
  terms: false,
  privacy: false,
  ccpa: false,
  cashback: false,
} as const;

/** Canonical legal page paths (also used by footerLinks). */
export const LEGAL_ROUTES = {
  about: '/about',
  faqs: '/faqs',
  terms: '/terms',
  privacy: '/privacy',
  ccpa: '/ccpa',
  sitemap: '/sitemap',
  cashback: '/cashback-terms',
  fairHousing: '/legal/fair-housing',
} as const;
