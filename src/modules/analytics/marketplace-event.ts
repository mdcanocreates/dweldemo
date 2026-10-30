/**
 * Consent gate and property allowlist for marketplace analytics.
 * Rejected events are not queued. This does not write a new table:
 * search_event remains the existing search capture.
 */

export const MARKETPLACE_EVENT_NAMES = [
  'search_executed',
  'search_results_impression',
  'listing_impression',
  'listing_opened',
  'listing_saved',
  'listing_unsaved',
  'gallery_opened',
  'listing_image_viewed',
  'listing_image_clicked',
  'tour_requested',
  'interest_submitted',
  'application_started',
  'application_submitted',
  'recommendation_impression',
  'recommendation_clicked',
] as const;

export type MarketplaceEventName = (typeof MARKETPLACE_EVENT_NAMES)[number];

export type MarketplaceEvent = {
  eventId: string;
  eventVersion: 1;
  eventName: MarketplaceEventName;
  occurredAt: string;
  anonymousSessionId: string;
  consentState: 'granted' | 'denied' | 'unknown';
  listingId?: string;
  imageId?: string;
  searchId?: string;
  placementIndex?: number;
  regionId?: string;
};

const FORBIDDEN_KEY = /email|phone|ssn|income|screening|given_name|family_name|date_of_birth|token|address|dob/i;

export class MarketplaceEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketplaceEventError';
  }
}

export function assertMarketplaceEvent(event: MarketplaceEvent): void {
  if (event.eventVersion !== 1) {
    throw new MarketplaceEventError('event version must be 1');
  }
  if (!MARKETPLACE_EVENT_NAMES.includes(event.eventName)) {
    throw new MarketplaceEventError('event name is not in the allowlist');
  }
  if (!event.eventId.trim() || !event.anonymousSessionId.trim()) {
    throw new MarketplaceEventError('event id and session id are required');
  }
  for (const key of Object.keys(event)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new MarketplaceEventError('event contains a forbidden property');
    }
  }
}

const queue: MarketplaceEvent[] = [];

export function resetMarketplaceEventQueue(): void {
  queue.length = 0;
}

export function marketplaceEventQueue(): readonly MarketplaceEvent[] {
  return queue;
}

/** Returns false when consent is not granted. Nothing is queued in that case. */
export function acceptMarketplaceEvent(
  event: MarketplaceEvent,
  analyticsConsent: boolean,
): boolean {
  assertMarketplaceEvent(event);
  if (!analyticsConsent || event.consentState !== 'granted') return false;
  queue.push(event);
  return true;
}
