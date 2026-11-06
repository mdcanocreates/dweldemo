/**
 * Publish authorized deal-package image URLs into listing_media as hotlinks.
 * Preserves provenance order. Does not copy bytes into S3.
 *
 *   npx tsx src/scripts/publish-hotlink-deal-media.ts
 *   DRY_RUN=1 npx tsx src/scripts/publish-hotlink-deal-media.ts
 */
import pg from 'pg';
import { resolveDatabaseUrl } from '../db/database-url.js';
import { loadRdsSslConfig } from '../db/rds-ssl.js';
import {
  decideImageUse,
  RENT_COM_DEAL_PACKAGE_PERMISSION,
  type SourceMediaPermission,
} from '../modules/external-listings/image-rights.js';

const { Client } = pg;

function resolveSsl(): pg.ClientConfig['ssl'] | undefined {
  const caPath = process.env.RDS_CA_BUNDLE_PATH ?? '/certs/rds-global-bundle.pem';
  try {
    return loadRdsSslConfig(caPath);
  } catch {
    return undefined;
  }
}

async function loadPermission(client: pg.Client): Promise<{
  permission: SourceMediaPermission;
  source: string;
}> {
  const { rows } = await client.query<{
    provider_key: string;
    status: SourceMediaPermission['status'];
    license_evidence_ref: string | null;
    permitted_fields: string[] | null;
    media_policy: SourceMediaPermission['mediaPolicy'] | null;
  }>(
    `select provider_key, status, license_evidence_ref, permitted_fields, media_policy
     from external_source
     where provider_key = $1`,
    [RENT_COM_DEAL_PACKAGE_PERMISSION.providerKey],
  );
  const row = rows[0];
  if (!row) {
    return { permission: RENT_COM_DEAL_PACKAGE_PERMISSION, source: 'code_default' };
  }
  return {
    source: 'external_source',
    permission: {
      providerKey: row.provider_key,
      status: row.status,
      licenseEvidenceRef: row.license_evidence_ref,
      permittedFields: row.permitted_fields ?? [],
      mediaPolicy: row.media_policy ?? 'none',
    },
  };
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  const client = new Client({
    connectionString: resolveDatabaseUrl(),
    ssl: resolveSsl(),
  });
  await client.connect();
  try {
    await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
    const { permission, source } = await loadPermission(client);
    const decision = decideImageUse(permission);
    if (decision.action !== 'hotlink') {
      console.log(
        JSON.stringify(
          {
            ok: false,
            source,
            permission,
            decision,
            message: 'Hotlink publication blocked until external_source grants approved hotlink rights.',
          },
          null,
          2,
        ),
      );
      process.exitCode = 2;
      return;
    }

    const pending = await client.query<{
      listing_count: string;
      image_count: string;
    }>(
      `select count(distinct listing_id)::text as listing_count,
              count(*)::text as image_count
       from listing_media_provenance
       where origin_url is not null
         and origin_host = 'i.rent.com'`,
    );

    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            source,
            permission,
            decision,
            listingsWithRefs: Number(pending.rows[0]?.listing_count ?? 0),
            imageRefs: Number(pending.rows[0]?.image_count ?? 0),
          },
          null,
          2,
        ),
      );
      return;
    }

    await client.query('begin');
    try {
      // Replace prior hotlinked deal media for external listings so ordering stays authoritative.
      await client.query(
        `delete from listing_media lm
         using listing l
         where lm.listing_id = l.id
           and coalesce(l.inventory_kind, 'partner') = 'external'
           and lm.storage_key is null
           and lm.url like 'https://i.rent.com/%'`,
      );

      const inserted = await client.query<{ listing_id: string; id: string; position: number; url: string }>(
        `with ranked as (
           select
             p.id as provenance_id,
             p.listing_id,
             p.origin_url,
             row_number() over (
               partition by p.listing_id
               order by p.created_at asc, p.id asc
             ) - 1 as position
           from listing_media_provenance p
           join listing l on l.id = p.listing_id
           where coalesce(l.inventory_kind, 'partner') = 'external'
             and p.origin_url is not null
             and p.origin_host = 'i.rent.com'
         ),
         written as (
           insert into listing_media (listing_id, org_id, position, url, content_type)
           select
             r.listing_id,
             l.org_id,
             r.position,
             r.origin_url,
             'image/webp'
           from ranked r
           join listing l on l.id = r.listing_id
           returning id, listing_id, position, url
         )
         select listing_id::text, id::text, position, url from written`,
      );

      await client.query(
        `update listing_media_provenance p
         set permission_basis = 'authorized_feed',
             permission_note = 'Authorized hotlink display; origin URL published to listing_media without rehost.',
             publishable = true,
             media_id = m.id
         from listing_media m
         where m.listing_id = p.listing_id
           and m.url = p.origin_url
           and coalesce(m.storage_key, '') = ''
           and p.origin_host = 'i.rent.com'`,
      );

      await client.query('commit');

      const listings = new Set(inserted.rows.map((row) => row.listing_id));
      const withGallery = inserted.rows.reduce((acc, row) => {
        acc.set(row.listing_id, (acc.get(row.listing_id) ?? 0) + 1);
        return acc;
      }, new Map<string, number>());
      const galleries = [...withGallery.values()].filter((n) => n > 1).length;

      console.log(
        JSON.stringify(
          {
            ok: true,
            source,
            evidence: permission.licenseEvidenceRef,
            mediaPolicy: permission.mediaPolicy,
            listingsLinked: listings.size,
            imagesPublished: inserted.rows.length,
            listingsWithGalleries: galleries,
            sample: inserted.rows.slice(0, 3),
          },
          null,
          2,
        ),
      );
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
