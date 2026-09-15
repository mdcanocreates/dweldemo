/**
 * P10 — Object storage behind an interface. Production: S3 SSE-KMS.
 * CI uses MemoryObjectStore; never live AWS in tests.
 */

export type PutObjectInput = {
  key: string;
  body: Buffer;
  contentType: string;
};

export type SignedUrlOptions = {
  /** TTL in seconds; hard-capped at 300 (§12.1). */
  expiresInSeconds: number;
  /** Issued-at override for clock tests. */
  issuedAt?: Date;
};

export type SignedUrl = {
  url: string;
  expiresAt: Date;
  storageKey: string;
};

export interface ObjectStore {
  put(input: PutObjectInput): Promise<{ key: string; etag: string }>;
  /** Direct bucket get — denied for private buckets; use getViaSignedUrl. */
  getDirect(key: string): Promise<never>;
  /** Resolve a previously issued signed URL; throws if expired or forged. */
  getViaSignedUrl(url: string): Promise<{ key: string; body: Buffer; contentType: string }>;
  signGetUrl(key: string, opts: SignedUrlOptions): Promise<SignedUrl>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}

export class ObjectStoreAccessDeniedError extends Error {
  constructor(message = 'direct bucket access denied') {
    super(message);
    this.name = 'ObjectStoreAccessDeniedError';
  }
}

export class SignedUrlExpiredError extends Error {
  constructor(message = 'signed url expired') {
    super(message);
    this.name = 'SignedUrlExpiredError';
  }
}

export class SignedUrlInvalidError extends Error {
  constructor(message = 'signed url invalid') {
    super(message);
    this.name = 'SignedUrlInvalidError';
  }
}

const MAX_SIGNED_TTL_SECONDS = 300;

type StoredObject = {
  body: Buffer;
  contentType: string;
  etag: string;
};

type IssuedToken = {
  key: string;
  expiresAtMs: number;
};

/**
 * In-memory private bucket stub. Direct get always denied; signed URLs ≤5 min.
 */
export class MemoryObjectStore implements ObjectStore {
  private objects = new Map<string, StoredObject>();
  private tokens = new Map<string, IssuedToken>();
  private readonly signingSecret: string;

  constructor(opts?: { signingSecret?: string }) {
    this.signingSecret = opts?.signingSecret ?? 'rbit-memory-object-store';
  }

  reset(): void {
    this.objects.clear();
    this.tokens.clear();
  }

  async put(input: PutObjectInput): Promise<{ key: string; etag: string }> {
    const etag = `mem-${input.body.length}-${Date.now()}`;
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
      etag,
    });
    return { key: input.key, etag };
  }

  async getDirect(_key: string): Promise<never> {
    throw new ObjectStoreAccessDeniedError();
  }

  async signGetUrl(key: string, opts: SignedUrlOptions): Promise<SignedUrl> {
    if (!this.objects.has(key)) {
      throw new SignedUrlInvalidError('object not found');
    }
    const ttl = Math.min(Math.max(1, opts.expiresInSeconds), MAX_SIGNED_TTL_SECONDS);
    const issuedAt = opts.issuedAt ?? new Date();
    const expiresAt = new Date(issuedAt.getTime() + ttl * 1000);
    const token = `tok_${Buffer.from(`${key}|${expiresAt.getTime()}|${this.signingSecret}`)
      .toString('base64url')
      .slice(0, 48)}_${Math.random().toString(36).slice(2, 10)}`;
    this.tokens.set(token, { key, expiresAtMs: expiresAt.getTime() });
    const url = `memory://private-bucket/${encodeURIComponent(key)}?token=${token}&expires=${expiresAt.getTime()}`;
    return { url, expiresAt, storageKey: key };
  }

  async getViaSignedUrl(url: string): Promise<{ key: string; body: Buffer; contentType: string }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new SignedUrlInvalidError();
    }
    const token = parsed.searchParams.get('token');
    const expiresParam = parsed.searchParams.get('expires');
    if (!token || !expiresParam) throw new SignedUrlInvalidError();

    const issued = this.tokens.get(token);
    if (!issued) throw new SignedUrlInvalidError('unknown token');

    const nowMs = Date.now();
    const expiresAtMs = Number(expiresParam);
    if (Number.isNaN(expiresAtMs) || nowMs > expiresAtMs || nowMs > issued.expiresAtMs) {
      throw new SignedUrlExpiredError();
    }

    const obj = this.objects.get(issued.key);
    if (!obj) throw new SignedUrlInvalidError('object purged');
    return { key: issued.key, body: Buffer.from(obj.body), contentType: obj.contentType };
  }

  async delete(key: string): Promise<boolean> {
    const existed = this.objects.delete(key);
    for (const [tok, meta] of this.tokens) {
      if (meta.key === key) this.tokens.delete(tok);
    }
    return existed;
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  /** Test helper: force-expire a token by rewriting expiry into the past. */
  expireTokenForUrl(url: string): void {
    const parsed = new URL(url);
    const token = parsed.searchParams.get('token');
    if (!token) return;
    const issued = this.tokens.get(token);
    if (issued) {
      issued.expiresAtMs = Date.now() - 1000;
      this.tokens.set(token, issued);
    }
  }
}

let defaultStore: ObjectStore = new MemoryObjectStore();

export function getObjectStore(): ObjectStore {
  return defaultStore;
}

export function setObjectStore(store: ObjectStore): void {
  defaultStore = store;
}

export function resetObjectStore(): MemoryObjectStore {
  const mem = new MemoryObjectStore();
  defaultStore = mem;
  return mem;
}

export { S3ObjectStore } from './s3.js';
