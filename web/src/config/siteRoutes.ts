import data from './sitemapData.json';

export type SitemapRoute = { path: string; label: string };
export type SitemapSection = { title: string; routes: SitemapRoute[] };

export const SITEMAP_SECTIONS = data.sections as SitemapSection[];

/**
 * TODO [NEEDS CONFIRMATION]: prod base URL not present in env config.
 * Placeholder from footer.md — do not treat as confirmed.
 */
export const SITEMAP_BASE_URL = data.baseUrl;

export const SITEMAP_USES_HASH = data.hashRouter;

export function sitemapHref(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (SITEMAP_USES_HASH) return `#${normalized === '/' ? '/' : normalized}`;
  return normalized;
}
