import { describe, expect, it } from 'vitest';
import {
  acceptMarketplaceEvent,
  MarketplaceEventError,
  marketplaceEventQueue,
  resetMarketplaceEventQueue,
  type MarketplaceEvent,
} from '../../src/modules/analytics/marketplace-event.js';

const event: MarketplaceEvent = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventVersion: 1,
  eventName: 'listing_impression',
  occurredAt: '2026-10-29T00:00:00.000Z',
  anonymousSessionId: 'session-opaque',
  consentState: 'granted',
  listingId: '22222222-2222-4222-8222-222222222222',
  placementIndex: 3,
};

describe('marketplace event gate', () => {
  it('queues a consented allowlisted event once per accept call', () => {
    resetMarketplaceEventQueue();
    expect(acceptMarketplaceEvent(event, true)).toBe(true);
    expect(marketplaceEventQueue()).toHaveLength(1);
  });

  it('drops events when consent is denied or unknown', () => {
    resetMarketplaceEventQueue();
    expect(acceptMarketplaceEvent(event, false)).toBe(false);
    expect(acceptMarketplaceEvent({ ...event, consentState: 'denied' }, true)).toBe(false);
    expect(acceptMarketplaceEvent({ ...event, consentState: 'unknown' }, true)).toBe(false);
    expect(marketplaceEventQueue()).toHaveLength(0);
  });

  it('rejects a property outside the allowlist', () => {
    resetMarketplaceEventQueue();
    expect(() =>
      acceptMarketplaceEvent(
        { ...event, email: 'ada@example.com' } as MarketplaceEvent,
        true,
      ),
    ).toThrow(MarketplaceEventError);
    expect(marketplaceEventQueue()).toHaveLength(0);
  });
});
