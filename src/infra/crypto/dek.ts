import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { KmsProvider } from './kms.js';

const FIELD_IV_LEN = 12;

export class FieldEncryptor {
  constructor(
    private readonly plaintextDek: Buffer,
    private readonly hmacKey: Buffer,
  ) {}

  encrypt(plaintext: string | null | undefined): Buffer | null {
    if (plaintext == null || plaintext === '') return null;
    const iv = randomBytes(FIELD_IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.plaintextDek, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]);
  }

  decrypt(blob: Buffer | null | undefined): string | null {
    if (blob == null) return null;
    const iv = blob.subarray(0, FIELD_IV_LEN);
    const tag = blob.subarray(FIELD_IV_LEN, FIELD_IV_LEN + 16);
    const ciphertext = blob.subarray(FIELD_IV_LEN + 16);
    const decipher = createDecipheriv('aes-256-gcm', this.plaintextDek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  hmac(value: string): Buffer {
    return createHmac('sha256', this.hmacKey).update(value.normalize('NFKC').toLowerCase()).digest();
  }

  hmacEquals(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

export async function mintDek(kms: KmsProvider): Promise<{
  plaintextDek: Buffer;
  hmacKey: Buffer;
  wrappedKey: Buffer;
  kmsKeyId: string;
}> {
  const plaintextDek = randomBytes(32);
  const hmacKey = randomBytes(32);
  const material = Buffer.concat([plaintextDek, hmacKey]);
  const wrappedKey = await kms.wrapKey(material);
  return { plaintextDek, hmacKey, wrappedKey, kmsKeyId: kms.keyId };
}

export async function openDek(
  kms: KmsProvider,
  wrappedKey: Buffer,
): Promise<FieldEncryptor> {
  const material = await kms.unwrapKey(wrappedKey);
  const plaintextDek = material.subarray(0, 32);
  const hmacKey = material.subarray(32, 64);
  return new FieldEncryptor(plaintextDek, hmacKey);
}
