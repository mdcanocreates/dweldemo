import { decideImageUse, type SourceMediaPermission } from './image-rights.js';

export type DealImageGroup = {
  externalId: string;
  propertyName: string | null;
  sourceUrl: string | null;
  photos: string[];
};

export type ListingImageLink = {
  externalId: string;
  listingId: string;
};

export type PlannedDealImage = {
  externalId: string;
  propertyName: string | null;
  listingId: string | null;
  originUrl: string;
  position: number;
  action: 'host' | 'hotlink' | 'reject';
  reason: string;
};

export type DealImagePlanSummary = {
  propertiesDiscovered: number;
  propertiesMatchedByExternalId: number;
  propertiesUnmatched: number;
  imageReferences: number;
  uniqueImageUrls: number;
  sharedAcrossProperties: number;
  approvedToHost: number;
  approvedToHotlink: number;
  rejected: number;
  rejectedByReason: Record<string, number>;
};

export type DealImagePlan = {
  images: PlannedDealImage[];
  summary: DealImagePlanSummary;
};

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function planDealImageIngest(input: {
  groups: readonly DealImageGroup[];
  links?: readonly ListingImageLink[];
  permission: SourceMediaPermission;
  /** When set, a false value rejects an otherwise approved URL as unreachable. */
  urlAlive?: ReadonlyMap<string, boolean>;
}): DealImagePlan {
  const linkByExternalId = new Map<string, string>();
  for (const link of input.links ?? []) {
    if (link.externalId && link.listingId) linkByExternalId.set(link.externalId, link.listingId);
  }
  const decision = decideImageUse(input.permission);
  const seenGroups = new Set<string>();
  const urlOwners = new Map<string, number>();
  const images: PlannedDealImage[] = [];
  let unmatched = 0;

  for (const group of input.groups) {
    const externalId = group.externalId.trim();
    if (!externalId || seenGroups.has(externalId)) {
      unmatched += 1;
      continue;
    }
    seenGroups.add(externalId);
    const listingId = linkByExternalId.get(externalId) ?? null;
    group.photos.forEach((originUrl, position) => {
      const trimmed = originUrl.trim();
      if (!trimmed) return;
      urlOwners.set(trimmed, (urlOwners.get(trimmed) ?? 0) + 1);
      let action: PlannedDealImage['action'] = 'reject';
      let reason = 'rejected';
      if (!isHttpsUrl(trimmed)) {
        reason = 'invalid_source_url';
      } else if (decision.action === 'reject') {
        reason = decision.reason;
      } else if (input.urlAlive && input.urlAlive.get(trimmed) === false) {
        reason = 'source_url_unreachable';
      } else if (!listingId) {
        reason = 'no_listing_for_external_id';
      } else {
        action = decision.action;
        reason = decision.permissionBasis;
      }
      images.push({
        externalId,
        propertyName: group.propertyName,
        listingId,
        originUrl: trimmed,
        position,
        action,
        reason,
      });
    });
  }

  const rejectedByReason: Record<string, number> = {};
  for (const image of images) {
    if (image.action === 'reject') {
      rejectedByReason[image.reason] = (rejectedByReason[image.reason] ?? 0) + 1;
    }
  }

  return {
    images,
    summary: {
      propertiesDiscovered: input.groups.length,
      propertiesMatchedByExternalId: seenGroups.size,
      propertiesUnmatched: unmatched,
      imageReferences: images.length,
      uniqueImageUrls: urlOwners.size,
      sharedAcrossProperties: [...urlOwners.values()].filter((count) => count > 1).length,
      approvedToHost: images.filter((image) => image.action === 'host').length,
      approvedToHotlink: images.filter((image) => image.action === 'hotlink').length,
      rejected: images.filter((image) => image.action === 'reject').length,
      rejectedByReason,
    },
  };
}
