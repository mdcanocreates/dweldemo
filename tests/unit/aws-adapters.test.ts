import { describe, expect, it, vi } from 'vitest';

import { mintDek, openDek } from '../../src/infra/crypto/dek.js';
import { AwsKmsProvider } from '../../src/infra/crypto/aws-kms.js';
import {
  MemoryObjectStore,
  ObjectStoreAccessDeniedError,
  SignedUrlExpiredError,
} from '../../src/infra/object-store/index.js';
import { S3ObjectStore } from '../../src/infra/object-store/s3.js';
import { shouldUseAwsInfra } from '../../src/infra/runtime.js';

describe('AwsKmsProvider', () => {
  it('wrapKey and unwrapKey roundtrip via KMS Encrypt/Decrypt', async () => {
    const material = Buffer.alloc(64, 7);
    const ciphertext = Buffer.from('kms-ciphertext');

    const client = {
      send: vi.fn(async (command: { constructor: { name: string } }) => {
        if (command.constructor.name === 'EncryptCommand') {
          return { CiphertextBlob: ciphertext };
        }
        if (command.constructor.name === 'DecryptCommand') {
          return { Plaintext: material };
        }
        throw new Error(`unexpected command ${command.constructor.name}`);
      }),
    };

    const kms = new AwsKmsProvider({
      keyId: 'arn:aws:kms:us-east-2:123:key/abc',
      region: 'us-east-2',
      client: client as never,
    });

    const wrapped = await kms.wrapKey(material);
    expect(wrapped.equals(ciphertext)).toBe(true);

    const opened = await kms.unwrapKey(wrapped);
    expect(opened.equals(material)).toBe(true);

    const minted = await mintDek(kms);
    expect(minted.kmsKeyId).toBe(kms.keyId);

    const field = await openDek(kms, minted.wrappedKey);
    expect(field.encrypt('secret')).toBeTruthy();
  });
});

describe('S3ObjectStore', () => {
  it('denies direct reads', async () => {
    const store = new S3ObjectStore({
      bucket: 'rbit-dev-documents-123',
      kmsKeyId: 'arn:aws:kms:us-east-2:123:key/abc',
      region: 'us-east-2',
      client: { send: vi.fn() } as never,
    });

    await expect(store.getDirect('docs/x')).rejects.toBeInstanceOf(ObjectStoreAccessDeniedError);
  });

  it('put uses SSE-KMS and exists uses HeadObject', async () => {
    const send = vi.fn(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'PutObjectCommand') {
        return { ETag: '"etag-1"' };
      }
      if (command.constructor.name === 'HeadObjectCommand') {
        return {};
      }
      throw new Error(`unexpected command ${command.constructor.name}`);
    });

    const store = new S3ObjectStore({
      bucket: 'rbit-dev-documents-123',
      kmsKeyId: 'arn:aws:kms:us-east-2:123:key/abc',
      region: 'us-east-2',
      client: { send } as never,
    });

    const put = await store.put({
      key: 'docs/org/a',
      body: Buffer.from('hello'),
      contentType: 'text/plain',
    });
    expect(put.etag).toBe('"etag-1"');

    const putInput = send.mock.calls[0]?.[0] as {
      input: {
        ServerSideEncryption?: string;
        SSEKMSKeyId?: string;
      };
    };
    expect(putInput.input.ServerSideEncryption).toBe('aws:kms');
    expect(putInput.input.SSEKMSKeyId).toBe('arn:aws:kms:us-east-2:123:key/abc');

    await expect(store.exists('docs/org/a')).resolves.toBe(true);
  });

  it('rejects expired presigned urls before fetch', async () => {
    const store = new S3ObjectStore({
      bucket: 'rbit-dev-documents-123',
      kmsKeyId: 'arn:aws:kms:us-east-2:123:key/abc',
      region: 'us-east-2',
      client: { send: vi.fn() } as never,
    });

    const expired =
      'https://rbit-dev-documents-123.s3.us-east-2.amazonaws.com/docs/a.pdf?X-Amz-Date=20200101T000000Z&X-Amz-Expires=60';

    await expect(store.getViaSignedUrl(expired)).rejects.toBeInstanceOf(SignedUrlExpiredError);
  });
});

describe('runtime provider selection', () => {
  it('uses AWS infra outside test NODE_ENV', () => {
    expect(shouldUseAwsInfra('dev')).toBe(true);
    expect(shouldUseAwsInfra('production')).toBe(true);
    expect(shouldUseAwsInfra('test')).toBe(false);
  });

  it('tests keep memory object store helper', () => {
    const mem = new MemoryObjectStore();
    expect(mem).toBeInstanceOf(MemoryObjectStore);
  });
});
