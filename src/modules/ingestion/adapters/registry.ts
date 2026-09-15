import type { AdapterKind, ListingSourceAdapter } from '../types.js';
import { createFixtureAdapter } from './base.js';

export const genericRssAdapter = createFixtureAdapter({
  kind: 'generic_rss',
  format: 'xml',
  capabilities: {
    supportsIncremental: false,
    supportsDelistSignal: false,
    supportsMedia: true,
    cursorField: null,
  },
});

export const zillowFeedXmlAdapter = createFixtureAdapter({
  kind: 'zillow_feed_xml',
  format: 'xml',
  capabilities: {
    supportsIncremental: false,
    supportsDelistSignal: false,
    supportsMedia: true,
    cursorField: null,
  },
});

export const listhubXmlAdapter = createFixtureAdapter({
  kind: 'listhub_xml',
  format: 'xml',
  capabilities: {
    supportsIncremental: true,
    supportsDelistSignal: true,
    supportsMedia: true,
    cursorField: 'ModificationTimestamp',
  },
});

export const pushWebhookAdapter = createFixtureAdapter({
  kind: 'push_webhook',
  format: 'json',
  capabilities: {
    supportsIncremental: false,
    supportsDelistSignal: true,
    supportsMedia: false,
    cursorField: null,
  },
});

export const appfolioAdapter = createFixtureAdapter({
  kind: 'appfolio',
  format: 'json',
  capabilities: {
    supportsIncremental: true,
    supportsDelistSignal: true,
    supportsMedia: true,
    cursorField: 'updated_at',
  },
});

export const buildiumAdapter = createFixtureAdapter({
  kind: 'buildium',
  format: 'json',
  capabilities: {
    supportsIncremental: true,
    supportsDelistSignal: true,
    supportsMedia: true,
    cursorField: 'LastUpdatedDateTime',
  },
});

export const rentmanagerAdapter = createFixtureAdapter({
  kind: 'rentmanager',
  format: 'json',
  capabilities: {
    supportsIncremental: true,
    supportsDelistSignal: false,
    supportsMedia: false,
    cursorField: 'update_date',
  },
});

/**
 * D-12 BLOCKED: RESO aggregator selection unresolved.
 * Stub interface only — do NOT bind mls_grid / trestle / bridge / spark.
 */
export const resoAggregatorStubAdapter = createFixtureAdapter({
  kind: 'reso_aggregator_stub',
  format: 'json',
  capabilities: {
    supportsIncremental: true,
    supportsDelistSignal: true,
    supportsMedia: true,
    cursorField: 'ModificationTimestamp',
  },
});

export const resoWebApiAdapter = createFixtureAdapter({
  kind: 'reso_web_api',
  format: 'json',
  capabilities: {
    supportsIncremental: true,
    supportsDelistSignal: true,
    supportsMedia: true,
    cursorField: 'ModificationTimestamp',
  },
});

export const retsAdapter = createFixtureAdapter({
  kind: 'rets',
  format: 'xml',
  capabilities: {
    supportsIncremental: true,
    supportsDelistSignal: true,
    supportsMedia: false,
    cursorField: null,
  },
});

export const csvUploadAdapter = createFixtureAdapter({
  kind: 'csv_upload',
  format: 'json',
  capabilities: {
    supportsIncremental: false,
    supportsDelistSignal: false,
    supportsMedia: false,
    cursorField: null,
  },
});

export const manualAdapter = createFixtureAdapter({
  kind: 'manual',
  format: 'json',
  capabilities: {
    supportsIncremental: false,
    supportsDelistSignal: false,
    supportsMedia: false,
    cursorField: null,
  },
});

const REGISTRY = new Map<AdapterKind, ListingSourceAdapter>([
  ['generic_rss', genericRssAdapter],
  ['zillow_feed_xml', zillowFeedXmlAdapter],
  ['listhub_xml', listhubXmlAdapter],
  ['push_webhook', pushWebhookAdapter],
  ['appfolio', appfolioAdapter],
  ['buildium', buildiumAdapter],
  ['rentmanager', rentmanagerAdapter],
  ['reso_aggregator_stub', resoAggregatorStubAdapter],
  ['reso_web_api', resoWebApiAdapter],
  ['rets', retsAdapter],
  ['csv_upload', csvUploadAdapter],
  ['manual', manualAdapter],
]);

/** Adapters that must pass the shared conformance suite (fixture-backed). */
export const CONFORMANCE_ADAPTER_KINDS: AdapterKind[] = [
  'generic_rss',
  'zillow_feed_xml',
  'listhub_xml',
  'push_webhook',
  'appfolio',
  'buildium',
  'rentmanager',
  'reso_aggregator_stub',
  'reso_web_api',
  'rets',
];

export function getAdapter(kind: AdapterKind | string): ListingSourceAdapter {
  const adapter = REGISTRY.get(kind as AdapterKind);
  if (!adapter) {
    throw new Error(`unknown adapter_kind: ${kind}`);
  }
  return adapter;
}

export function listAdapters(): ListingSourceAdapter[] {
  return [...REGISTRY.values()];
}
