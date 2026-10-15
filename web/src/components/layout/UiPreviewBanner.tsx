import { Link, useLocation } from 'wouter';
import {
  getUiPreviewRole,
  isUiPreviewActive,
  isUiPreviewAllowed,
  setUiPreviewRole,
  stopUiPreview,
  uiPreviewHomeForRole,
  type UiPreviewRole,
} from '../../lib/ui-preview';

const ROLES: { id: UiPreviewRole; label: string }[] = [
  { id: 'renter', label: 'Renter' },
  { id: 'landlord', label: 'Home Provider' },
  { id: 'broker', label: 'Broker' },
];

/** Obvious local-only PREVIEW chrome. Hidden outside active UI inspection. */
export function UiPreviewBanner() {
  const [, setLocation] = useLocation();
  if (!isUiPreviewAllowed() || !isUiPreviewActive()) return null;
  const role = getUiPreviewRole() ?? 'renter';

  return (
    <div className="sticky top-0 z-[100] border-b border-[#0b3d2a] bg-[#04110a] text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs sm:text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-dwel-mint px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-dwel-ink">
            Local UI preview
          </span>
          <span className="text-white/80">
            In-memory adapters only — no live payments, screening, email, or DB writes.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`rounded px-2.5 py-1 font-semibold ${
                role === r.id ? 'bg-dwel-mint text-dwel-ink' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
              onClick={() => {
                setUiPreviewRole(r.id);
                setLocation(uiPreviewHomeForRole(r.id));
                window.location.reload();
              }}
            >
              {r.label}
            </button>
          ))}
          <Link href="/internal/ui-preview" className="rounded bg-white/10 px-2.5 py-1 font-semibold text-white no-underline hover:bg-white/20">
            Hub
          </Link>
          <button
            type="button"
            className="rounded border border-white/30 px-2.5 py-1 font-semibold text-white/90 hover:bg-white/10"
            onClick={() => {
              stopUiPreview();
              window.location.hash = '#/';
              window.location.reload();
            }}
          >
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}
