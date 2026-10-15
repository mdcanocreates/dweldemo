import { AppError } from '../../modules/shared/errors.js';

/**
 * Dev/staging recipient allowlist for passwordless auth email.
 * Prevents local/staging from becoming an open SES mailer.
 */

export function parseAuthEmailAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return (env.AUTH_EMAIL_ALLOWLIST ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Restrict auth email destinations in development/staging.
 * Production (APP_ENV=production or NODE_ENV=production without APP_ENV=dev)
 * does not enforce the allowlist.
 */
export function isAuthEmailAllowlistRequired(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const appEnv = (env.APP_ENV ?? '').trim().toLowerCase();
  if (appEnv === 'production') return false;
  if (appEnv === 'development' || appEnv === 'dev' || appEnv === 'staging') {
    return true;
  }
  const nodeEnv = (env.NODE_ENV ?? '').trim().toLowerCase();
  if (nodeEnv === 'production') return false;
  // NODE_ENV=dev (ECS / local) or unset local → treat as restricted when allowlist configured
  // or when APP_ENV unset and NODE_ENV is dev/test
  if (nodeEnv === 'dev' || nodeEnv === 'development' || nodeEnv === 'test') {
    return true;
  }
  // Local with neither set: still require allowlist if AUTH_EMAIL_ALLOWLIST is present
  return parseAuthEmailAllowlist(env).length > 0;
}

export function assertAuthEmailAllowed(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isAuthEmailAllowlistRequired(env)) return;

  const allow = parseAuthEmailAllowlist(env);
  if (allow.length === 0) {
    throw new AppError(
      'Auth email allowlist is not configured for this environment. Set AUTH_EMAIL_ALLOWLIST.',
      'auth_email_allowlist_missing',
      503,
    );
  }

  const normalized = email.trim().toLowerCase();
  if (!allow.includes(normalized)) {
    throw new AppError(
      'This email address is not allowed to receive sign-in links in this environment.',
      'auth_email_not_allowlisted',
      403,
    );
  }
}
