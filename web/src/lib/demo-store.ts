/** Meeting-demo client store — no Certn / Stripe / SES. Session-scoped for public demo. */

export const BROKER_TERMS_VERSION = '2026-10-demo-v1';

export type DemoScreeningStatus =
  | 'interest_received'
  | 'awaiting_consent'
  | 'screening_in_progress'
  | 'screening_complete'
  | 'ready_for_review';

export type DemoApplicant = {
  id: string;
  renter_label: string;
  listing_name: string;
  listing_city: string;
  listing_state: string;
  status: DemoScreeningStatus;
  is_demo: true;
  demo_result?: {
    identity: string;
    background: string;
    overall: string;
    disclaimer: string;
  } | null;
};

export type DemoListing = {
  id: string;
  name: string;
  city: string;
  state: string;
  beds: number;
  rent_label: string;
};

const DEMO_ACK_KEY = 'dwel.demo.broker.ack.v1';
const DEMO_PORTFOLIO_KEY = 'dwel.demo.broker.portfolio.v1';

const SEED_LISTINGS: DemoListing[] = [
  {
    id: 'demo-listing-oak',
    name: 'Oak Courtyard 2BR',
    city: 'Austin',
    state: 'TX',
    beds: 2,
    rent_label: '$2,150',
  },
  {
    id: 'demo-listing-river',
    name: 'River House Townhome',
    city: 'Austin',
    state: 'TX',
    beds: 3,
    rent_label: '$2,850',
  },
  {
    id: 'demo-listing-plaza',
    name: 'Plaza Lofts Studio',
    city: 'Dallas',
    state: 'TX',
    beds: 0,
    rent_label: '$1,650',
  },
];

const SEED_APPLICANTS: DemoApplicant[] = [
  {
    id: 'demo-app-jordan',
    renter_label: 'Jordan M. (demo)',
    listing_name: 'Oak Courtyard 2BR',
    listing_city: 'Austin',
    listing_state: 'TX',
    status: 'interest_received',
    is_demo: true,
  },
  {
    id: 'demo-app-alex',
    renter_label: 'Alex R. (demo)',
    listing_name: 'River House Townhome',
    listing_city: 'Austin',
    listing_state: 'TX',
    status: 'interest_received',
    is_demo: true,
  },
];

export function getPublicDemoBrokerAck(): boolean {
  try {
    const raw = sessionStorage.getItem(DEMO_ACK_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { terms_version?: string };
    return parsed.terms_version === BROKER_TERMS_VERSION;
  } catch {
    return false;
  }
}

/** Public/anonymous demo only — never a production legal record. */
export function setPublicDemoBrokerAck(): void {
  sessionStorage.setItem(
    DEMO_ACK_KEY,
    JSON.stringify({
      terms_version: BROKER_TERMS_VERSION,
      accepted_at: new Date().toISOString(),
      is_demo: true,
      production_record: false,
    }),
  );
}

export function clearPublicDemoBrokerAck(): void {
  sessionStorage.removeItem(DEMO_ACK_KEY);
}

export type DemoPortfolio = {
  listings: DemoListing[];
  applicants: DemoApplicant[];
};

export function loadDemoPortfolio(): DemoPortfolio {
  try {
    const raw = sessionStorage.getItem(DEMO_PORTFOLIO_KEY);
    if (raw) return JSON.parse(raw) as DemoPortfolio;
  } catch {
    /* seed */
  }
  const seeded = { listings: SEED_LISTINGS, applicants: SEED_APPLICANTS };
  sessionStorage.setItem(DEMO_PORTFOLIO_KEY, JSON.stringify(seeded));
  return seeded;
}

export function saveDemoPortfolio(portfolio: DemoPortfolio): void {
  sessionStorage.setItem(DEMO_PORTFOLIO_KEY, JSON.stringify(portfolio));
}

export function updateDemoApplicant(
  id: string,
  patch: Partial<DemoApplicant>,
): DemoApplicant | null {
  const portfolio = loadDemoPortfolio();
  const idx = portfolio.applicants.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  portfolio.applicants[idx] = { ...portfolio.applicants[idx]!, ...patch, is_demo: true };
  saveDemoPortfolio(portfolio);
  return portfolio.applicants[idx]!;
}

export function requestDemoScreening(id: string): DemoApplicant | null {
  return updateDemoApplicant(id, { status: 'awaiting_consent' });
}

export function approveDemoConsent(id: string): DemoApplicant | null {
  return updateDemoApplicant(id, { status: 'screening_in_progress' });
}

export function completeDemoScreeningClient(id: string): DemoApplicant | null {
  return updateDemoApplicant(id, {
    status: 'ready_for_review',
    demo_result: {
      identity: 'Demo complete',
      background: 'Demo complete',
      overall: 'Ready for provider review',
      disclaimer: 'No real background check was performed.',
    },
  });
}

export const DEMO_STATUS_LABEL: Record<DemoScreeningStatus, string> = {
  interest_received: 'Interest received',
  awaiting_consent: 'Awaiting demo consent',
  screening_in_progress: 'Screening in progress',
  screening_complete: 'Screening complete',
  ready_for_review: 'Ready to review',
};
