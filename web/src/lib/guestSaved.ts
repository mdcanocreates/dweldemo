const STORAGE_KEY = 'dwel.guest_saved_listing_ids.v1';

export function readGuestSavedIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  } catch {
    return [];
  }
}

export function writeGuestSavedIds(ids: readonly string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(ids)]));
}

export function clearGuestSavedIds(): void {
  localStorage.removeItem(STORAGE_KEY);
}
