/**
 * Source-media permission gate for external deal photos.
 *
 * Publication uses the recorded external_source grant (DB) when present.
 * Code defaults mirror the latest recorded ops authorization.
 */

export type SourceMediaPermission = {
  providerKey: string;
  status: 'unverified' | 'approved' | 'suspended';
  licenseEvidenceRef: string | null;
  permittedFields: readonly string[];
  mediaPolicy: 'host' | 'hotlink' | 'none';
};

/**
 * Authorized hotlink display grant for `rent_com_deal_package`.
 * Ops recorded evidence: ops_authorized_hotlink_display_2026-11-06.
 * Prefer reading live values from external_source; this constant is the fallback.
 */
export const RENT_COM_DEAL_PACKAGE_PERMISSION: SourceMediaPermission = {
  providerKey: 'rent_com_deal_package',
  status: 'approved',
  licenseEvidenceRef: 'ops_authorized_hotlink_display_2026-11-06',
  permittedFields: [
    'address',
    'rent_range',
    'beds',
    'special_text',
    'coordinates_approximate',
    'photos',
    'media',
    'images',
  ],
  mediaPolicy: 'hotlink',
};

/** Historical quarantine default used by unit tests for blocked-path coverage. */
export const RENT_COM_DEAL_PACKAGE_UNVERIFIED: SourceMediaPermission = {
  providerKey: 'rent_com_deal_package',
  status: 'unverified',
  licenseEvidenceRef: 'pending_rights_review',
  permittedFields: ['address', 'rent_range', 'beds', 'special_text', 'coordinates_approximate'],
  mediaPolicy: 'none',
};

const PHOTO_FIELDS = ['photos', 'media', 'images'] as const;

export type ImageUseDecision =
  | { action: 'host' | 'hotlink'; permissionBasis: 'authorized_feed' }
  | { action: 'reject'; reason: string };

export function decideImageUse(permission: SourceMediaPermission): ImageUseDecision {
  if (permission.status !== 'approved') {
    return { action: 'reject', reason: `source_status_${permission.status}` };
  }
  const evidence = permission.licenseEvidenceRef?.trim() ?? '';
  if (!evidence || evidence === 'pending_rights_review') {
    return { action: 'reject', reason: 'no_display_rehost_grant' };
  }
  const allowed = new Set(permission.permittedFields);
  if (!PHOTO_FIELDS.some((field) => allowed.has(field))) {
    return { action: 'reject', reason: 'photos_not_in_permitted_fields' };
  }
  if (permission.mediaPolicy === 'host') {
    return { action: 'host', permissionBasis: 'authorized_feed' };
  }
  if (permission.mediaPolicy === 'hotlink') {
    return { action: 'hotlink', permissionBasis: 'authorized_feed' };
  }
  return { action: 'reject', reason: 'media_policy_none' };
}
