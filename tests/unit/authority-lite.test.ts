import { describe, expect, it } from 'vitest';
import { CreateHousingCase } from '../../src/modules/authority/contracts.js';
import {
  mayAcknowledgePacket,
  mayReadAgencyCase,
  mayVerifyAssistance,
  supportMayReadHousehold,
} from '../../src/modules/authority/access.js';
import {
  preliminarySignal,
  publicInventoryUnchanged,
} from '../../src/modules/authority/search-signal.js';
import { packetStatusLabel } from '../../src/modules/authority/labels.js';
import { MARKETPLACE_EVENT_NAMES } from '../../src/modules/analytics/marketplace-event.js';

const listing = {
  id: 'home-1',
  available: true,
  bedrooms: 2,
  advertisedGrossRentCents: 150000,
  areaId: 'austin',
};

describe('authority lite rules', () => {
  it('rejects agency verification on the general create contract', () => {
    expect(() =>
      CreateHousingCase.parse({
        displayReference: 'CASE-1',
        searchPreferences: {},
        assistanceIndicator: 'agency_verified',
      }),
    ).toThrow();
  });

  it('does not hide a public listing because of assistance context', () => {
    const inventory = [listing, { ...listing, id: 'home-2', available: false, bedrooms: 0 }];
    const signaled = inventory.map((row) => row);
    expect(publicInventoryUnchanged(inventory, signaled)).toBe(true);
    expect(preliminarySignal(listing, { bedroomPreference: 2, grossRentPreferenceCents: 160000 }).label).toBe(
      'promising_to_explore',
    );
    expect(preliminarySignal({ ...listing, available: false }, {}).label).toBe('unavailable');
    expect(preliminarySignal({ ...listing, advertisedGrossRentCents: undefined }, {}).label).toBe('needs_review');
    expect(
      preliminarySignal(listing, {
        grossRentPreferenceCents: 1000,
        agencyPublishedInfo: {
          referenceVersion: 'hint',
          referenceDate: '2026-01-01',
          publishedReferenceCents: 1,
        },
      }).label,
    ).toBe('outside_preference');
  });

  it('keeps packet handoff from sounding like approval', () => {
    expect(packetStatusLabel('sent_to_agency')).toBe('Sent to the agency');
    expect(packetStatusLabel('agency_acknowledged')).toBe('Agency received the packet');
    expect(mayAcknowledgePacket('caseworker')).toBe(false);
    expect(mayVerifyAssistance('caseworker')).toBe(false);
    expect(mayVerifyAssistance('agency_supervisor')).toBe(true);
    expect(supportMayReadHousehold()).toBe(false);
    expect(
      mayReadAgencyCase({
        principal: { partyId: 'p', role: 'caseworker', membershipId: 'm1' },
        assignedMembershipId: 'm2',
        sharedPartyIds: [],
      }),
    ).toBe(false);
  });

  it('does not put authority events on the marketplace allowlist', () => {
    expect(MARKETPLACE_EVENT_NAMES).not.toContain('authority.case_created');
    expect(MARKETPLACE_EVENT_NAMES.join(' ')).not.toMatch(/agency|assistance|household/i);
  });
});
