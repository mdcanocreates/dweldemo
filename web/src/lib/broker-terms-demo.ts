/**
 * Demo-only broker acknowledgment persistence (Netlify / UI preview offline adapters).
 * Never a production legal record.
 */
import { BROKER_TERMS_VERSION } from './demo-store';

export const BROKER_TERMS_DEMO_STORAGE_KEY = 'dwel.demo.broker.terms.ack.v1';

type StoredAck = {
  terms_version: string;
  accepted_at: string;
  is_demo: true;
  production_record: false;
};

function readRaw(): StoredAck | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(BROKER_TERMS_DEMO_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredAck;
  } catch {
    return null;
  }
}

export function readDemoBrokerTermsAccepted(
  termsVersion: string = BROKER_TERMS_VERSION,
): boolean {
  const parsed = readRaw();
  return Boolean(parsed && parsed.terms_version === termsVersion);
}

export function writeDemoBrokerTermsAccepted(
  termsVersion: string = BROKER_TERMS_VERSION,
): StoredAck {
  const record: StoredAck = {
    terms_version: termsVersion,
    accepted_at: new Date().toISOString(),
    is_demo: true,
    production_record: false,
  };
  try {
    localStorage.setItem(BROKER_TERMS_DEMO_STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* ignore quota */
  }
  return record;
}

export function clearDemoBrokerTermsAccepted(): void {
  try {
    localStorage.removeItem(BROKER_TERMS_DEMO_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function getDemoBrokerTermsAcceptance(): StoredAck | null {
  const parsed = readRaw();
  if (!parsed || parsed.terms_version !== BROKER_TERMS_VERSION) return null;
  return parsed;
}
