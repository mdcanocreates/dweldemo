import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type RedisClientType } from 'redis';

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
import { resetVendorRegistry, assessCertnAvailability } from './modules/vendors/index.js';

const logger = createLogger();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const config = {
  port: Number(process.env.PORT ?? '3000'),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  awsRegion: requireEnv('AWS_REGION'),
  dbHost: requireEnv('DB_HOST'),
  dbPort: requireEnv('DB_PORT'),
  dbName: requireEnv('DB_NAME'),
  dbUser: requireEnv('DB_USER'),
  dbPassword: requireEnv('DB_PASSWORD'),
  redisUrl: requireEnv('REDIS_URL'),
  jwtSecret: requireEnv('JWT_SECRET'),
  stripeSecretKey: requireEnv('STRIPE_SECRET_KEY'),
  s3Bucket: requireEnv('S3_BUCKET'),
  kmsKeyId: requireEnv('KMS_KEY_ID'),
};

void config.jwtSecret;

const version = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'),
).version as string;

function buildDatabaseUrl(): string {
  // TLS is configured explicitly via pg Pool `ssl` (CA + rejectUnauthorized).
  // Do not use sslmode=require — it does not verify the Aurora certificate chain.
  const user = encodeURIComponent(config.dbUser);
  const password = encodeURIComponent(config.dbPassword);
  return `postgresql://${user}:${password}@${config.dbHost}:${config.dbPort}/${config.dbName}`;
}

let pool: DbPool;
let redis: RedisClientType;

async function checkDatabase(): Promise<boolean> {
  try {
    await pool.query('select 1 as ok');
    return true;
  } catch (err) {
    logger.warn({ err }, 'database health check failed');
    return false;
  }
}

async function checkCache(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (err) {
    logger.warn({ err }, 'redis health check failed');
    return false;
  }
}

/** Process liveness only — no DB/cache I/O. Used by ALB/ECS probes (Aurora may auto-pause). */
function buildLiveHealthResponse(): { statusCode: number; body: string } {
  return {
    statusCode: 200,
    body: JSON.stringify({
      status: 'healthy',
      version,
    }),
  };
}

/** Diagnostic readiness — checks PostgreSQL (and cache when configured). */
async function buildReadyHealthResponse(): Promise<{ statusCode: number; body: string }> {
  const [dbOk, cacheOk] = await Promise.all([checkDatabase(), checkCache()]);
  const healthy = dbOk && cacheOk;

  return {
    statusCode: healthy ? 200 : 503,
    body: JSON.stringify({
      status: healthy ? 'healthy' : 'degraded',
      db: dbOk ? 'connected' : 'disconnected',
      cache: cacheOk ? 'connected' : 'disconnected',
      version,
    }),
  };
}

async function main(): Promise<void> {
  if (shouldUseAwsInfra(config.nodeEnv)) {
    await initializeAwsRuntime({
      awsRegion: config.awsRegion,
      kmsKeyId: config.kmsKeyId,
      s3Bucket: config.s3Bucket,
      logger,
    });
  }

  // Stripe Connect Express — F-3 confirmed platform Connect active.
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
    ssl: loadRdsSslConfig(),
  });
  redis = createClient({ url: config.redisUrl });
  redis.on('error', (err) => logger.error({ err }, 'redis client error'));
  await redis.connect();

  // Certn live only when Secrets Manager has injected credentials.
  // Never fall back to stub for product screening — unavailable adapter + HTTP gate.
  const certn = assessCertnAvailability();
  if (certn.available) {
    resetVendorRegistry({ tenantScreening: 'certn_sandbox' });
    logger.info({ vendor: 'certn_sandbox', certn: 'configured' }, 'tenant screening vendor configured');
  } else {
    resetVendorRegistry({ tenantScreening: 'certn_unavailable' });
    logger.warn(
      {
        event: 'screening_provider_unavailable',
        reason: certn.reason,
        vendor: 'certn_unavailable',
      },
      'Certn not configured — app boots; submit-screening fails closed',
    );
  }

  const route = createApiRouter({
    pool,
    certnWebhookSecret: process.env.CERTN_WEBHOOK_SECRET ?? null,
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
    const runtime = shouldUseAwsInfra(config.nodeEnv)
      ? {
          kmsKeyId: getRuntimeKms().keyId,
          s3Bucket: config.s3Bucket,
          objectStore: 's3',
        }
      : {
          kmsKeyId: getRuntimeKms().keyId,
          objectStore: 'memory',
        };

    logger.info(
      {
        port: config.port,
        environment: config.nodeEnv,
        region: config.awsRegion,
        ...runtime,
      },
      'rbit api listening',
    );
  });
}

main().catch((err) => {
  logger.error({ err }, 'failed to start api');
  process.exit(1);
});
