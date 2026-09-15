/**
 * §14.3 SEO backend: sitemap, RealEstateListing structured data, expired listing policy.
 */

import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';

const SITE_ORIGIN = process.env.RBIT_PUBLIC_ORIGIN ?? 'https://www.rbit.example';
const SITEMAP_URL_LIMIT = 40_000;

export type ExpiredListingPolicy = {
  httpStatus: 200 | 301 | 410;
  robots: 'index' | 'noindex';
  canonicalUrl: string;
  redirectTo?: string;
  reason: 'active' | 'stale_noindex' | 'expired_gone' | 'expired_successor';
};

export function canonicalListingUrl(listingId: string, unitId: string): string {
  // Stable across re-listings of the same unit — unit-scoped path.
  return `${SITE_ORIGIN}/listings/unit/${unitId}?listing=${listingId}`;
}

export function canonicalUnitUrl(unitId: string): string {
  return `${SITE_ORIGIN}/listings/unit/${unitId}`;
}

export function canonicalSubmarketUrl(submarketId: string): string {
  return `${SITE_ORIGIN}/submarkets/${submarketId}`;
}

/**
 * Expired listing policy (§14.3):
 * - stale → 200 + noindex
 * - expired, no successor → 410 Gone
 * - expired, successor listing on same unit → 301 to successor
 * - removed/archived with no successor → 410
 */
export async function resolveExpiredListingPolicy(
  client: DbClient,
  listingId: string,
): Promise<ExpiredListingPolicy> {
  const { rows } = await client.query<{
    id: string;
    unit_id: string;
    status: string;
    submarket_id: string | null;
  }>(
    `select l.id, l.unit_id, l.status, a.submarket_id
     from listing l
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address a on a.id = p.address_id
     where l.id = $1`,
    [listingId],
  );
  const listing = rows[0];
  if (!listing) {
    throw new AppError('listing not found', 'listing_not_found', 404);
  }

  const canonicalUrl = canonicalListingUrl(listing.id, listing.unit_id);

  if (listing.status === 'active' || listing.status === 'paused' || listing.status === 'draft') {
    return {
      httpStatus: 200,
      robots: 'index',
      canonicalUrl,
      reason: 'active',
    };
  }

  if (listing.status === 'stale') {
    return {
      httpStatus: 200,
      robots: 'noindex',
      canonicalUrl,
      reason: 'stale_noindex',
    };
  }

  // Find successor active/paused listing on same unit
  const { rows: successors } = await client.query<{ id: string }>(
    `select id from listing
     where unit_id = $1
       and id <> $2
       and status in ('active','paused','stale')
     order by published_at desc nulls last, created_at desc
     limit 1`,
    [listing.unit_id, listing.id],
  );
  const successor = successors[0];

  if (listing.status === 'expired' || listing.status === 'removed' || listing.status === 'archived') {
    if (successor) {
      return {
        httpStatus: 301,
        robots: 'noindex',
        canonicalUrl: canonicalListingUrl(successor.id, listing.unit_id),
        redirectTo: canonicalListingUrl(successor.id, listing.unit_id),
        reason: 'expired_successor',
      };
    }
    // Unit gone entirely — optional submarket fallback URL still returns 410 for the listing URL
    return {
      httpStatus: 410,
      robots: 'noindex',
      canonicalUrl: listing.submarket_id
        ? canonicalSubmarketUrl(listing.submarket_id)
        : canonicalUnitUrl(listing.unit_id),
      reason: 'expired_gone',
    };
  }

  if (listing.status === 'rented') {
    if (successor) {
      return {
        httpStatus: 301,
        robots: 'noindex',
        canonicalUrl: canonicalListingUrl(successor.id, listing.unit_id),
        redirectTo: canonicalListingUrl(successor.id, listing.unit_id),
        reason: 'expired_successor',
      };
    }
    return {
      httpStatus: 410,
      robots: 'noindex',
      canonicalUrl: canonicalUnitUrl(listing.unit_id),
      reason: 'expired_gone',
    };
  }

  return {
    httpStatus: 200,
    robots: 'noindex',
    canonicalUrl,
    reason: 'stale_noindex',
  };
}

