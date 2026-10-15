/**
 * Public meeting demo — offline fixture layer.
 * NEVER call /v1/* from consumers of this module.
 */

export type DemoRole = 'renter' | 'home-provider' | 'broker';

export type DemoListingStatus = 'LIVE' | 'PAUSED' | 'DRAFT';

export type DemoPipelineStage =
  | 'interested'
  | 'screening_requested'
  | 'in_progress'
  | 'ready_to_review'
  | 'approved';

export type DemoListing = {
  id: string;
  name: string;
  city: string;
  state: string;
  beds: number;
  baths: number;
  rent_cents: number;
  status: DemoListingStatus;
  provider_id: string;
  provider_name: string;
  impressions: number;
  views: number;
  interests: number;
  screenings: number;
  days_live: number;
  photo: string;
};

export type DemoApplicant = {
  id: string;
  renter_label: string;
  listing_id: string;
  listing_name: string;
  provider_id: string;
  provider_name: string;
  stage: DemoPipelineStage;
  days_in_stage: number;
  prequal: string;
  updated_label: string;
};

export type DemoProvider = {
  id: string;
  name: string;
  listings: number;
  views: number;
  interests: number;
  screenings: number;
  needs_attention: number;
};

export type DemoActivity = {
  id: string;
  text: string;
  when: string;
};

const STORAGE_KEY = 'dwel.demo.universe.v2';

const PROVIDERS: DemoProvider[] = [
  {
    id: 'prov-juniper',
    name: 'Juniper Residential',
    listings: 6,
    views: 2940,
    interests: 14,
    screenings: 4,
    needs_attention: 1,
  },
  {
    id: 'prov-riverside',
    name: 'Riverside Property Group',
    listings: 3,
    views: 1441,
    interests: 7,
    screenings: 2,
    needs_attention: 1,
  },
  {
    id: 'prov-cedar',
    name: 'Cedar House Management',
    listings: 2,
    views: 901,
    interests: 4,
    screenings: 1,
    needs_attention: 0,
  },
  {
    id: 'prov-westline',
    name: 'Westline Holdings',
    listings: 1,
    views: 442,
    interests: 2,
    screenings: 1,
    needs_attention: 1,
  },
];

const LISTINGS: DemoListing[] = [
  {
    id: 'lst-oak',
    name: 'Oak & Congress Flats',
    city: 'Austin',
    state: 'TX',
    beds: 2,
    baths: 2,
    rent_cents: 215000,
    status: 'LIVE',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    impressions: 5842,
    views: 961,
    interests: 14,
    screenings: 4,
    days_live: 18,
    photo: '/apartment-garden.png',
  },
  {
    id: 'lst-southline',
    name: 'Southline Residences',
    city: 'Austin',
    state: 'TX',
    beds: 1,
    baths: 1,
    rent_cents: 189000,
    status: 'LIVE',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    impressions: 4113,
    views: 704,
    interests: 11,
    screenings: 3,
    days_live: 12,
    photo: '/apartment-garden.png',
  },
  {
    id: 'lst-barton',
    name: 'Barton Grove',
    city: 'Austin',
    state: 'TX',
    beds: 3,
    baths: 2,
    rent_cents: 275000,
    status: 'LIVE',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    impressions: 3821,
    views: 593,
    interests: 8,
    screenings: 2,
    days_live: 31,
    photo: '/apartment-garden.png',
  },
  {
    id: 'lst-eastfield',
    name: 'Eastfield Lofts',
    city: 'Austin',
    state: 'TX',
    beds: 1,
    baths: 1,
    rent_cents: 165000,
    status: 'LIVE',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    impressions: 2591,
    views: 441,
    interests: 7,
    screenings: 1,
    days_live: 9,
    photo: '/apartment-garden.png',
  },
  {
    id: 'lst-linden',
    name: 'The Linden',
    city: 'Austin',
    state: 'TX',
    beds: 2,
    baths: 2,
    rent_cents: 242000,
    status: 'LIVE',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    impressions: 1980,
    views: 312,
    interests: 5,
    screenings: 1,
    days_live: 22,
    photo: '/apartment-garden.png',
  },
  {
    id: 'lst-mesa',
    name: 'Mesa Court',
    city: 'Austin',
    state: 'TX',
    beds: 0,
    baths: 1,
    rent_cents: 149000,
    status: 'PAUSED',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    impressions: 870,
    views: 129,
    interests: 2,
    screenings: 0,
    days_live: 40,
    photo: '/apartment-garden.png',
  },
  {
    id: 'lst-river',
    name: 'River House Townhomes',
    city: 'Austin',
    state: 'TX',
    beds: 3,
    baths: 2.5,
    rent_cents: 310000,
    status: 'LIVE',
    provider_id: 'prov-riverside',
    provider_name: 'Riverside Property Group',
    impressions: 3010,
    views: 511,
    interests: 5,
    screenings: 2,
    days_live: 15,
    photo: '/apartment-garden.png',
  },
  {
    id: 'lst-plaza',
    name: 'Plaza Lofts',
    city: 'Dallas',
    state: 'TX',
    beds: 0,
    baths: 1,
    rent_cents: 155000,
    status: 'LIVE',
    provider_id: 'prov-riverside',
    provider_name: 'Riverside Property Group',
    impressions: 2210,
    views: 380,
    interests: 3,
    screenings: 1,
    days_live: 11,
    photo: '/apartment-garden.png',
  },
];

