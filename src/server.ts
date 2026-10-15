import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPool, type DbPool } from './db/pool.js';
import { loadRdsSslConfig } from './db/rds-ssl.js';
import { createApiRouter } from './http/router.js';
import { createLogger } from './infra/logging/logger.js';
import {
  getRuntimeKms,
  initializeAwsRuntime,
  shouldUseAwsInfra,
} from './infra/runtime.js';
import {
  LiveStripeConnectAdapter,
  setStripeConnectAdapter,
} from './modules/payments/index.js';
import {
  resetVendorRegistry,
  assessCertnAvailability,
  assessCheckrAvailability,
} from './modules/vendors/index.js';

const logger = createLogger();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

/**
 * Boot requirements for local auth:
 * - AWS_REGION, DB_*
 * - JWT_SECRET (present for platform consistency; passwordless uses RBIT_AUTH_HMAC_SECRET)
 *
 * Stripe / S3 / KMS are NOT hard boot blockers. AWS KMS+S3 only initialize when
 * USE_LOCAL_INFRA is unset and KMS_KEY_ID looks like a real ARN.
 */
const config = {
  port: Number(process.env.PORT ?? '3000'),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  appEnv: optionalEnv('APP_ENV', process.env.NODE_ENV ?? 'development'),
  awsRegion: requireEnv('AWS_REGION'),
  dbHost: requireEnv('DB_HOST'),
  dbPort: requireEnv('DB_PORT'),
  dbName: requireEnv('DB_NAME'),
  dbUser: requireEnv('DB_USER'),
  dbPassword: requireEnv('DB_PASSWORD'),
  jwtSecret: optionalEnv('JWT_SECRET', 'rbit-local-dev-jwt-not-for-prod'),
  stripeSecretKey: optionalEnv('STRIPE_SECRET_KEY', 'local_dev_not_a_stripe_key'),
  s3Bucket: optionalEnv('S3_BUCKET'),
  kmsKeyId: optionalEnv('KMS_KEY_ID'),
};

void config.jwtSecret;

const version = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'),
).version as string;

function buildDatabaseUrl(): string {
  const user = encodeURIComponent(config.dbUser);
  const password = encodeURIComponent(config.dbPassword);
  return `postgresql://${user}:${password}@${config.dbHost}:${config.dbPort}/${config.dbName}`;
}

function resolvePoolSsl(): ReturnType<typeof loadRdsSslConfig> | undefined {
  // Local disposable Postgres has no RDS CA — skip TLS when USE_LOCAL_INFRA is set.
  if (process.env.USE_LOCAL_INFRA === '1' || process.env.USE_LOCAL_INFRA === 'true') {
    return undefined;
  }
  return loadRdsSslConfig();
}

function shouldInitializeAwsRuntime(): boolean {
  if (process.env.USE_LOCAL_INFRA === '1' || process.env.USE_LOCAL_INFRA === 'true') {
    return false;
  }
  if (!shouldUseAwsInfra(config.nodeEnv)) {
    return false;
  }
  // Real AWS KMS key ARNs only — skip probe for local placeholders.
  return Boolean(config.kmsKeyId.startsWith('arn:') && config.s3Bucket);
}

let pool: DbPool;

async function checkDatabase(): Promise<boolean> {
  try {
    await pool.query('select 1 as ok');
    return true;
  } catch (err) {
    logger.warn({ err }, 'database health check failed');
    return false;
  }
}

/** Process liveness only — no DB, cache, or network I/O. Used by ALB/ECS probes. */
function buildLiveHealthResponse(): { statusCode: number; body: string } {
  return {
    statusCode: 200,
    body: JSON.stringify({
      status: 'healthy',
      version,
    }),
  };
}

