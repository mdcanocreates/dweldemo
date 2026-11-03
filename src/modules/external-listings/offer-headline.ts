import { parseOfferType } from './normalize.js';
import type { OfferType } from './types.js';

/**
 * Compact promotional headline for cards/badges.
 * Full special_text remains the legal/conditions body on detail.
 */
export function offerHeadline(
  specialText: string | null | undefined,
  tags: string[] = [],
): string | null {
  const text = specialText?.trim();
  if (!text) return null;

  const upToWeeks = text.match(/up\s+to\s+(\d+)\s+weeks?\s+free/i);
  if (upToWeeks) return `Up to ${upToWeeks[1]} weeks free`;

  const weeks = text.match(/(\d+)\s+weeks?\s+free/i);
  if (weeks) return `${weeks[1]} weeks free`;

  const upToMonths = text.match(/up\s+to\s+(\d+)\s+months?\s+free/i);
  if (upToMonths) return `Up to ${upToMonths[1]} months free`;

  const months = text.match(/(\d+)\s+months?\s+free/i);
  if (months) return `${months[1]} months free`;

  const gift = text.match(/\$\s*([\d,]+)\s*(?:e-?)?gift\s*card/i);
  if (gift) return `$${gift[1]} gift card`;

  const credit = text.match(/\$\s*([\d,]+)\s*(?:move-?in\s+)?(?:credit|incentive|off)/i);
  if (credit) return `$${credit[1]} move-in credit`;

  if (tags.includes('weeks_free')) return 'Weeks free';
  if (tags.includes('months_free')) return 'Months free';
  if (tags.includes('dollars_off')) return 'Move-in savings';

  const first = text.split(/[.*\n]/)[0]?.trim() ?? '';
  if (first.length > 0 && first.length <= 48) return first;
  return first ? `${first.slice(0, 45).trim()}…` : null;
}

export function buildPropertyOffer(input: {
  specialText: string | null | undefined;
  specialTags?: string[];
  sourceUrl?: string | null;
}): {
  displayText: string;
  offerType: OfferType;
  qualifierText: string;
  sourceReference: string | null;
} | null {
  const specialText = input.specialText?.trim();
  if (!specialText) return null;
  const tags = input.specialTags ?? [];
  const headline = offerHeadline(specialText, tags) ?? 'Move-in special';
  return {
    displayText: headline,
    offerType: parseOfferType(specialText, tags),
    qualifierText: specialText,
    sourceReference: input.sourceUrl?.trim() || null,
  };
}
