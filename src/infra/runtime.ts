import type { Logger } from 'pino';

import { AwsKmsProvider } from './crypto/aws-kms.js';
import type { KmsProvider } from './crypto/kms.js';
import { getKmsProvider, setKmsProvider } from './crypto/kms.js';
import { S3ObjectStore } from './object-store/s3.js';
import {
  getObjectStore,
  setObjectStore,
  type ObjectStore,
} from './object-store/index.js';

export type AwsRuntimeConfig = {
  awsRegion: string;
  kmsKeyId: string;
  s3Bucket: string;
  logger?: Logger;
};

export type InitializedAwsRuntime = {
  kms: KmsProvider;
  objectStore: ObjectStore;
};

/** Tests and local scripts use in-memory/local providers; ECS uses AWS. */
export function shouldUseAwsInfra(nodeEnv: string | undefined): boolean {
  return nodeEnv !== 'test';
}

/**
 * Wire AWS-backed KMS + S3 into the process-wide provider registries used by domain modules.
 * Performs a lightweight KMS roundtrip and S3 HeadObject capability check at startup.
 */
export async function initializeAwsRuntime(
  config: AwsRuntimeConfig,
): Promise<InitializedAwsRuntime> {
  const kms = new AwsKmsProvider({
    keyId: config.kmsKeyId,
    region: config.awsRegion,
    logger: config.logger,
  });
  const objectStore = new S3ObjectStore({
    bucket: config.s3Bucket,
    kmsKeyId: config.kmsKeyId,
    region: config.awsRegion,
    logger: config.logger,
  });

  await verifyKmsRoundtrip(kms, config.logger);
  await verifyObjectStore(objectStore, config.logger);

  setKmsProvider(kms);
  setObjectStore(objectStore);

  config.logger?.info(
    {
      kmsKeyId: config.kmsKeyId,
      s3Bucket: config.s3Bucket,
      region: config.awsRegion,
    },
    'aws runtime infra initialized',
  );

  return { kms, objectStore };
}

async function verifyKmsRoundtrip(kms: KmsProvider, logger?: Logger): Promise<void> {
  const probe = Buffer.from('rbit-kms-startup-probe');
  try {
    const wrapped = await kms.wrapKey(probe);
    const opened = await kms.unwrapKey(wrapped);
    if (!probe.equals(opened)) {
      throw new Error('KMS roundtrip probe mismatch');
    }
  } catch (err) {
    logger?.error({ err, keyId: kms.keyId }, 'kms startup verification failed');
    throw err;
  }
}

async function verifyObjectStore(store: ObjectStore, logger?: Logger): Promise<void> {
  try {
    await store.exists('__rbit_startup_probe__');
  } catch (err) {
    logger?.error({ err }, 's3 startup verification failed');
    throw err;
  }
}

export function getRuntimeKms(): KmsProvider {
  return getKmsProvider();
}

export function getRuntimeObjectStore(): ObjectStore {
  return getObjectStore();
}
