const VISITOR_KEY = 'dwel_visitor_key';

function parseAttributionParams(): {
  ref: string | null;
  campaign: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
} {
  const sources: string[] = [];
  if (typeof window !== 'undefined') {
    sources.push(window.location.search);
    const hash = window.location.hash;
    const qIdx = hash.indexOf('?');
    if (qIdx >= 0) sources.push(hash.slice(qIdx));
  }
  let ref: string | null = null;
  let campaign: string | null = null;
  let utm_source: string | null = null;
  let utm_medium: string | null = null;
  let utm_campaign: string | null = null;
  let utm_content: string | null = null;
  for (const s of sources) {
    const p = new URLSearchParams(s.startsWith('?') ? s.slice(1) : s);
    ref = ref ?? p.get('ref');
    campaign = campaign ?? p.get('campaign');
    utm_source = utm_source ?? p.get('utm_source');
    utm_medium = utm_medium ?? p.get('utm_medium');
    utm_campaign = utm_campaign ?? p.get('utm_campaign');
    utm_content = utm_content ?? p.get('utm_content');
  }
  return { ref, campaign, utm_source, utm_medium, utm_campaign, utm_content };
}

export function getStoredVisitorKey(): string | null {
  try {
    return localStorage.getItem(VISITOR_KEY);
  } catch {
    return null;
  }
}

export function storeVisitorKey(key: string): void {
  try {
    localStorage.setItem(VISITOR_KEY, key);
  } catch {
    /* ignore */
  }
}

/**
 * On app boot: if ?ref= or ?campaign= (or UTMs) present, record visitor attribution
 * and persist opaque visitor_key.
 */
export async function captureAttributionOnBoot(
  postVisit: (body: Record<string, unknown>) => Promise<{ visitor_key: string }>,
): Promise<void> {
  const params = parseAttributionParams();
  if (
    !params.ref &&
    !params.campaign &&
    !params.utm_source &&
    !params.utm_medium &&
    !params.utm_campaign
  ) {
    return;
  }
  try {
    const existing = getStoredVisitorKey();
    const res = await postVisit({
      partner_code: params.ref,
      campaign_code: params.campaign,
      visitor_key: existing,
      landing_path: typeof window !== 'undefined' ? window.location.pathname + window.location.hash : null,
      http_referrer: typeof document !== 'undefined' ? document.referrer || null : null,
      utm_source: params.utm_source,
      utm_medium: params.utm_medium,
      utm_campaign: params.utm_campaign,
      utm_content: params.utm_content,
    });
    if (res.visitor_key) storeVisitorKey(res.visitor_key);
  } catch {
    /* best-effort */
  }
}
