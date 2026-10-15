import { AppError } from '../../shared/errors.js';
import { createCertnAdapter } from './certn-adapter.js';
import { createCheckrTenantAdapter } from './checkr-adapter.js';
import type { ScreeningProvider, ScreeningProviderId } from './types.js';

/**
 * Resolve a concrete adapter by id.
 * Works for NEW orders (selected provider) and HISTORICAL orders (bound provider)
 * even when that provider is disabled for new screenings.
 */
export function getScreeningProviderAdapter(
  providerId: ScreeningProviderId,
  env: NodeJS.ProcessEnv = process.env,
): ScreeningProvider {
  switch (providerId) {
    case 'certn':
      return createCertnAdapter(env);
    case 'checkr_tenant':
      return createCheckrTenantAdapter(env);
    default: {
      const _exhaustive: never = providerId;
      throw new AppError(`unknown screening provider: ${_exhaustive}`, 'unknown_provider', 500);
    }
  }
}

export function listReadyScreeningProviders(
  env: NodeJS.ProcessEnv = process.env,
): ScreeningProvider[] {
  return (['certn', 'checkr_tenant'] as ScreeningProviderId[])
    .map((id) => getScreeningProviderAdapter(id, env))
    .filter((p) => p.isInfrastructureReady());
}
