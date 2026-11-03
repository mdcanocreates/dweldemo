import { LEGAL_ROUTES } from './legalStatus';

export type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
};

/**
 * Footer link source of truth for Dwel.
 * Paths are in-app routes; Footer renders them with React Router Link.
 */
export const DWEL_FOOTER_LINKS: FooterLink[] = [
  { label: 'About', href: LEGAL_ROUTES.about },
  { label: 'FAQs', href: LEGAL_ROUTES.faqs },
  { label: 'Terms', href: LEGAL_ROUTES.terms },
  { label: 'Privacy', href: LEGAL_ROUTES.privacy },
  { label: 'Do not sell or share my personal info', href: LEGAL_ROUTES.ccpa },
  { label: 'Cashback Terms', href: LEGAL_ROUTES.cashback },
  { label: 'Fair housing', href: LEGAL_ROUTES.fairHousing },
  { label: 'Sitemap', href: LEGAL_ROUTES.sitemap },
];
