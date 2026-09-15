import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MemoryObjectStore,
  ObjectStoreAccessDeniedError,
  SignedUrlExpiredError,
  resetObjectStore,
  setObjectStore,
} from '../../src/infra/object-store/index.js';
import {
  completeESignAndStore,
  issueSignedUrl,
  runDocumentPurgeJob,
  SIGNED_URL_MAX_TTL_SECONDS,
  storeDocument,
} from '../../src/modules/documents/index.js';
import {
  clearSearchEventBuffer,
  enqueueSearchEvent,
  flushSearchEventBuffer,
  getLabelCoverage,
  getZeroResultDemandRollup,
  runReportingEtl,
} from '../../src/modules/analytics/index.js';
import {
  adminLookupById,
  getAdminDashboard,
  wrapAdminClient,
} from '../../src/modules/admin/index.js';
import {
  buildRealEstateListingPayload,
  generateSitemaps,
  resolveExpiredListingPolicy,
} from '../../src/modules/seo/index.js';
import {
  assertPublicApiAllowed,
  evaluatePublicApiProtection,
  resetRateLimitState,
} from '../../src/modules/public-api/index.js';
import { AppError } from '../../src/modules/shared/errors.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import { seedPhase5Listing, seedScrapingPolicy } from '../helpers/phase5.js';
import { schedulePlacementOutcomes } from '../../src/modules/outcomes/index.js';
import { seedListingPartyApp } from '../helpers/phase2.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'phase5');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

