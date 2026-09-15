import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Logger } from 'pino';

import {
  ObjectStoreAccessDeniedError,
  SignedUrlExpiredError,
  SignedUrlInvalidError,
  type ObjectStore,
  type PutObjectInput,
  type SignedUrl,
  type SignedUrlOptions,
} from './index.js';

const MAX_SIGNED_TTL_SECONDS = 300;

export type S3ObjectStoreOptions = {
  bucket: string;
  kmsKeyId: string;
  region: string;
  client?: S3Client;
  logger?: Logger;
  clientConfig?: S3ClientConfig;
};

/**
 * Private S3 bucket with SSE-KMS. Direct reads are denied; presigned GET URLs only.
 */
export class S3ObjectStore implements ObjectStore {
  private readonly bucket: string;
  private readonly kmsKeyId: string;
  private readonly region: string;
  private readonly client: S3Client;
  private readonly logger?: Logger;

  constructor(opts: S3ObjectStoreOptions) {
    this.bucket = opts.bucket;
    this.kmsKeyId = opts.kmsKeyId;
    this.region = opts.region;
    this.logger = opts.logger;
    this.client =
      opts.client ??
      new S3Client({
        region: opts.region,
        ...opts.clientConfig,
      });
  }

  async put(input: PutObjectInput): Promise<{ key: string; etag: string }> {
    try {
      const out = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: this.kmsKeyId,
        }),
      );
      return { key: input.key, etag: out.ETag ?? '' };
    } catch (err) {
      this.logger?.error({ err, bucket: this.bucket, key: input.key }, 's3 put failed');
      throw err;
    }
  }

  async getDirect(_key: string): Promise<never> {
    throw new ObjectStoreAccessDeniedError();
  }

  async signGetUrl(key: string, opts: SignedUrlOptions): Promise<SignedUrl> {
    const ttl = Math.min(Math.max(1, opts.expiresInSeconds), MAX_SIGNED_TTL_SECONDS);
    const issuedAt = opts.issuedAt ?? new Date();
    const expiresAt = new Date(issuedAt.getTime() + ttl * 1000);

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const url = await getSignedUrl(this.client, command, { expiresIn: ttl });
      return { url, expiresAt, storageKey: key };
    } catch (err) {
      this.logger?.error({ err, bucket: this.bucket, key }, 's3 signGetUrl failed');
      throw err;
    }
  }

  async getViaSignedUrl(url: string): Promise<{ key: string; body: Buffer; contentType: string }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new SignedUrlInvalidError();
    }

    if (!this.isUrlForBucket(parsed)) {
      throw new SignedUrlInvalidError('signed url is not for the configured bucket');
    }

    if (this.isPresignedUrlExpired(parsed)) {
      throw new SignedUrlExpiredError();
    }

    const key = this.extractObjectKey(parsed);

    try {
      const res = await fetch(url);
      if (res.status === 403) {
        throw new SignedUrlExpiredError();
      }
      if (res.status === 404) {
        throw new SignedUrlInvalidError('object not found');
      }
      if (!res.ok) {
        throw new SignedUrlInvalidError(`signed url fetch failed with status ${res.status}`);
      }
      const body = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
      return { key, body, contentType };
    } catch (err) {
      if (err instanceof SignedUrlExpiredError || err instanceof SignedUrlInvalidError) {
        throw err;
      }
      this.logger?.error({ err, bucket: this.bucket, key }, 's3 getViaSignedUrl failed');
      throw err;
    }
  }

  async delete(key: string): Promise<boolean> {
    const exists = await this.exists(key);
    if (!exists) return false;

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (err) {
      this.logger?.error({ err, bucket: this.bucket, key }, 's3 delete failed');
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (err) {
      const name = (err as { name?: string }).name;
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) {
        return false;
      }
      this.logger?.error({ err, bucket: this.bucket, key }, 's3 exists failed');
      throw err;
    }
  }

  private isUrlForBucket(parsed: URL): boolean {
    const host = parsed.hostname.toLowerCase();
    const bucket = this.bucket.toLowerCase();
    if (host === `${bucket}.s3.${this.region}.amazonaws.com`.toLowerCase()) return true;
    if (host === `${bucket}.s3.amazonaws.com`.toLowerCase()) return true;
    if (host.startsWith(`${bucket}.s3.`) && host.endsWith('.amazonaws.com')) return true;
    // path-style: s3.region.amazonaws.com/bucket/key
    if (host === `s3.${this.region}.amazonaws.com`.toLowerCase()) {
      const segments = parsed.pathname.split('/').filter(Boolean);
      return segments[0]?.toLowerCase() === bucket;
    }
    return false;
  }

  private extractObjectKey(parsed: URL): string {
    const host = parsed.hostname.toLowerCase();
    const bucket = this.bucket.toLowerCase();
    if (host.startsWith(`${bucket}.s3.`) || host === `${bucket}.s3.amazonaws.com`) {
      return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    return decodeURIComponent(segments.slice(1).join('/'));
  }

  private isPresignedUrlExpired(parsed: URL): boolean {
    const amzDate = parsed.searchParams.get('X-Amz-Date');
    const amzExpires = parsed.searchParams.get('X-Amz-Expires');
    if (!amzDate || !amzExpires) return false;

    const year = Number(amzDate.slice(0, 4));
    const month = Number(amzDate.slice(4, 6)) - 1;
    const day = Number(amzDate.slice(6, 8));
    const hour = Number(amzDate.slice(9, 11));
    const minute = Number(amzDate.slice(11, 13));
    const second = Number(amzDate.slice(13, 15));
    const issuedAtMs = Date.UTC(year, month, day, hour, minute, second);
    const expiresAtMs = issuedAtMs + Number(amzExpires) * 1000;
    return Date.now() > expiresAtMs;
  }
}
