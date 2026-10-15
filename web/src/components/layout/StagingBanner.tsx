/**
 * Unmistakable staging chrome. Only when VITE_APP_ENV=staging.
 * Must never render for production builds (VITE_APP_ENV unset or production).
 */
export function StagingBanner() {
  const appEnv = String(import.meta.env.VITE_APP_ENV ?? '').toLowerCase();
  if (appEnv !== 'staging') return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-[110] border-b border-amber-800 bg-amber-500 text-amber-950"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-1.5 text-xs font-semibold tracking-wide sm:text-sm">
        <span className="uppercase">STAGING</span>
        <span aria-hidden="true">·</span>
        <span>Test data only</span>
      </div>
    </div>
  );
}
