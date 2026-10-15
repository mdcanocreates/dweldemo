import type { Interest, PartyRole, PrequalProfile } from '../types';

const ROLE_KEY = 'dwel.party_role.v1';
const PREQUAL_KEY = 'dwel.prequal_profile.v1';
const INTEREST_KEY = 'dwel.interest.v1';
const LANDLORD_VERIF_KEY = 'dwel.landlord.verification.v1';
const BROKER_VERIF_KEY = 'dwel.broker.verification.v1';

export function getPartyRole(): PartyRole | null {
  try {
    const v = localStorage.getItem(ROLE_KEY);
    if (v === 'renter' || v === 'landlord' || v === 'broker' || v === 'admin') return v;
    return null;
  } catch {
    return null;
  }
}

export function setPartyRole(role: PartyRole): void {
  localStorage.setItem(ROLE_KEY, role);
}

export function clearPartyRole(): void {
  localStorage.removeItem(ROLE_KEY);
}

export function loadPrequal(): PrequalProfile | null {
  try {
    const raw = localStorage.getItem(PREQUAL_KEY);
    return raw ? (JSON.parse(raw) as PrequalProfile) : null;
  } catch {
    return null;
  }
}

export function savePrequal(profile: PrequalProfile): void {
  localStorage.setItem(PREQUAL_KEY, JSON.stringify(profile));
}

export function loadInterests(): Interest[] {
  try {
    const raw = localStorage.getItem(INTEREST_KEY);
    return raw ? (JSON.parse(raw) as Interest[]) : [];
  } catch {
    return [];
  }
}

export function saveInterests(items: Interest[]): void {
  localStorage.setItem(INTEREST_KEY, JSON.stringify(items));
}

export function expressInterest(input: {
  listing_id: string;
  listing_name: string;
  listing_city: string;
  listing_state: string;
  renter_label: string;
}): Interest {
  const all = loadInterests();
  const existing = all.find((i) => i.listing_id === input.listing_id);
  if (existing) return existing;
  const row: Interest = {
    id: `int_${Date.now()}`,
    listing_id: input.listing_id,
    renter_label: input.renter_label,
    status: 'expressed',
    created_at: new Date().toISOString(),
    listing_name: input.listing_name,
    listing_city: input.listing_city,
    listing_state: input.listing_state,
  };
  all.unshift(row);
  saveInterests(all);
  return row;
}

export function updateInterest(
  id: string,
  patch: Partial<Interest>,
): Interest | null {
  const all = loadInterests();
  const idx = all.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...patch };
  saveInterests(all);
  return all[idx];
}

export type VerificationStatus = 'partial' | 'complete';

export function getLandlordVerification(): VerificationStatus {
  try {
    const v = localStorage.getItem(LANDLORD_VERIF_KEY);
    return v === 'complete' ? 'complete' : 'partial';
  } catch {
    return 'partial';
  }
}

export function setLandlordVerification(status: VerificationStatus): void {
  localStorage.setItem(LANDLORD_VERIF_KEY, status);
}

export type BrokerVerificationStatus = 'pending' | 'verified' | 'rejected';

export function getBrokerVerification(): BrokerVerificationStatus {
  try {
    const v = localStorage.getItem(BROKER_VERIF_KEY);
    if (v === 'verified' || v === 'rejected' || v === 'pending') return v;
    return 'pending';
  } catch {
    return 'pending';
  }
}

export function setBrokerVerification(status: BrokerVerificationStatus): void {
  localStorage.setItem(BROKER_VERIF_KEY, status);
}

/** Seed a demo interest for landlord/renter preview flows (local only). */
export function ensureDemoInterestSeed(): Interest {
  const all = loadInterests();
  const existing = all.find((i) => i.is_demo);
  if (existing) return existing;
  const row: Interest = {
    id: `demo_int_${Date.now()}`,
    listing_id: 'demo-listing-oak',
    renter_label: 'Jordan M. (demo)',
    status: 'expressed',
    created_at: new Date().toISOString(),
    listing_name: 'Oak Courtyard 2BR',
    listing_city: 'Austin',
    listing_state: 'TX',
    is_demo: true,
  };
  all.unshift(row);
  saveInterests(all);
  return row;
}
