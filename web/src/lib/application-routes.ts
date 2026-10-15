/** Safe application URL builders — never emit undefined/null IDs. */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREVIEW_ID_RE = /^ui-app-[a-z0-9-]+$/i;

export function isValidApplicationId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const t = id.trim();
  if (!t || t === 'undefined' || t === 'null') return false;
  return UUID_RE.test(t) || PREVIEW_ID_RE.test(t);
}

export function applicationPath(id: unknown): string | null {
  if (!isValidApplicationId(id)) return null;
  return `/applications/${id}`;
}

export function applicationScreeningPath(id: unknown): string | null {
  if (!isValidApplicationId(id)) return null;
  return `/applications/${id}/screening`;
}

export function landlordApplicantPath(id: unknown): string | null {
  if (!isValidApplicationId(id)) return null;
  return `/landlord/applicants/${id}`;
}

export function brokerApplicantPath(id: unknown): string | null {
  if (!isValidApplicationId(id)) return null;
  return `/broker/applicants/${id}`;
}
