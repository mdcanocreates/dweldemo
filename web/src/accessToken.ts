export const ACCESS_QUERY_PARAM = 'access';

const STORAGE_PREFIX = 'dwel_app_access:';

export function readAccessTokenFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(ACCESS_QUERY_PARAM);
  return value?.trim() || null;
}

/** @deprecated prefer readAccessTokenFromSearch / readAccessToken(applicationId) */
export function readAccessToken(applicationIdOrSearch: string): string | null {
  if (applicationIdOrSearch.startsWith('?') || applicationIdOrSearch.includes('=')) {
    return readAccessTokenFromSearch(applicationIdOrSearch);
  }
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + applicationIdOrSearch);
  } catch {
    return null;
  }
}

export function rememberAccessToken(applicationId: string, accessToken: string): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + applicationId, accessToken);
  } catch {
    // ignore quota / private mode
  }
}

export function applicationPath(applicationId: string, accessToken: string): string {
  const params = new URLSearchParams();
  params.set(ACCESS_QUERY_PARAM, accessToken);
  return `/applications/${applicationId}?${params.toString()}`;
}