const SEED_APPLICANTS: DemoApplicant[] = [
  {
    id: 'app-jordan',
    renter_label: 'Jordan M.',
    listing_id: 'lst-oak',
    listing_name: 'Oak & Congress Flats',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    stage: 'ready_to_review',
    days_in_stage: 0,
    prequal: 'Income band $5–7.5k · 2 occupants · no pets',
    updated_label: 'Completed 2h ago',
  },
  {
    id: 'app-taylor',
    renter_label: 'Taylor R.',
    listing_id: 'lst-barton',
    listing_name: 'Barton Grove',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    stage: 'interested',
    days_in_stage: 3,
    prequal: 'Income band $7.5–10k · 3 occupants · dog',
    updated_label: 'Waiting 3 days',
  },
  {
    id: 'app-alex',
    renter_label: 'Alex R.',
    listing_id: 'lst-southline',
    listing_name: 'Southline Residences',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    stage: 'interested',
    days_in_stage: 1,
    prequal: 'Income band $4–5k · 1 occupant · no pets',
    updated_label: '1 day ago',
  },
  {
    id: 'app-sam',
    renter_label: 'Sam P.',
    listing_id: 'lst-oak',
    listing_name: 'Oak & Congress Flats',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    stage: 'screening_requested',
    days_in_stage: 1,
    prequal: 'Income band $5–7.5k · 2 occupants',
    updated_label: 'Awaiting consent',
  },
  {
    id: 'app-morgan',
    renter_label: 'Morgan L.',
    listing_id: 'lst-river',
    listing_name: 'River House Townhomes',
    provider_id: 'prov-riverside',
    provider_name: 'Riverside Property Group',
    stage: 'in_progress',
    days_in_stage: 0,
    prequal: 'Income band $10k+ · 2 occupants',
    updated_label: 'Demo screening running',
  },
  {
    id: 'app-casey',
    renter_label: 'Casey T.',
    listing_id: 'lst-eastfield',
    listing_name: 'Eastfield Lofts',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    stage: 'interested',
    days_in_stage: 2,
    prequal: 'Income band $3–4k · 1 occupant',
    updated_label: '2 days ago',
  },
  {
    id: 'app-riley',
    renter_label: 'Riley K.',
    listing_id: 'lst-southline',
    listing_name: 'Southline Residences',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    stage: 'screening_requested',
    days_in_stage: 0,
    prequal: 'Income band $5–7.5k · no pets',
    updated_label: 'Requested today',
  },
  {
    id: 'app-jamie',
    renter_label: 'Jamie N.',
    listing_id: 'lst-linden',
    listing_name: 'The Linden',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    stage: 'in_progress',
    days_in_stage: 1,
    prequal: 'Income band $4–5k · cat',
    updated_label: '1 day in progress',
  },
  {
    id: 'app-drew',
    renter_label: 'Drew S.',
    listing_id: 'lst-plaza',
    listing_name: 'Plaza Lofts',
    provider_id: 'prov-riverside',
    provider_name: 'Riverside Property Group',
    stage: 'interested',
    days_in_stage: 4,
    prequal: 'Income band $3–4k · 1 occupant',
    updated_label: 'Waiting 4 days',
  },
  {
    id: 'app-quinn',
    renter_label: 'Quinn H.',
    listing_id: 'lst-oak',
    listing_name: 'Oak & Congress Flats',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    stage: 'screening_requested',
    days_in_stage: 2,
    prequal: 'Income band $7.5–10k · 2 occupants',
    updated_label: '2 days awaiting consent',
  },
  {
    id: 'app-avery',
    renter_label: 'Avery B.',
    listing_id: 'lst-barton',
    listing_name: 'Barton Grove',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    stage: 'interested',
    days_in_stage: 0,
    prequal: 'Income band $5–7.5k · dog',
    updated_label: 'Today',
  },
  {
    id: 'app-parker',
    renter_label: 'Parker V.',
    listing_id: 'lst-southline',
    listing_name: 'Southline Residences',
    provider_id: 'prov-juniper',
    provider_name: 'Juniper Residential',
    stage: 'interested',
    days_in_stage: 1,
    prequal: 'Income band $4–5k · no pets',
    updated_label: 'Yesterday',
  },
];

