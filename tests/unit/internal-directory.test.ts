import { describe, expect, it, vi } from 'vitest';
import { listBrokers, listListings } from '../../src/modules/internal/directory.js';

function mockClient(handlers: Record<string, unknown[]>) {
  return {
    query: vi.fn(async (sql: string) => {
      const key = Object.keys(handlers).find((k) => sql.includes(k));
      return { rows: key ? handlers[key] : [] };
    }),
  };
}

describe('internal directory (CC read-only)', () => {
  it('lists brokers with empty allowed_actions', async () => {
    const client = mockClient({
      'from broker_profile': [
        {
          org_id: 'a1000000-0000-4000-8000-000000000020',
          display_name: 'Fake Horizon Realty',
          legal_name: 'Fake Horizon Realty LLC',
          license_state: 'TX',
          license_number: 'FAKE-BRK-0001',
          license_verified_at: new Date('2026-01-01T00:00:00Z'),
          license_expires_at: '2027-01-01',
          status: 'active',
          managed_by_broker_org_id: null,
        },
      ],
      'managed_by_broker_org_id': [],
      'broker_provider_invitation': [
        {
          id: 'inv-1',
          contact_email: 'hp@example.com',
          business_name: 'Oaks',
          status: 'pending',
          created_at: new Date('2026-01-02T00:00:00Z'),
          accepted_at: null,
        },
      ],
    });
    const result = await listBrokers(client as never);
    expect(result.sourceHealth).toBe('ok');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.allowed_actions).toEqual([]);
    expect(result.items[0]!.readOnly).toBe(true);
    expect(result.items[0]!.licenseState).toBe('TX');
    expect(result.items[0]!.invitations[0]!.status).toBe('pending');
  });

  it('lists listings as read-only without approve/decline actions', async () => {
    const client = mockClient({
      'from listing': [
        {
          id: 'listing-1',
          status: 'active',
          origin: 'manual',
          rent_amount_cents: 150000,
          org_id: 'org-1',
          landlord_name: 'Fake Oaks',
          broker_org_id: 'broker-1',
          broker_name: 'Horizon',
          city: 'Austin',
          state: 'TX',
          published_at: new Date('2026-01-01T00:00:00Z'),
          last_confirmed_at: new Date('2026-01-02T00:00:00Z'),
        },
      ],
    });
    const result = await listListings(client as never);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.allowed_actions).toEqual([]);
    expect(result.items[0]!.readOnly).toBe(true);
    expect(result.items[0]!.reviewState).toBe('active');
  });
});
