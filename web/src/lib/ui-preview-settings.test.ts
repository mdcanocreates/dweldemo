import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPreviewBrokerSettings,
  getPreviewHpSettings,
  savePreviewBrokerSettings,
  savePreviewHpSettings,
} from './ui-preview-settings';

function mockSessionStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  });
}

describe('ui-preview-settings', () => {
  beforeEach(() => {
    mockSessionStorage();
  });

  it('persists HP organization and screening mode across reload helpers', () => {
    const base = getPreviewHpSettings();
    const next = {
      ...base,
      screening_mode: 'auto_screen' as const,
      organization: { ...base.organization, display_name: 'Updated Oaks' },
    };
    savePreviewHpSettings(next);
    const reloaded = getPreviewHpSettings();
    expect(reloaded.screening_mode).toBe('auto_screen');
    expect(reloaded.organization.display_name).toBe('Updated Oaks');
  });

  it('persists broker business profile without fabricating terms', () => {
    const base = getPreviewBrokerSettings();
    savePreviewBrokerSettings({
      ...base,
      business: { ...base.business, display_name: 'Northside Brokers' },
    });
    const reloaded = getPreviewBrokerSettings();
    expect(reloaded.business.display_name).toBe('Northside Brokers');
    expect(reloaded.terms.version).toBeTruthy();
  });
});
