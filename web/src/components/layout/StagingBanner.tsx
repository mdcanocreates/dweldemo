/**
 * Unmistakable staging chrome. Only when VITE_APP_ENV=staging.
 * Must never render for production builds.
 */
export function StagingBanner() {
  const appEnv = String(import.meta.env.VITE_APP_ENV ?? '').toLowerCase();
  if (appEnv !== 'staging') return null;

  return (
    <div className="staging-banner" role="status">
      <span className="staging-banner__label">STAGING</span>
      <span aria-hidden="true"> · </span>
      <span>Test data only</span>
    </div>
  );
}