export type RealEstateListingPayload = {
  '@context': 'https://schema.org';
  '@type': 'RealEstateListing';
  url: string;
  name: string;
  datePosted?: string;
  expires?: string;
  offers?: {
    '@type': 'Offer';
    price: number;
    priceCurrency: 'USD';
  };
};

/**
 * Structured data for listing detail API — frontend renders without re-deriving.
 */
export async function buildRealEstateListingPayload(
  client: DbClient,
  listingId: string,
): Promise<RealEstateListingPayload> {
  const { rows } = await client.query<{
    id: string;
    unit_id: string;
    rent_amount_cents: number;
    published_at: Date | null;
    expires_at: Date | null;
    bedrooms: string | null;
    line1: string | null;
    city: string | null;
    state: string | null;
  }>(
    `select l.id, l.unit_id, l.rent_amount_cents, l.published_at, l.expires_at,
            u.bedrooms::text, a.line1, a.city, a.state
     from listing l
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address a on a.id = p.address_id
     where l.id = $1`,
    [listingId],
  );
  const row = rows[0];
  if (!row) throw new AppError('listing not found', 'listing_not_found', 404);

  const nameParts = [
    row.bedrooms != null ? `${row.bedrooms} bed` : null,
    row.line1,
    row.city,
    row.state,
  ].filter(Boolean);

  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    url: canonicalListingUrl(row.id, row.unit_id),
    name: nameParts.join(' · ') || `Listing ${row.id}`,
    datePosted: row.published_at?.toISOString(),
    expires: row.expires_at?.toISOString(),
    offers: {
      '@type': 'Offer',
      price: row.rent_amount_cents / 100,
      priceCurrency: 'USD',
    },
  };
}

export type SitemapChunk = {
  filename: string;
  urls: string[];
  xml: string;
};

function toUrlset(urls: string[]): string {
  const body = urls
    .map((u) => `  <url><loc>${escapeXml(u)}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sitemap from active listings + programmatic landing pages (submarket × bed × rent).
 */
export async function generateSitemaps(
  client: DbClient,
  opts?: { urlLimit?: number },
): Promise<{ indexXml: string; chunks: SitemapChunk[] }> {
  const limit = opts?.urlLimit ?? SITEMAP_URL_LIMIT;
  const urls: string[] = [];

  const { rows: listings } = await client.query<{ id: string; unit_id: string }>(
    `select id, unit_id from listing where status = 'active'`,
  );
  for (const l of listings) {
    urls.push(canonicalListingUrl(l.id, l.unit_id));
  }

  const { rows: submarkets } = await client.query<{ id: string }>(
    `select id from submarket where is_active = true`,
  );
  const bedBands = ['studio', '1', '2', '3', '4plus'];
  const rentBands = ['0-999', '1000-1499', '1500-1999', '2000-2499', '2500-2999', '3000plus'];
  for (const sm of submarkets) {
    urls.push(canonicalSubmarketUrl(sm.id));
    for (const bed of bedBands) {
      for (const rent of rentBands) {
        urls.push(
          `${SITE_ORIGIN}/search?submarket=${sm.id}&beds=${bed}&rent=${rent}`,
        );
      }
    }
  }

  const chunks: SitemapChunk[] = [];
  for (let i = 0; i < urls.length; i += limit) {
    const slice = urls.slice(i, i + limit);
    const filename = `sitemap-${chunks.length + 1}.xml`;
    chunks.push({
      filename,
      urls: slice,
      xml: toUrlset(slice),
    });
  }

  const indexBody = chunks
    .map(
      (c) =>
        `  <sitemap><loc>${escapeXml(`${SITE_ORIGIN}/${c.filename}`)}</loc></sitemap>`,
    )
    .join('\n');
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexBody}\n</sitemapindex>\n`;

  return { indexXml, chunks };
}
