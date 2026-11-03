/**
 * Match deal-property image groups by external_id, test source URLs, and
 * ingest only images the recorded source grant allows.
 *
 *   MANIFEST_PATH=... npx tsx src/scripts/ingest-deal-property-images.ts
 *   CHECK_URLS=0 skips network probes.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { resolveDatabaseUrl } from '../db/database-url.js';
import { loadRdsSslConfig } from '../db/rds-ssl.js';
import { getObjectStore } from '../infra/object-store/index.js';
import {
  RENT_COM_DEAL_PACKAGE_PERMISSION,
  planDealImageIngest,
  type DealImageGroup,
  type ListingImageLink,
  type PlannedDealImage,
  type SourceMediaPermission,
} from '../modules/external-listings/index.js';

const { Client } = pg;

type ManifestFile = {
  property_count?: number;
  image_url_references?: number;
  unique_image_urls?: number;
  properties?: Array<{
    external_id?: string;
    property_name?: string | null;
    source_url?: string | null;
    photos?: string[];
  }>;
};

type ProbeResult = {
  status: number;
  contentType: string | null;
  reachable: boolean;
  error?: string;
};

function resolveSsl(): pg.ClientConfig['ssl'] | undefined {
  const caPath = process.env.RDS_CA_BUNDLE_PATH ?? '/certs/rds-global-bundle.pem';
  try {
    return loadRdsSslConfig(caPath);
  } catch {
    return undefined;
  }
}

function loadGroups(manifest: ManifestFile): DealImageGroup[] {
  return (manifest.properties ?? []).map((property) => ({
    externalId: String(property.external_id ?? ''),
    propertyName: property.property_name ?? null,
    sourceUrl: property.source_url ?? null,
    photos: Array.isArray(property.photos) ? property.photos.filter((url) => typeof url === 'string') : [],
  }));
}

function probeUrl(target: string, redirectsLeft = 3): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      resolve({ status: 0, contentType: null, reachable: false, error: 'invalid_url' });
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      parsed,
      {
        method: 'GET',
        timeout: 10000,
        headers: {
          'User-Agent': 'DwelImageUrlCheck/1.0',
          Range: 'bytes=0-0',
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        },
      },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers['content-type'] ?? '').split(';')[0] || null;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
          resolve(probeUrl(new URL(location, parsed).toString(), redirectsLeft - 1));
          return;
        }
        const imageType = Boolean(contentType?.startsWith('image/') || contentType === 'application/octet-stream');
        resolve({
          status,
          contentType,
          reachable: (status === 200 || status === 206) && imageType,
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, contentType: null, reachable: false, error: 'timeout' });
    });
    req.on('error', (err) => {
      resolve({ status: 0, contentType: null, reachable: false, error: err.message });
    });
    req.end();
  });
}

async function mapPool<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function loadPermission(client: pg.Client): Promise<{ permission: SourceMediaPermission; source: string }> {
  const { rows } = await client.query<{
    provider_key: string;
    status: SourceMediaPermission['status'];
    license_evidence_ref: string | null;
    permitted_fields: string[] | null;
  }>(
    `select provider_key, status, license_evidence_ref, permitted_fields
     from external_source
     where provider_key = $1`,
    [RENT_COM_DEAL_PACKAGE_PERMISSION.providerKey],
  );
  const row = rows[0];
  if (!row) return { permission: RENT_COM_DEAL_PACKAGE_PERMISSION, source: 'recorded_default_no_db_row' };
  return {
    source: 'external_source',
    permission: {
      providerKey: row.provider_key,
      status: row.status,
      licenseEvidenceRef: row.license_evidence_ref,
      permittedFields: row.permitted_fields ?? [],
      mediaPolicy: 'none',
    },
  };
}

async function loadListingLinks(client: pg.Client, groups: DealImageGroup[]): Promise<ListingImageLink[]> {
  const links = new Map<string, string>();
  const provenance = await client.query<{ listing_id: string; origin_url: string }>(
    `select listing_id::text, origin_url
     from listing_media_provenance
     where origin_url is not null`,
  );
  const listingByUrl = new Map(provenance.rows.map((row) => [row.origin_url, row.listing_id]));
  for (const group of groups) {
    for (const photo of group.photos) {
      const listingId = listingByUrl.get(photo);
      if (listingId) {
        links.set(group.externalId, listingId);
        break;
      }
    }
  }
  const listings = await client.query<{ id: string; public_description: string | null }>(
    `select id::text, public_description
     from listing
     where coalesce(inventory_kind, 'partner') = 'external'`,
  );
  for (const group of groups) {
    if (links.has(group.externalId)) continue;
    const needle = group.externalId.replace(/^rent_/, '');
    const found = listings.rows.find((row) => {
      const description = row.public_description ?? '';
      return description.includes(group.externalId) || (needle.length > 4 && description.includes(needle));
    });
    if (found) links.set(group.externalId, found.id);
  }
  return [...links.entries()].map(([externalId, listingId]) => ({ externalId, listingId }));
}

async function readBody(target: string): Promise<{ body: Buffer; contentType: string }> {
  const response = await fetch(target, {
    headers: { 'User-Agent': 'DwelImageIngest/1.0', Accept: 'image/avif,image/webp,image/*' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`fetch failed ${response.status}`);
  const contentType = (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!;
  if (!contentType.startsWith('image/')) throw new Error(`not an image: ${contentType}`);
  return { body: Buffer.from(await response.arrayBuffer()), contentType };
}

async function applyApprovedImages(client: pg.Client, images: PlannedDealImage[]): Promise<number> {
  const store = getObjectStore();
  let written = 0;
  for (const image of images) {
    const listing = await client.query<{ org_id: string }>(
      `select org_id::text from listing where id = $1::uuid`,
      [image.listingId],
    );
    const orgId = listing.rows[0]?.org_id;
    if (!orgId || !image.listingId) continue;
    const existing = await client.query(
      `select 1 from listing_media_provenance
       where listing_id = $1::uuid and origin_url = $2 and publishable = true`,
      [image.listingId, image.originUrl],
    );
    if (existing.rowCount) continue;

    let storageKey: string | null = null;
    let publicUrl: string | null = image.action === 'hotlink' ? image.originUrl : null;
    let checksum: string | null = null;
    let contentType: string | null = null;
    if (image.action === 'host') {
      const downloaded = await readBody(image.originUrl);
      checksum = createHash('sha256').update(downloaded.body).digest('hex');
      contentType = downloaded.contentType;
      storageKey = `listings/${orgId}/${image.listingId}/${checksum}`;
      await store.put({ key: storageKey, body: downloaded.body, contentType });
    }
    const media = await client.query<{ id: string }>(
      `insert into listing_media (listing_id, org_id, position, url, storage_key, content_type)
       values ($1::uuid, $2::uuid, $3, $4, $5, $6)
       returning id`,
      [image.listingId, orgId, image.position, publicUrl, storageKey, contentType],
    );
    await client.query(
      `insert into listing_media_provenance (
         listing_id, media_id, origin_url, origin_host, permission_basis, permission_note,
         checksum_sha256, publishable
       ) values ($1::uuid, $2::uuid, $3, $4, 'authorized_feed', $5, $6, true)`,
      [
        image.listingId,
        media.rows[0]!.id,
        image.originUrl,
        new URL(image.originUrl).host,
        image.action === 'host'
          ? 'Copied into Dwel storage under the recorded feed grant.'
          : 'Hotlinked under the recorded feed grant.',
        checksum,
      ],
    );
    written += 1;
  }
  return written;
}

async function main(): Promise<void> {
  const manifestPath = process.env.MANIFEST_PATH?.trim();
  if (!manifestPath) throw new Error('MANIFEST_PATH is required');
  const checkUrls = process.env.CHECK_URLS !== '0';
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ManifestFile;
  const groups = loadGroups(manifest);

  let permission = RENT_COM_DEAL_PACKAGE_PERMISSION;
  let permissionSource = 'recorded_quarantine_default';
  let links: ListingImageLink[] = [];
  let database = 'not_configured';

  if (process.env.DATABASE_URL?.trim()) {
    const client = new Client({ connectionString: resolveDatabaseUrl(), ssl: resolveSsl() });
    await client.connect();
    database = 'connected';
    try {
      await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
      const loaded = await loadPermission(client);
      permission = loaded.permission;
      permissionSource = loaded.source;
      links = await loadListingLinks(client, groups);
    } finally {
      await client.end();
    }
  }

  const uniqueUrls = [...new Set(groups.flatMap((group) => group.photos.map((url) => url.trim()).filter(Boolean)))];
  const urlAlive = new Map<string, boolean>();
  const statusCounts: Record<string, number> = {};
  let tested = 0;
  let reachable = 0;
  if (checkUrls) {
    await mapPool(uniqueUrls, 24, async (url, index) => {
      const result = await probeUrl(url);
      tested += 1;
      urlAlive.set(url, result.reachable);
      if (result.reachable) reachable += 1;
      const key = result.error ?? `${result.status}:${result.contentType ?? 'none'}`;
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
      if ((index + 1) % 500 === 0) {
        console.error(`probed ${index + 1}/${uniqueUrls.length} reachable=${reachable}`);
      }
    });
  }

  const plan = planDealImageIngest({
    groups,
    links,
    permission,
    urlAlive: checkUrls ? urlAlive : undefined,
  });

  let imagesIngested = 0;
  const approved = plan.images.filter((image) => image.action !== 'reject' && image.listingId);
  if (approved.length > 0) {
    if (!process.env.DATABASE_URL?.trim()) {
      throw new Error('Approved images need DATABASE_URL so they can be stored with their listing.');
    }
    const client = new Client({ connectionString: resolveDatabaseUrl(), ssl: resolveSsl() });
    await client.connect();
    try {
      await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
      imagesIngested = await applyApprovedImages(client, approved);
    } finally {
      await client.end();
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    manifest_path: manifestPath,
    manifest_claims: {
      property_count: manifest.property_count ?? null,
      image_url_references: manifest.image_url_references ?? null,
      unique_image_urls: manifest.unique_image_urls ?? null,
    },
    permission_source: permissionSource,
    permission,
    database,
    listing_links_matched: links.length,
    images_discovered: plan.summary.imageReferences,
    properties_discovered: plan.summary.propertiesDiscovered,
    properties_matched_by_external_id: plan.summary.propertiesMatchedByExternalId,
    unique_image_urls: plan.summary.uniqueImageUrls,
    urls_tested: tested,
    urls_reachable_image: reachable,
    urls_not_image_or_unreachable: checkUrls ? tested - reachable : null,
    url_status_counts: statusCounts,
    images_ingested: imagesIngested,
    images_rejected: plan.summary.rejected,
    rejected_by_reason: plan.summary.rejectedByReason,
    images_displayed_publicly: 0,
    display_verified: false,
    approved_to_host: plan.summary.approvedToHost,
    approved_to_hotlink: plan.summary.approvedToHotlink,
    limitation:
      'Recorded rent_com_deal_package grant is unverified, license evidence is pending_rights_review, and photos are not a permitted field. Package prompt text is not a display or rehost license. No Rent.com image bytes were copied into Dwel storage or published on listing media.',
  };

  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../evidence/deal-images');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, '2026-11-03-image-permission-report.json');
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: outPath, ...report }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
