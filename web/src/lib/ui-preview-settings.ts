/**
 * Isolated preview settings store — session-only, never hits live APIs.
 */

import type { MeResponse } from '../types';

export type PreviewHpSettings = {
  screening_mode: 'auto_screen' | 'manual_review';
  organization: {
    display_name: string;
    contact_name: string;
    contact_email: string;
    phone: string;
    business_address: string;
  };
  notifications: {
    renter_interest: boolean;
    screening_complete: boolean;
    decision_required: boolean;
    billing_alerts: boolean;
    broker_changes: boolean;
  };
  broker: {
    broker_name: string | null;
    status: 'none' | 'active' | 'revoked';
    permissions: string[];
    since: string | null;
  };
};

export type PreviewBrokerSettings = {
  business: {
    display_name: string;
    legal_name: string;
    website: string;
    phone: string;
    business_address: string;
  };
  licensing: {
    license_number: string;
    license_state: string;
    license_type: 'broker' | 'salesperson';
    verification_status: 'unverified' | 'pending_review' | 'verified';
  };
  contact: {
    name: string;
    email: string;
    phone: string;
  };
  notifications: {
    new_applicants: boolean;
    screening_updates: boolean;
    provider_invites: boolean;
    billing_alerts: boolean;
  };
  terms: {
    version: string | null;
    accepted_at: string | null;
  };
};

const HP_KEY = 'dwel.ui_preview.hp_settings.v1';
const BROKER_KEY = 'dwel.ui_preview.broker_settings.v1';

function defaultHp(user?: MeResponse | null): PreviewHpSettings {
  return {
    screening_mode: 'manual_review',
    organization: {
      display_name: 'Preview Oaks LLC',
      contact_name: [user?.given_name, user?.family_name].filter(Boolean).join(' ') || 'UI Preview',
      contact_email: user?.email ?? 'ui-preview@localhost',
      phone: '+1 (512) 555-0100',
      business_address: '100 Congress Ave, Austin, TX',
    },
    notifications: {
      renter_interest: true,
      screening_complete: true,
      decision_required: true,
      billing_alerts: true,
      broker_changes: true,
    },
    broker: {
      broker_name: 'Preview Brokerage',
      status: 'active',
      permissions: ['view_listings', 'view_applicants', 'request_screening', 'recommend'],
      since: '2026-09-01',
    },
  };
}

function defaultBroker(user?: MeResponse | null): PreviewBrokerSettings {
  return {
    business: {
      display_name: 'Preview Brokerage',
      legal_name: 'Preview Brokerage LLC',
      website: 'https://preview.broker.local',
      phone: '+1 (512) 555-0200',
      business_address: '400 W 2nd St, Austin, TX',
    },
    licensing: {
      license_number: 'TX-BRK-10001',
      license_state: 'TX',
      license_type: 'broker',
      verification_status: 'verified',
    },
    contact: {
      name: [user?.given_name, user?.family_name].filter(Boolean).join(' ') || 'UI Preview',
      email: user?.email ?? 'ui-preview@localhost',
      phone: '+1 (512) 555-0201',
    },
    notifications: {
      new_applicants: true,
      screening_updates: true,
      provider_invites: true,
      billing_alerts: true,
    },
    terms: {
      version: 'broker-terms-2026.1',
      accepted_at: '2026-08-15T12:00:00Z',
    },
  };
}

function readJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

export function getPreviewHpSettings(user?: MeResponse | null): PreviewHpSettings {
  const stored = readJson<PreviewHpSettings>(HP_KEY);
  if (!stored) return defaultHp(user);
  return {
    ...defaultHp(user),
    ...stored,
    organization: { ...defaultHp(user).organization, ...stored.organization },
    notifications: { ...defaultHp(user).notifications, ...stored.notifications },
    broker: { ...defaultHp(user).broker, ...stored.broker },
  };
}

export function savePreviewHpSettings(settings: PreviewHpSettings): PreviewHpSettings {
  writeJson(HP_KEY, settings);
  return settings;
}

export function getPreviewBrokerSettings(user?: MeResponse | null): PreviewBrokerSettings {
  const stored = readJson<PreviewBrokerSettings>(BROKER_KEY);
  if (!stored) return defaultBroker(user);
  return {
    ...defaultBroker(user),
    ...stored,
    business: { ...defaultBroker(user).business, ...stored.business },
    licensing: { ...defaultBroker(user).licensing, ...stored.licensing },
    contact: { ...defaultBroker(user).contact, ...stored.contact },
    notifications: { ...defaultBroker(user).notifications, ...stored.notifications },
    terms: { ...defaultBroker(user).terms, ...stored.terms },
  };
}

export function savePreviewBrokerSettings(settings: PreviewBrokerSettings): PreviewBrokerSettings {
  writeJson(BROKER_KEY, settings);
  return settings;
}
