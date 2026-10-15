import {
  isNetlifyDemoMode,
  NETLIFY_DEMO_ROLE_LOGIN,
  type NetlifyDemoRole,
} from '../../lib/netlify-demo';

/**
 * Demo-only chrome: environment badge + role navigation into real login.
 * Does not create sessions or skip allowlist/auth.
 * Uses hash navigation so it works with either router stack.
 */
export function NetlifyDemoChrome() {
  if (!isNetlifyDemoMode()) return null;

  function goRole(role: NetlifyDemoRole) {
    const entry = NETLIFY_DEMO_ROLE_LOGIN[role];
    // HashRouter / wouter hash location: keep #/… paths.
    window.location.hash = `#${entry.href.startsWith('/') ? entry.href : `/${entry.href}`}`;
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
            Real sign-in required · role buttons only open login
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(NETLIFY_DEMO_ROLE_LOGIN) as NetlifyDemoRole[]).map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => goRole(role)}
              className="rounded-md border border-white/20 bg-white/5 px-2.5 py-1 text-xs font-semibold text-dwel-white hover:bg-white/15"
            >
              {NETLIFY_DEMO_ROLE_LOGIN[role].label}
            </button>
          ))}
          <a
            href="#/"
            className="rounded-md px-2 py-1 text-xs font-medium text-dwel-gray-400 underline hover:text-white"
          >
            Home
          </a>
        </div>
      </div>
    </div>
  );
}
