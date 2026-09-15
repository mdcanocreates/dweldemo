import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * KMS port. Production uses AWS KMS; tests use LocalKmsProvider.
 * No AWS SDK types cross module boundaries beyond this adapter (P10).
 */
export interface KmsProvider {
  readonly keyId: string;
  wrapKey(plaintextDek: Buffer): Promise<Buffer>;
  unwrapKey(wrappedDek: Buffer): Promise<Buffer>;
  destroyKeyMaterial?(wrappedDek: Buffer): Promise<void>;
}

/** AES-256-GCM local KMS for CI/dev. Not for production. */
export class LocalKmsProvider implements KmsProvider {
  readonly keyId: string;
  private readonly masterKey: Buffer;
  private readonly destroyed = new Set<string>();

  constructor(opts?: { keyId?: string; masterKey?: Buffer }) {
    this.keyId = opts?.keyId ?? 'local/rbit-test-cmk';
    this.masterKey = opts?.masterKey ?? randomBytes(32);
  }

  async wrapKey(plaintextDek: Buffer): Promise<Buffer> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintextDek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]);
  }

  async unwrapKey(wrappedDek: Buffer): Promise<Buffer> {
    const token = wrappedDek.toString('base64');
    if (this.destroyed.has(token)) {
      throw new Error('DEK material destroyed (crypto-shredded)');
    }
    const iv = wrappedDek.subarray(0, 12);
    const tag = wrappedDek.subarray(12, 28);
    const ciphertext = wrappedDek.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  async destroyKeyMaterial(wrappedDek: Buffer): Promise<void> {
    this.destroyed.add(wrappedDek.toString('base64'));
  }
}

let defaultKms: KmsProvider = new LocalKmsProvider();

export function getKmsProvider(): KmsProvider {
  return defaultKms;
}

export function setKmsProvider(provider: KmsProvider): void {
  defaultKms = provider;
}

export function resetKmsProvider(): LocalKmsProvider {
  const kms = new LocalKmsProvider();
  defaultKms = kms;
  return kms;
}

export { AwsKmsProvider } from './aws-kms.js';