const ACTIVITY: DemoActivity[] = [
  { id: 'act-1', text: 'Jordan M. screening completed', when: '14 min ago' },
  { id: 'act-2', text: 'Juniper added Eastfield Lofts', when: '2 hr ago' },
  { id: 'act-3', text: 'Riverside requested screening for Taylor R.', when: '4 hr ago' },
  { id: 'act-4', text: 'Westline accepted broker invitation', when: 'Yesterday' },
  { id: 'act-5', text: 'Oak & Congress Flats interest up 18% this week', when: 'Yesterday' },
];

export type DemoUniverse = {
  applicants: DemoApplicant[];
  /** Per-applicant demo result after complete */
  results: Record<string, { identity: string; background: string; overall: string }>;
};

function seedUniverse(): DemoUniverse {
  return { applicants: structuredClone(SEED_APPLICANTS), results: {} };
}

function loadUniverse(): DemoUniverse {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as DemoUniverse;
  } catch {
    /* seed */
  }
  const seeded = seedUniverse();
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  return seeded;
}

function saveUniverse(u: DemoUniverse): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(u));
}

export function formatRent(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export const PIPELINE_LABEL: Record<DemoPipelineStage, string> = {
  interested: 'Interested',
  screening_requested: 'Screening requested',
  in_progress: 'In progress',
  ready_to_review: 'Ready to review',
  approved: 'Approved',
};

/** Single offline demo repository — public demo routes only. */
export const DemoDataProvider = {
  getListings(): DemoListing[] {
    return LISTINGS;
  },

  getJuniperListings(): DemoListing[] {
    return LISTINGS.filter((l) => l.provider_id === 'prov-juniper');
  },

  getProviders(): DemoProvider[] {
    return PROVIDERS;
  },

  getActivity(): DemoActivity[] {
    return ACTIVITY;
  },

  getApplicants(): DemoApplicant[] {
    return loadUniverse().applicants;
  },

  getJuniperApplicants(): DemoApplicant[] {
    return loadUniverse().applicants.filter((a) => a.provider_id === 'prov-juniper');
  },

  getResult(applicantId: string) {
    return loadUniverse().results[applicantId] ?? null;
  },

  getExposureMetrics() {
    const listings = LISTINGS;
    const impressions = listings.reduce((s, l) => s + l.impressions, 0);
    const views = listings.reduce((s, l) => s + l.views, 0);
    const interests = listings.reduce((s, l) => s + l.interests, 0);
    const screenings = listings.reduce((s, l) => s + l.screenings, 0);
    return {
      impressions,
      views,
      interests,
      screenings,
      viewToInterestPct: views ? Math.round((interests / views) * 1000) / 10 : 0,
    };
  },

  getHomeProviderDashboard() {
    const applicants = this.getJuniperApplicants();
    const listings = this.getJuniperListings();
    const exposure = {
      impressions: listings.reduce((s, l) => s + l.impressions, 0),
      views: listings.reduce((s, l) => s + l.views, 0),
      interests: listings.reduce((s, l) => s + l.interests, 0),
      screenings: listings.reduce((s, l) => s + l.screenings, 0),
    };
    const viewToInterestPct = exposure.views
      ? Math.round((exposure.interests / exposure.views) * 1000) / 10
      : 0;
    const pipeline = {
      interested: applicants.filter((a) => a.stage === 'interested'),
      screening_requested: applicants.filter((a) => a.stage === 'screening_requested'),
      in_progress: applicants.filter((a) => a.stage === 'in_progress'),
      ready_to_review: applicants.filter((a) => a.stage === 'ready_to_review'),
      approved: applicants.filter((a) => a.stage === 'approved'),
    };
    const attention = [
      ...pipeline.ready_to_review.map((a) => ({
        kind: 'screening_ready' as const,
        applicant: a,
        title: 'Screening ready',
        cta: 'Review',
      })),
      ...pipeline.interested
        .filter((a) => a.days_in_stage >= 2)
        .map((a) => ({
          kind: 'waiting' as const,
          applicant: a,
          title: `Waiting ${a.days_in_stage} days`,
          cta: 'Request screening',
        })),
    ];
    return {
      orgName: 'Juniper Residential',
      greeting: 'Good morning.',
      attentionCount: attention.length,
      screeningReadyCount: pipeline.ready_to_review.length,
      exposure: { ...exposure, viewToInterestPct },
      attention,
      pipeline,
      listings,
      billing: {
        accrued: 31800,
        nextInvoice: 'Oct 15',
        costPerInterest: 676,
        earlyAdopter: true,
      },
      alerts: [
        `${pipeline.interested.filter((a) => a.days_in_stage >= 2).length} renters waiting for screening request`,
        `${pipeline.ready_to_review.length} completed screening ready to review`,
        'Oak & Congress Flats interest up 18% this week',
      ],
    };
  },

  getBrokerDashboard() {
    const applicants = this.getApplicants();
    const listings = this.getListings();
    const providers = this.getProviders();
    const exposure = this.getExposureMetrics();
    const awaitingDecision = applicants.filter((a) => a.stage === 'ready_to_review').length;
    return {
      orgName: 'Premier Residential Partners',
      kpis: {
        properties: listings.length,
        homeProviders: providers.length,
        interests: 27,
        screenings: 8,
        awaitingOwnerDecision: awaitingDecision || 3,
      },
      actionCenter: [
        '2 providers have renters waiting > 48h',
        '1 screening ready for provider review',
        '3 listings had low exposure this week',
      ],
      providers,
      funnel: {
        impressions: exposure.impressions,
        views: exposure.views,
        interests: 27,
        screenings: 8,
        awaitingDecision: awaitingDecision || 3,
      },
      listings: [...listings].sort((a, b) => b.views - a.views),
      activity: this.getActivity(),
      invitations: {
        pending: [
          { id: 'inv-1', name: 'Hillcrest Assets', sent: '2 days ago' },
          { id: 'inv-2', name: 'Northside Living', sent: '5 days ago' },
        ],
        active: providers.map((p) => p.name),
      },
      applicants,
    };
  },

  getRenterDashboard() {
    const listings = this.getListings().filter((l) => l.status === 'LIVE');
    const applicants = this.getApplicants();
    const jordan = applicants.find((a) => a.id === 'app-jordan');
    const sam = applicants.find((a) => a.id === 'app-sam');
    return {
      name: 'Jordan M.',
      actionRequired: sam
        ? {
            title: 'Screening requested',
            listing: sam.listing_name,
            applicantId: sam.id,
            cta: 'Complete screening',
          }
        : jordan?.stage === 'ready_to_review'
          ? null
          : {
              title: 'Screening requested',
              listing: 'Oak & Congress Flats',
              applicantId: 'app-sam',
              cta: 'Complete screening',
            },
      saved: listings.slice(0, 3),
      applications: [
        {
          id: 'app-sam',
          listing: 'Oak & Congress Flats',
          status: 'Screening requested',
          stage: 'screening_requested' as DemoPipelineStage,
        },
        {
          id: 'app-jordan-interest',
          listing: 'Southline Residences',
          status: 'Interest sent',
          stage: 'interested' as DemoPipelineStage,
        },
        {
          id: 'app-view-barton',
          listing: 'Barton Grove',
          status: 'Recently viewed',
          stage: 'interested' as DemoPipelineStage,
        },
      ],
      recentlyViewed: listings.slice(2, 5),
    };
  },

  requestScreening(applicantId: string): DemoApplicant | null {
    const u = loadUniverse();
    const a = u.applicants.find((x) => x.id === applicantId);
    if (!a || a.stage !== 'interested') return null;
    a.stage = 'screening_requested';
    a.days_in_stage = 0;
    a.updated_label = 'Awaiting consent';
    saveUniverse(u);
    return a;
  },

  approveDemoConsent(applicantId: string): DemoApplicant | null {
    const u = loadUniverse();
    const a = u.applicants.find((x) => x.id === applicantId);
    if (!a || a.stage !== 'screening_requested') return null;
    a.stage = 'in_progress';
    a.days_in_stage = 0;
    a.updated_label = 'Demo screening running';
    saveUniverse(u);
    return a;
  },

  completeDemoScreening(applicantId: string): DemoApplicant | null {
    const u = loadUniverse();
    const a = u.applicants.find((x) => x.id === applicantId);
    if (!a || (a.stage !== 'in_progress' && a.stage !== 'screening_requested')) return null;
    a.stage = 'ready_to_review';
    a.days_in_stage = 0;
    a.updated_label = 'Completed just now';
    u.results[applicantId] = {
      identity: 'Demo complete',
      background: 'Demo complete',
      overall: 'Ready for provider review',
    };
    saveUniverse(u);
    return a;
  },

  reset(): void {
    sessionStorage.removeItem(STORAGE_KEY);
  },
};
