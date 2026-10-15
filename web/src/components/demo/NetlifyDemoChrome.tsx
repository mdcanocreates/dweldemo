import { useLocation } from 'wouter';
import {
  isNetlifyDemoMode,
  isNetlifyDemoSessionActive,
  NETLIFY_DEMO_ROLE_ENTRY,
  netlifyDemoHomeForRole,
  setNetlifyDemoRole,
  type NetlifyDemoRole,
} from '../../lib/netlify-demo';
import { setPartyRole } from '../../lib/user-flow-store';

/**
 * Demo-only chrome: environment badge + instant role switching after demo access.
 * Never creates production sessions or calls live APIs.
 */
export function NetlifyDemoChrome() {
  if (!isNetlifyDemoMode()) return null;
  const [, setLocation] = useLocation();

  function goRole(role: NetlifyDemoRole) {
    const home = netlifyDemoHomeForRole(role);
    if (!isNetlifyDemoSessionActive()) {
      setLocation(
        `/auth/login?returnTo=${encodeURIComponent(home)}&role=${encodeURIComponent(role)}`,
      );
      return;
    }
    setNetlifyDemoRole(role);
    setPartyRole(role === 'landlord' ? 'landlord' : role);
    setLocation(home);
  }

  return (
    <div
      role="region"
      aria-label="Dwel demo controls"
      className="sticky top-0 z-[120] border-b border-dwel-gray-800 bg-dwel-black text-dwel-white"
    >
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wide sm:text-sm">
          <span className="rounded bg-dwel-mint/25 px-2 py-0.5 uppercase text-dwel-mint">Demo</span>
          <span className="text-dwel-gray-300">
            Simulated data · not production · no live payments or screening
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(NETLIFY_DEMO_ROLE_ENTRY) as NetlifyDemoRole[]).map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => goRole(role)}
              className="rounded-md border border-white/20 bg-white/5 px-2.5 py-1 text-xs font-semibold text-dwel-white hover:bg-white/15"
            >
              {NETLIFY_DEMO_ROLE_ENTRY[role].label}
            </button>
          ))}
          <a
            href="#/auth/login"
            className="rounded-md px-2 py-1 text-xs font-medium text-dwel-gray-400 underline hover:text-white"
          >
            Demo access
          </a>
        </div>
      </div>
    </div>
  );
}
