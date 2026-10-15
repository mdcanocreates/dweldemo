const RETURN_KEY = 'dwel.auth.return.v1';

export type AuthReturn = {
  returnTo: string;
  action?: string;
};

export function setAuthReturn(input: AuthReturn): void {
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify(input));
  } catch {
    /* ignore */
  }
}

export function peekAuthReturn(): AuthReturn | null {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthReturn;
  } catch {
    return null;
  }
}

export function consumeAuthReturn(): AuthReturn | null {
  const value = peekAuthReturn();
  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    /* ignore */
  }
  return value;
}

export function buildLoginHref(returnTo: string, action?: string): string {
  const q = new URLSearchParams({ returnTo });
  if (action) q.set('action', action);
  return `/auth/login?${q.toString()}`;
}

const VIEWED_KEY = 'dwel.recently_viewed.v1';

export function pushRecentlyViewed(listingId: string): void {
  try {
    const raw = localStorage.getItem(VIEWED_KEY);
    const prev = raw ? (JSON.parse(raw) as string[]) : [];
    const next = [listingId, ...prev.filter((id) => id !== listingId)].slice(0, 12);
    localStorage.setItem(VIEWED_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function loadRecentlyViewed(): string[] {
  try {
    const raw = localStorage.getItem(VIEWED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
