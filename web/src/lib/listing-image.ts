/** Neutral placeholder when listing media is missing or fails to load. */
export const LISTING_IMAGE_PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">' +
      '<rect fill="#E5E7EB" width="1200" height="800"/>' +
      '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ' +
      'fill="#6B7280" font-family="system-ui,sans-serif" font-size="28">Photo unavailable</text>' +
      '</svg>',
  );

export function listingPhotoSrc(url?: string | null): string {
  return url && url.trim() ? url : LISTING_IMAGE_PLACEHOLDER;
}
