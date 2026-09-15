/**
 * §6A.1 ListingSourceAdapter — adapters return raw records only.
 * Normalization / resolve / merge live in the shared pipeline.
 */

export type AdapterKind =
  | 'reso_web_api'
  | 'rets'
  | 'mls_grid'
  | 'trestle'
  | 'bridge'
  | 'spark'
  | 'reso_aggregator_stub' // D-12: stub only — do not pick a real aggregator
  | 'listhub_xml'
  | 'zillow_feed_xml'
  | 'generic_rss'
  | 'appfolio'
  | 'buildium'
  | 'rentmanager'
  | 'yardi'
  | 'entrata'
  | 'doorloop'
  | 'push_webhook'
  | 'csv_upload'
  | 'manual'
  | 'custom_http';

export type SourceConfig = {
  /** Fixture path relative to tests/fixtures/ingestion — zero live network. */
  fixturePath?: string;
  /** In-memory fixture payloads (preferred in unit tests). */
  fixtureRecords?: RawRecord[];
  endpoint?: string;
  extra?: Record<string, unknown>;
};

export type RawRecord = {
  externalId: string;
  payload: Record<string, unknown>;
  sourceModifiedAt?: string | null;
  /** Optional cursor contributed by incremental adapters. */
  cursor?: string | null;
};

export type ConnectionTestResult = {
  ok: boolean;
  sampleCount: number;
  errorClass?: string;
  /** Never include raw credentials or stack traces. */
  message?: string;
};

export type AdapterCapabilities = {
  supportsIncremental: boolean;
  supportsDelistSignal: boolean;
  supportsMedia: boolean;
  cursorField: string | null;
};

export interface ListingSourceAdapter {
  readonly kind: AdapterKind;
  testConnection(cfg: SourceConfig): Promise<ConnectionTestResult>;
  fetchIncremental(cfg: SourceConfig, cursor: string | null): AsyncIterable<RawRecord>;
  fetchFull(cfg: SourceConfig): AsyncIterable<RawRecord>;
  capabilities(): AdapterCapabilities;
}

export type CanonicalListingFields = {
  externalId: string;
  addressRaw: string;
  rentAmountCents: number | null;
  depositCents?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  availableOn?: string | null;
  leaseTermMonths?: number | null;
  description?: string | null;
  mappedStatus?: 'active' | 'pending' | 'delisted' | 'rented';
  sourceStatusRaw?: string | null;
  isDpvConfirmed?: boolean;
  /** Building-level records with unit_count > 1 are ambiguous. */
  unitCount?: number | null;
  mediaUrls?: string[];
};

export type PipelineCounts = {
  fetched: number;
  new: number;
  changed: number;
  unchanged: number;
  rejected: number;
  ambiguous: number;
  resolved: number;
  unresolvable: number;
  absent: number;
  wouldCreate?: number;
};

export type IngestionThresholds = {
  delist_quarantine_share: number;
  record_count_deviation: number;
  rejection_rate_max: number;
  median_rent_shift_max: number;
  required_field_null_rate_max: number;
  resolution_failure_rate_max: number;
  rent_conflict_tolerance: number;
  delist_grace_hours: number;
  credential_expiry_alert_days: number;
  circuit_breaker_failures: number;
};

export const DEFAULT_INGESTION_THRESHOLDS: IngestionThresholds = {
  delist_quarantine_share: 0.3,
  record_count_deviation: 0.5,
  rejection_rate_max: 0.4,
  median_rent_shift_max: 0.35,
  required_field_null_rate_max: 0.5,
  resolution_failure_rate_max: 0.4,
  rent_conflict_tolerance: 0.1,
  delist_grace_hours: 48,
  credential_expiry_alert_days: 7,
  circuit_breaker_failures: 5,
};

/** Default precedence ladder §6A.3 */
export const PRECEDENCE = {
  landlord_direct: 10,
  pm_system: 20,
  mls_aggregator: 30,
  syndication_feed: 40,
  import: 50,
} as const;
