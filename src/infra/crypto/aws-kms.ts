import {
  DecryptCommand,
  EncryptCommand,
  KMSClient,
  type KMSClientConfig,
} from '@aws-sdk/client-kms';
import type { Logger } from 'pino';

import type { KmsProvider } from './kms.js';

export type AwsKmsProviderOptions = {
  keyId: string;
  region: string;
  client?: KMSClient;
  logger?: Logger;
  clientConfig?: KMSClientConfig;
};

/**
 * AWS KMS envelope wrapper for DEK material (mintDek / openDek).
 * Uses the default credential provider chain (ECS task role in production).
 */
export class AwsKmsProvider implements KmsProvider {
  readonly keyId: string;
  private readonly client: KMSClient;
  private readonly logger?: Logger;

  constructor(opts: AwsKmsProviderOptions) {
    this.keyId = opts.keyId;
    this.logger = opts.logger;
    this.client =
      opts.client ??
      new KMSClient({
        region: opts.region,
        ...opts.clientConfig,
      });
  }

  async wrapKey(plaintextDek: Buffer): Promise<Buffer> {
    try {
      const out = await this.client.send(
        new EncryptCommand({
          KeyId: this.keyId,
          Plaintext: plaintextDek,
        }),
      );
      if (!out.CiphertextBlob) {
        throw new Error('KMS Encrypt returned empty CiphertextBlob');
      }
      return Buffer.from(out.CiphertextBlob);
    } catch (err) {
      this.logger?.error({ err, keyId: this.keyId }, 'kms encrypt failed');
      throw err;
    }
  }

  async unwrapKey(wrappedDek: Buffer): Promise<Buffer> {
    try {
      const out = await this.client.send(
        new DecryptCommand({
          CiphertextBlob: wrappedDek,
          KeyId: this.keyId,
        }),
      );
      if (!out.Plaintext) {
        throw new Error('KMS Decrypt returned empty Plaintext');
      }
      return Buffer.from(out.Plaintext);
    } catch (err) {
      this.logger?.error({ err, keyId: this.keyId }, 'kms decrypt failed');
      throw err;
    }
  }

  async destroyKeyMaterial(_wrappedDek: Buffer): Promise<void> {
    // Per-ciphertext crypto-shred is not supported by KMS; operational key disable handles rotation.
  }
}
