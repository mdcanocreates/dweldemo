import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

/**
 * Amazon RDS / Aurora CA trust configuration.
 *
 * Default path is baked into the runtime image by the Dockerfile:
 *   /certs/rds-global-bundle.pem
 * Override with RDS_CA_BUNDLE_PATH when needed (local/dev).
 *
 * Uses rejectUnauthorized: true — never disable TLS verification.
 */
export function loadRdsSslConfig(
  caBundlePath: string = process.env.RDS_CA_BUNDLE_PATH ?? '/certs/rds-global-bundle.pem',
): ConnectionOptions {
  const ca = readFileSync(caBundlePath, 'utf8');
  return {
    ca,
    rejectUnauthorized: true,
  };
}
