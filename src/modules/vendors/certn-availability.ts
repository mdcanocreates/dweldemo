/**
 * Certn live/sandbox readiness — credentials from Secrets Manager via ECS env.
 * Never invent or hardcode secret values.
 */

export type CertnAvailability =
  | { available: true }
  | {
      available: false;
      /** Machine reason for logs/telemetry — not shown as vendor rejection. */
      reason:
        | 'certn_api_key_missing'
        | 'certn_webhook_secret_missing'
        | 'certn_sandbox_check_types_missing'
        | 'certn_base_url_missing';
    };

export function assessCertnAvailability(
  env: NodeJS.ProcessEnv = process.env,
): CertnAvailability {
  if (!env.CERTN_API_KEY?.trim()) {
    return { available: false, reason: 'certn_api_key_missing' };
  }
  if (!env.CERTN_WEBHOOK_SECRET?.trim()) {
    return { available: false, reason: 'certn_webhook_secret_missing' };
  }
  if (!env.CERTN_BASE_URL?.trim()) {
    return { available: false, reason: 'certn_base_url_missing' };
  }
  const checkTypes = (env.CERTN_SANDBOX_CHECK_TYPES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (checkTypes.length === 0) {
    return { available: false, reason: 'certn_sandbox_check_types_missing' };
  }
  return { available: true };
}

export function isCertnLiveConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return assessCertnAvailability(env).available;
}