describe('Phase 5 acceptance (§17 / §12.1 / §14 / §15 / §3.7)', () => {
  let db: TestDb;
  let store: MemoryObjectStore;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(() => {
    store = resetObjectStore();
    setObjectStore(store);
    clearSearchEventBuffer();
    resetRateLimitState();
  });

  it('Signed URL expires ≤5 min; direct bucket access denied; every issuance logged', async () => {
    const result = await withBypass(db.pool, async (c) => {
      const seed = await seedPhase5Listing(c, db.kms);
      const { documentId, storageKey } = await storeDocument(c, {
        orgId: seed.orgId,
        ownerPartyId: seed.ownerPartyId,
        docType: 'lease_addendum',
        retentionClass: 'identity',
        body: Buffer.from('lease-body'),
        contentType: 'application/pdf',
        store,
      });

      await expect(store.getDirect(storageKey)).rejects.toBeInstanceOf(
        ObjectStoreAccessDeniedError,
      );

      const signed = await issueSignedUrl(c, {
        documentId,
        actorPartyId: seed.ownerPartyId,
        actorOrgId: seed.orgId,
        expiresInSeconds: 600, // request 10m — must cap at 5m
        requestId: randomUUID(),
        ip: '203.0.113.10',
        store,
      });

      const ttlMs = signed.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeLessThanOrEqual(SIGNED_URL_MAX_TTL_SECONDS * 1000 + 50);
      expect(ttlMs).toBeGreaterThan(0);

      const viaUrl = await store.getViaSignedUrl(signed.url);
      expect(viaUrl.body.toString()).toBe('lease-body');

      store.expireTokenForUrl(signed.url);
      await expect(store.getViaSignedUrl(signed.url)).rejects.toBeInstanceOf(
        SignedUrlExpiredError,
      );

      const { rows: logs } = await c.query<{ action: string }>(
        `select action from document_access_log where document_id = $1`,
        [documentId],
      );
      expect(logs.some((l) => l.action === 'url_issued')).toBe(true);

      return {
        documentId,
        ttlSecondsCap: SIGNED_URL_MAX_TTL_SECONDS,
        logCount: logs.length,
        directDenied: true,
        expiredRejected: true,
      };
    });

    writeEvidence(
      'signed-url.txt',
      [
        `ttl_cap_seconds=${result.ttlSecondsCap}`,
        `issuance_log_count=${result.logCount}`,
        `direct_bucket_denied=${result.directDenied}`,
        `expired_url_rejected=${result.expiredRejected}`,
        `document_id=${result.documentId}`,
      ].join('\n') + '\n',
    );
  });

  it('Purge job removes expired documents from S3 stub, retains tombstone, ledger refs intact', async () => {
    const result = await withBypass(db.pool, async (c) => {
      const seed = await seedPhase5Listing(c, db.kms);
      const { documentId, storageKey } = await storeDocument(c, {
        orgId: seed.orgId,
        ownerPartyId: seed.ownerPartyId,
        docType: 'identity_scan',
        retentionClass: 'identity',
        body: Buffer.from('pii-bytes'),
        contentType: 'image/jpeg',
        purgeAfter: new Date('2020-01-01'),
        store,
      });

      // Ledger reference via memo (no document FK on ledger — refs by id string)
      const cash = await c.query<{ id: string }>(
        `select id from ledger_account where code = 'asset:cash:operating' limit 1`,
      );
      const expense = await c.query<{ id: string }>(
        `select id from ledger_account where code = 'expense:screening_cogs' limit 1`,
      );
      const txnId = randomUUID();
      await c.query(
        `insert into ledger_transaction (id, occurred_at, kind, idempotency_key, memo)
         values ($1, now(), 'document_fee', $2, $3)`,
        [txnId, `doc-ref-${documentId}`, `document_id=${documentId}`],
      );
      await c.query(
        `insert into ledger_entry (transaction_id, account_id, direction, amount_cents)
         values ($1,$2,'dr',100), ($1,$3,'cr',100)`,
        [txnId, expense.rows[0]!.id, cash.rows[0]!.id],
      );

      expect(await store.exists(storageKey)).toBe(true);
      const purged = await runDocumentPurgeJob(c, { store, asOf: new Date('2026-08-08') });
      expect(purged.documentIds).toContain(documentId);
      expect(await store.exists(storageKey)).toBe(false);

      const { rows: tomb } = await c.query<{
        id: string;
        scan_status: string;
        storage_key: string;
      }>(`select id, scan_status, storage_key from document where id = $1`, [documentId]);
      expect(tomb[0]?.scan_status).toBe('purged');
      expect(tomb[0]?.storage_key.startsWith('tombstone/')).toBe(true);

      const { rows: ledger } = await c.query<{ memo: string }>(
        `select memo from ledger_transaction where id = $1`,
        [txnId],
      );
      expect(ledger[0]?.memo).toContain(documentId);

      const { rows: events } = await c.query<{ event_type: string }>(
        `select event_type from domain_event where aggregate_id = $1 and event_type = 'document.purged'`,
        [documentId],
      );
      expect(events.length).toBe(1);

      // E-sign wiring smoke
      const esign = await completeESignAndStore(c, {
        documentRef: 'lease-v1',
        signerPartyId: seed.ownerPartyId,
        orgId: seed.orgId,
        store,
      });
      expect(esign.completedDocumentId).toBeTruthy();
      expect(esign.auditCertificateDocumentId).toBeTruthy();

      return {
        purgedCount: purged.purged,
        tombstone: tomb[0]!.storage_key,
        ledgerMemoIntact: ledger[0]!.memo,
        esignEnvelope: esign.envelopeId,
      };
    });

    writeEvidence(
      'document-purge.txt',
      [
        `purged_count=${result.purgedCount}`,
        `tombstone=${result.tombstone}`,
        `ledger_memo=${result.ledgerMemoIntact}`,
        `esign_envelope=${result.esignEnvelope}`,
      ].join('\n') + '\n',
    );
  });

  it('Zero-result searches visible in rollup by submarket, bed band, rent band', async () => {
    const result = await withBypass(db.pool, async (c) => {
      const seed = await seedPhase5Listing(c, db.kms, { bedrooms: 2, rentCents: 180000 });
      const day = new Date('2026-08-08T15:00:00Z');

      enqueueSearchEvent({
        occurredAt: day,
        submarketId: seed.submarketId,
        bedroomsMin: 2,
        bedroomsMax: 2,
        rentMinCents: 150000,
        rentMaxCents: 200000,
        resultCount: 0,
        filters: { pets: false },
      });
      enqueueSearchEvent({
        occurredAt: day,
        submarketId: seed.submarketId,
        bedroomsMin: 2,
        bedroomsMax: 2,
        rentMinCents: 150000,
        rentMaxCents: 200000,
        resultCount: 3,
        clickedListingIds: [seed.listingId],
      });
      enqueueSearchEvent({
        occurredAt: day,
        submarketId: seed.submarketId,
        bedroomsMin: 1,
        bedroomsMax: 1,
        rentMinCents: 100000,
        rentMaxCents: 149900,
        resultCount: 0,
      });

      const flushed = await flushSearchEventBuffer(c);
      expect(flushed.inserted).toBe(3);

      const etl = await runReportingEtl(c, { asOf: day });
      expect(etl.agg_search_demand_daily).toBeGreaterThan(0);

      const zeros = await getZeroResultDemandRollup(c, '2026-08-08');
      expect(zeros.length).toBeGreaterThanOrEqual(2);
      expect(zeros.every((z) => z.zero_results > 0)).toBe(true);
      expect(zeros.some((z) => z.bed_band === '2' && z.rent_band === '2000-2499')).toBe(true);
      expect(zeros.some((z) => z.bed_band === '1' && z.rent_band === '1000-1499')).toBe(true);
      expect(zeros.every((z) => z.submarket_id === seed.submarketId)).toBe(true);

      return { zeros, etl };
    });

    writeEvidence(
      'zero-result-rollup.txt',
      JSON.stringify(result.zeros, null, 2) + '\n',
    );
  });

  it('Admin console issues zero queries against primary except allowlisted single-record lookups', async () => {
    const result = await withBypass(db.pool, async (c) => {
      const seed = await seedPhase5Listing(c, db.kms);
      const day = new Date('2026-08-08T12:00:00Z');
      enqueueSearchEvent({
        occurredAt: day,
        submarketId: seed.submarketId,
        bedroomsMin: 2,
        rentMaxCents: 200000,
        resultCount: 0,
      });
      await flushSearchEventBuffer(c);
      await runReportingEtl(c, { asOf: day });

      const admin = wrapAdminClient(c);
      const dash = await getAdminDashboard(admin, '2026-08-08');
      expect(dash.labelCoverage).toBeDefined();
      expect(admin.forbiddenAttempts().length).toBe(0);
      expect(admin.reportingQueryCount()).toBeGreaterThan(0);
      expect(admin.primaryQueryCount()).toBe(0);

      const lookup = await adminLookupById(admin, 'listing', seed.listingId);
      expect(lookup?.id).toBe(seed.listingId);
      expect(admin.primaryQueryCount()).toBe(1);

      // Forbidden scan of primary must throw and be logged
      await expect(
        admin.query(`select count(*) from listing`),
      ).rejects.toThrow(/forbidden primary query/);

      return {
        reportingQueries: admin.reportingQueryCount(),
        primaryLookups: admin.primaryQueryCount(),
        forbiddenLogged: admin.queryLog.some((e) => e.path === 'forbidden'),
        dashboardSubmarkets: dash.supplyDemand.length,
      };
    });

    writeEvidence(
      'admin-query-log.txt',
      [
        `reporting_queries=${result.reportingQueries}`,
        `primary_lookups=${result.primaryLookups}`,
        `forbidden_attempt_logged=${result.forbiddenLogged}`,
        `dashboard_rows=${result.dashboardSubmarkets}`,
      ].join('\n') + '\n',
    );
  });

  it('Label coverage metric live with actual 30/90-day response rates', async () => {
    const result = await withBypass(db.pool, async (c) => {
      const seed = await seedListingPartyApp(c, db.kms);
      // Create placement lease_signed + outcomes
      const placementId = randomUUID();
      await c.query(
        `insert into placement (
           id, unit_id, listing_id, application_id, party_id, org_id, status,
           accepted_at, lease_signed_at
         ) values ($1,$2,$3,$4,$5,$6,'lease_signed', now(), $7)`,
        [
          placementId,
          seed.unitId,
          seed.listingId,
          (
            await c.query<{ id: string }>(
              `insert into application (
                 party_id, renter_profile_id, listing_id, unit_id, org_id,
                 entry_point, status, submitted_at
               ) values ($1,$2,$3,$4,$5,'renter_initiated','submitted', now())
               returning id`,
              [
                seed.partyId,
                seed.renterProfileId,
                seed.listingId,
                seed.unitId,
                seed.orgId,
              ],
            )
          ).rows[0]!.id,
          seed.partyId,
          seed.orgId,
          new Date('2026-01-01T00:00:00Z'),
        ],
      );
      await schedulePlacementOutcomes(c, placementId);

      // Respond to 30-day only
      await c.query(
        `update placement_outcome
         set reported_at = now(), payment_status = 'current', tenancy_status = 'occupied',
             source = 'landlord_attest'
         where placement_id = $1 and horizon_days = 30`,
        [placementId],
      );

      const asOf = new Date('2026-08-08');
      await runReportingEtl(c, { asOf });
      const coverage = await getLabelCoverage(c, '2026-08-08');
      const h30 = coverage.find((r) => r.horizon_days === 30);
      const h90 = coverage.find((r) => r.horizon_days === 90);
      expect(h30).toBeTruthy();
      expect(h90).toBeTruthy();
      expect(h30!.due_count).toBeGreaterThanOrEqual(1);
      expect(h30!.responded_count).toBeGreaterThanOrEqual(1);
      expect(h30!.response_rate).toBeGreaterThan(0);
      expect(h90!.due_count).toBeGreaterThanOrEqual(1);
      // 90-day due but unanswered → rate < 1
      expect(h90!.response_rate).toBeLessThan(1);

      return { coverage };
    });

    writeEvidence(
      'label-coverage.txt',
      JSON.stringify(result.coverage, null, 2) + '\n',
    );
  });

  it('Expired listing returns correct 410/301/noindex per policy', async () => {
    const result = await withBypass(db.pool, async (c) => {
      const active = await seedPhase5Listing(c, db.kms, { status: 'active' });
      const stale = await seedPhase5Listing(c, db.kms, { status: 'stale' });
      const gone = await seedPhase5Listing(c, db.kms, { status: 'expired' });

      // Successor case: expired + new active on same unit
      const succBase = await seedPhase5Listing(c, db.kms, { status: 'expired' });
      const successorId = randomUUID();
      await c.query(
        `insert into listing (
           id, org_id, unit_id, origin, rent_amount_cents, status, published_at, last_confirmed_at
         ) values ($1,$2,$3,'manual',190000,'active', now(), now())`,
        [successorId, succBase.orgId, succBase.unitId],
      );

      const pActive = await resolveExpiredListingPolicy(c, active.listingId);
      const pStale = await resolveExpiredListingPolicy(c, stale.listingId);
      const pGone = await resolveExpiredListingPolicy(c, gone.listingId);
      const pSucc = await resolveExpiredListingPolicy(c, succBase.listingId);

      expect(pActive).toMatchObject({ httpStatus: 200, robots: 'index', reason: 'active' });
      expect(pStale).toMatchObject({ httpStatus: 200, robots: 'noindex', reason: 'stale_noindex' });
      expect(pGone).toMatchObject({ httpStatus: 410, robots: 'noindex', reason: 'expired_gone' });
      expect(pSucc).toMatchObject({ httpStatus: 301, robots: 'noindex', reason: 'expired_successor' });
      expect(pSucc.redirectTo).toContain(successorId);

      const structured = await buildRealEstateListingPayload(c, active.listingId);
      expect(structured['@type']).toBe('RealEstateListing');
      expect(structured.url).toContain(active.unitId);

      const sitemap = await generateSitemaps(c, { urlLimit: 1000 });
      expect(sitemap.chunks.length).toBeGreaterThanOrEqual(1);
      expect(sitemap.indexXml).toContain('sitemapindex');
      expect(sitemap.chunks[0]!.xml).toContain(active.listingId);

      return { pActive, pStale, pGone, pSucc, structuredType: structured['@type'] };
    });

    writeEvidence(
      'expired-listing-policy.txt',
      [
        `active=${JSON.stringify(result.pActive)}`,
        `stale=${JSON.stringify(result.pStale)}`,
        `gone=${JSON.stringify(result.pGone)}`,
        `successor=${JSON.stringify(result.pSucc)}`,
        `structured=@type:${result.structuredType}`,
      ].join('\n') + '\n',
    );
  });

  it('Rate limiting: unauthenticated burst throttled; allow_indexed_crawlers toggle respected', async () => {
    const result = await withBypass(db.pool, async (c) => {
      await seedScrapingPolicy(c, {
        allowIndexedCrawlers: true,
        allowGenericAutomation: false,
        unauthenticatedBurstLimit: 3,
        unauthenticatedWindowMs: 60_000,
        version: 'test-burst',
      });

      const decisions: string[] = [];
      for (let i = 0; i < 5; i++) {
        const d = await evaluatePublicApiProtection(c, {
          ip: '198.51.100.7',
          userAgent: 'Mozilla/5.0',
        });
        decisions.push(d.reason ?? (d.allowed ? 'ok' : 'denied'));
      }
      expect(decisions.slice(0, 3).every((r) => r === 'ok')).toBe(true);
      expect(decisions.slice(3).every((r) => r === 'unauthenticated_burst')).toBe(true);

      await expect(
        assertPublicApiAllowed(c, {
          ip: '198.51.100.7',
          userAgent: 'Mozilla/5.0',
        }),
      ).rejects.toBeInstanceOf(AppError);

      // Indexed crawler allowed when toggle true
      resetRateLimitState();
      const crawlOk = await evaluatePublicApiProtection(c, {
        ip: '66.249.66.1',
        userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)',
      });
      expect(crawlOk.allowed).toBe(true);

      // Flip toggle off
      await seedScrapingPolicy(c, {
        allowIndexedCrawlers: false,
        allowGenericAutomation: false,
        unauthenticatedBurstLimit: 30,
        version: 'test-no-crawl',
        effectiveFrom: '2026-08-01T00:00:00Z',
      });
      const crawlDenied = await evaluatePublicApiProtection(c, {
        ip: '66.249.66.1',
        userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)',
      });
      expect(crawlDenied.allowed).toBe(false);
      expect(crawlDenied.reason).toBe('indexed_crawler_denied');

      // Generic automation denied by default
      const generic = await evaluatePublicApiProtection(c, {
        ip: '203.0.113.50',
        userAgent: 'python-requests/2.31',
      });
      expect(generic.allowed).toBe(false);
      expect(generic.reason).toBe('generic_automation_denied');

      return { decisions, crawlOk: crawlOk.allowed, crawlDenied: crawlDenied.reason, generic: generic.reason };
    });

    writeEvidence(
      'rate-limit.txt',
      [
        `burst_decisions=${result.decisions.join(',')}`,
        `indexed_crawler_allowed_when_on=${result.crawlOk}`,
        `indexed_crawler_when_off=${result.crawlDenied}`,
        `generic_automation=${result.generic}`,
      ].join('\n') + '\n',
    );
  });
});
