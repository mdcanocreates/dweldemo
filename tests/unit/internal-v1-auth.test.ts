import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

vi.mock('../../src/db/bypass.js', () => ({
  withSystemBypass: vi.fn(async (_pool: unknown, fn: (c: unknown) => Promise<unknown>) => {
    const client = {
      query: vi.fn(async (text: string) => {
        if (typeof text === 'string' && text.includes('select 1')) {
          return { rows: [{ '?column?': 1 }] };
        }
        return { rows: [] };
      }),
    };
    return fn(client);
  }),
}));

import {
  handleInternalHealth,
  handleInternalListApplications,
} from '../../src/http/internal-handlers.js';

function mockRes() {
  let statusCode = 0;
  let body = '';
  const res = {
    writeHead(code: number) {
      statusCode = code;
    },
    end(chunk?: string) {
      body = chunk ?? '';
    },
  } as unknown as ServerResponse;
  return {
    res,
    get status() {
      return statusCode;
    },
    get json() {
      return body ? JSON.parse(body) : null;
    },
  };
}

function mockReq(path: string, auth?: string): IncomingMessage {
  return {
    method: 'GET',
    url: path,
    headers: {
      host: 'localhost',
      ...(auth ? { authorization: auth } : {}),
    },
  } as IncomingMessage;
}

const deps = { pool: {} as never };

describe('internal v1 auth', () => {
  beforeEach(() => {
    delete process.env.DWEL_INTERNAL_SERVICE_TOKEN;
  });

  it('rejects when token env missing (503)', async () => {
    const out = mockRes();
    await handleInternalHealth(
      mockReq('/internal/v1/health', 'Bearer anything-long-enough'),
      out.res,
      deps,
    );
    expect(out.status).toBe(503);
    expect(out.json.error).toBe('internal_auth_unconfigured');
  });

  it('rejects missing bearer (401)', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = 'test-internal-token-32chars!!';
    const out = mockRes();
    await handleInternalHealth(mockReq('/internal/v1/health'), out.res, deps);
    expect(out.status).toBe(401);
    expect(out.json.error).toBe('unauthenticated');
  });

  it('rejects wrong bearer (401)', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = 'test-internal-token-32chars!!';
    const out = mockRes();
    await handleInternalHealth(
      mockReq('/internal/v1/health', 'Bearer wrong-token-value!!!!'),
      out.res,
      deps,
    );
    expect(out.status).toBe(401);
    expect(out.json.error).toBe('unauthenticated');
  });

  it('allows correct bearer on health (happy path)', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = 'test-internal-token-32chars!!';
    const out = mockRes();
    await handleInternalHealth(
      mockReq('/internal/v1/health', 'Bearer test-internal-token-32chars!!'),
      out.res,
      deps,
    );
    expect(out.status).toBe(200);
    expect(out.json).toMatchObject({ ok: true, product: 'dwel' });
  });

  it('lists applications with mocked DB when authorized', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = 'test-internal-token-32chars!!';
    const out = mockRes();
    await handleInternalListApplications(
      mockReq('/internal/v1/applications?limit=10', 'Bearer test-internal-token-32chars!!'),
      out.res,
      deps,
    );
    expect(out.status).toBe(200);
    expect(out.json).toMatchObject({
      items: [],
      nextCursor: null,
      sourceHealth: 'ok',
    });
  });
});
