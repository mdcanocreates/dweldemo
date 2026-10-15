/**
 * Checkr Tenant readiness + live-key isolation.
 * Fail closed when configuration is invalid. Never invent secrets.
 */

export type CheckrAvailability =
  | { available: true; mode: 'test' | 'live' }
  | {
      available: false;
      reason:
        | 'checkr_disabled'
        | 'checkr_api_key_missing'
        | 'checkr_webhook_secret_missing'
        | 'checkr_api_url_missing'
        | 'checkr_live_key_outside_production'
        | 'checkr_test_key_in_live_mode'
        | 'checkr_mode_mismatch'
        | 'checkr_api_version_missing';
    };

const LIVE_KEY_PREFIX = 'ckr_sk_live_';
const TEST_KEY_PREFIX = 'ckr_sk_test_';

function isApprovedProduction(env: NodeJS.ProcessEnv): boolean {
  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? '').toLowerCase();
  const allowLive = env.CHECKR_TENANT_ALLOW_LIVE === 'true' || env.CHECKR_TENANT_ALLOW_LIVE === '1';
  return allowLive && (appEnv === 'production' || appEnv === 'prod');
}

export function assessCheckrAvailability(
  env: NodeJS.ProcessEnv = process.env,
): CheckrAvailability {
  const enabled =
    env.CHECKR_TENANT_ENABLED === 'true' || env.CHECKR_TENANT_ENABLED === '1';
  if (!enabled) {
    return { available: false, reason: 'checkr_disabled' };
  }

  const apiKey = env.CHECKR_TENANT_API_KEY?.trim() ?? '';
  if (!apiKey) {
    return { available: false, reason: 'checkr_api_key_missing' };
  }

  const webhookSecret = env.CHECKR_TENANT_WEBHOOK_SECRET?.trim() ?? '';
  if (!webhookSecret) {
    return { available: false, reason: 'checkr_webhook_secret_missing' };
  }

  const apiUrl = env.CHECKR_TENANT_API_URL?.trim() ?? '';
  if (!apiUrl) {
    return { available: false, reason: 'checkr_api_url_missing' };
  }

  const apiVersion = env.CHECKR_TENANT_API_VERSION?.trim() ?? '';
  if (!apiVersion) {
    return { available: false, reason: 'checkr_api_version_missing' };
  }

  const configuredMode = (env.CHECKR_TENANT_MODE ?? 'test').trim().toLowerCase();
  if (configuredMode !== 'test' && configuredMode !== 'live') {
    return { available: false, reason: 'checkr_mode_mismatch' };
  }

  const isLiveKey = apiKey.startsWith(LIVE_KEY_PREFIX);
  const isTestKey = apiKey.startsWith(TEST_KEY_PREFIX);

  if (isLiveKey && !isApprovedProduction(env)) {
    return { available: false, reason: 'checkr_live_key_outside_production' };
  }

  if (configuredMode === 'live' && !isLiveKey) {
    return { available: false, reason: 'checkr_mode_mismatch' };
  }

  if (configuredMode === 'test' && isLiveKey) {
    return { available: false, reason: 'checkr_live_key_outside_production' };
  }

  if (configuredMode === 'live' && isTestKey) {
    return { available: false, reason: 'checkr_test_key_in_live_mode' };
  }

  return {
    available: true,
    mode: configuredMode as 'test' | 'live',
  };
}

export function isCheckrEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return assessCheckrAvailability(env).available;
}

export function checkrModeOrNull(
  env: NodeJS.ProcessEnv = process.env,
): 'test' | 'live' | null {
  const a = assessCheckrAvailability(env);
  return a.available ? a.mode : null;
}
