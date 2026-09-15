import type { IncomingMessage } from 'node:http';

export function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress ?? '0.0.0.0';
}

export function getUserAgent(req: IncomingMessage): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}

export async function readJsonBody<T extends Record<string, unknown>>(
  req: IncomingMessage,
  maxBytes = 64 * 1024,
): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error('request body too large');
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) {
    return {} as T;
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {} as T;
  }
  return JSON.parse(raw) as T;
}

export function parseQuery(url: string): URLSearchParams {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  return new URLSearchParams(q);
}
