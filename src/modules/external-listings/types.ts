export type PackageKind =
  | 'deal_listings_510'
  | 'deal_contacts_510'
  | 'deals_with_email_143'
  | 'hud_with_email_500'
  | 'hud_listings_500'
  | 'hud_pm_emails_500';

export type ListingKind = 'market_deal' | 'hud_assisted' | 'unknown';

export type OfferType = 'weeks_free' | 'months_free' | 'dollar_credit' | 'fee_waiver' | 'other';

export type NormalizedPackageRecord = {
  packageKind: PackageKind;
  packageName: string;
  providerKey: string;
  externalId: string;
  listingKind: ListingKind;
  propertyName: string | null;
  line1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  addressKey: string | null;
  latitude: number | null;
  longitude: number | null;
  locationPrecision: 'area' | 'approximate' | 'unknown';
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
  asOf: string | null;
  specialText: string | null;
  specialTags: string[];
  /** Projected Dwel math from the package — never treat as an entitlement. */
  projectedDwelIncentiveUsd: number | null;
  projectedTotalMoveInSavingsUsd: number | null;
  photoUrls: string[];
  contact: {
    relationshipKind: 'property' | 'management_firm' | 'unknown';
    name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    provenance: string;
  } | null;
  raw: Record<string, unknown>;
  payloadChecksum: string;
  rightsStatus: 'unverified';
  unsafeStringHits: string[];
};

export type ReconciliationReport = {
  generatedAt: string;
  packageRoots: string[];
  recordsSeen: number;
  byPackage: Record<string, number>;
  distinctExternalIds: number;
  dealIds: {
    from510: number;
    fromEmail143: number;
    shared65Expected: number;
    sharedObserved: number;
    additionalFrom143: number;
    distinctDealIds: number;
  };
  hudIds: {
    fromProfiles500: number;
    fromPmEmails500: number;
    shared442Expected: number;
    sharedObserved: number;
    onlyInProfiles: number;
    onlyInPmEmails: number;
    distinctHudIds: number;
  };
  addressCollisionGroups: number;
  addressCollisionExtraIds: number;
  crossSourceAddressGroups: number;
  missingCoordinates: number;
  recordsWithOwnerEmail: number;
  photoUrlCount: number;
  projectedIncentiveClaims: number;
  unsafeStringHits: number;
  rightsApprovedForPublish: number;
  notes: string[];
};
