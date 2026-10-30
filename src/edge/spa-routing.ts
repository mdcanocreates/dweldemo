/**
 * Local description of the SPA edge split.
 * /v1, /internal, and /health stay on the API origin.
 * App paths such as /listings are the SPA document.
 * This function is not published to CloudFront.
 */
export type EdgeOrigin = 'api' | 'spa';

export function edgeOriginForPath(pathname: string): EdgeOrigin {
  const path = (pathname.split('?')[0] ?? pathname).replace(/\/+$/, '') || '/';
  if (path === '/health' || path.startsWith('/health/')) return 'api';
  if (path === '/v1' || path.startsWith('/v1/')) return 'api';
  if (path === '/internal' || path.startsWith('/internal/')) return 'api';
  return 'spa';
}