/** Diagnostic readiness — checks PostgreSQL when intentionally requested. */
async function buildReadyHealthResponse(): Promise<{ statusCode: number; body: string }> {
  const dbOk = await checkDatabase();

  return {
    statusCode: dbOk ? 200 : 503,
    body: JSON.stringify({
      status: dbOk ? 'healthy' : 'degraded',
      db: dbOk ? 'connected' : 'disconnected',
      version,
    }),
  };
}

async function main(): Promise<void> {
  const useAws = shouldInitializeAwsRuntime();

  if (useAws) {
    await initializeAwsRuntime({
      awsRegion: config.awsRegion,
      kmsKeyId: config.kmsKeyId,
      s3Bucket: config.s3Bucket,
      logger,
    });
  } else {
    logger.info(
      {
        kms: 'LocalKmsProvider',
        objectStore: 'memory',
        use_local_infra: process.env.USE_LOCAL_INFRA ?? null,
      },
      'using local infra providers (auth/SES do not require AWS KMS/S3 at boot)',
    );
  }

  if (config.stripeSecretKey.startsWith('sk_')) {
    setStripeConnectAdapter(new LiveStripeConnectAdapter(config.stripeSecretKey));
    logger.info({ vendor: 'stripe_connect' }, 'Stripe Connect adapter configured');
  } else {
    logger.warn(
      { event: 'stripe_connect_memory' },
      'Stripe secret not live — using memory Connect adapter',
    );
  }

  pool = createPool({
    connectionString: buildDatabaseUrl(),
    ssl: resolvePoolSsl(),
  });

  // Prefer Checkr Tenant when explicitly enabled; otherwise keep Certn spine.
  const checkr = assessCheckrAvailability();
  const certn = assessCertnAvailability();
  if (checkr.available) {
    resetVendorRegistry({ tenantScreening: 'checkr_tenant' });
    logger.info(
      { vendor: 'checkr_tenant', mode: checkr.mode },
      'tenant screening vendor configured (Checkr)',
    );
  } else if (certn.available) {
    resetVendorRegistry({ tenantScreening: 'certn_sandbox' });
    logger.info({ vendor: 'certn_sandbox', certn: 'configured' }, 'tenant screening vendor configured');
  } else {
    resetVendorRegistry({ tenantScreening: 'certn_unavailable' });
    logger.warn(
      {
        event: 'screening_provider_unavailable',
        reason: checkr.available === false ? checkr.reason : certn.reason,
        vendor: 'certn_unavailable',
        checkr_reason: checkr.available === false ? checkr.reason : null,
      },
      'No screening vendor configured — app boots; screening fails closed',
    );
  }

  const route = createApiRouter({
    pool,
    certnWebhookSecret: process.env.CERTN_WEBHOOK_SECRET ?? null,
    checkrWebhookSecret: process.env.CHECKR_TENANT_WEBHOOK_SECRET ?? null,
  });

  const server = http.createServer(async (req, res) => {
    const path = req.url?.split('?')[0] ?? '';

    if (req.method === 'GET' && path === '/health/live') {
      const health = buildLiveHealthResponse();
      res.writeHead(health.statusCode, { 'Content-Type': 'application/json' });
      res.end(health.body);
      return;
    }

    // Deep/readiness checks for manual diagnostics — not used by ALB.
    if (req.method === 'GET' && (path === '/health' || path === '/health/ready')) {
      const health = await buildReadyHealthResponse();
      res.writeHead(health.statusCode, { 'Content-Type': 'application/json' });
      res.end(health.body);
      return;
    }

    const handled = await route(req, res);
    if (handled) {
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  server.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        environment: config.nodeEnv,
        app_env: config.appEnv,
        region: config.awsRegion,
        kmsKeyId: getRuntimeKms().keyId,
        objectStore: useAws ? 's3' : 'memory',
        email_provider: process.env.EMAIL_PROVIDER ?? 'unset',
      },
      'rbit api listening',
    );
  });
}

main().catch((err) => {
  logger.error({ err }, 'failed to start api');
  process.exit(1);
});
