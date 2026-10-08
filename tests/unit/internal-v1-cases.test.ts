import { createHmac, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../../src/db/bypass.js', () => ({
  withSystemBypass: vi.fn(async (_pool: unknown, fn: (c: unknown) => Promise<unknown>) => {
    const client = { query: queryMock };
    return fn(client);
  }),
}));

import {
  handleInternalCaseAction,
  handleInternalGetCase,
  handleInternalHealth,
  handleInternalListCases,
  handleInternalListParties,
  handleInternalScreeningResult,
  handleInternalScreeningStatus,
} from '../../src/http/internal-handlers.js';
import {
  parseSourceCaseId,
  sanitizeOutboxPayload,
} from '../../src/modules/internal/index.js';
import { verifyAssertionJwt } from '../../src/modules/internal/assertion.js';

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

function mockReq(
  path: string,
  opts?: {
    method?: string;
    auth?: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): IncomingMessage {
  const headers: Record<string, string> = {
    host: 'localhost',
    ...(opts?.auth ? { authorization: opts.auth } : {}),
    ...(opts?.headers ?? {}),
  };
  const raw = opts?.body !== undefined ? JSON.stringify(opts.body) : '';
  const req = {
    method: opts?.method ?? 'GET',
    url: path,
    headers,
    async *[Symbol.asyncIterator]() {
      if (raw) yield Buffer.from(raw);
    },
  };
  return req as unknown as IncomingMessage;
}

const TOKEN = 'test-internal-token-32chars!!';
const deps = { pool: {} as never };

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString('base64url');
}

function signHs256Jwt(claims: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

describe('internal v1 cases contract', () => {
  beforeEach(() => {
    delete process.env.DWEL_INTERNAL_SERVICE_TOKEN;
    delete process.env.DWEL_CC_ASSERTION_HMAC_SECRET;
    delete process.env.DWEL_CC_ASSERTION_PUBLIC_KEY;
    queryMock.mockReset();
    queryMock.mockImplementation(async (text: string) => {
      if (typeof text === 'string' && text.includes('select 1')) {
        return { rows: [{ '?column?': 1 }] };
      }
      return { rows: [] };
    });
  });

  it('parseSourceCaseId accepts application uuid and partner-review prefix', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parseSourceCaseId(id)).toEqual({
      caseType: 'application',
      id,
      sourceCaseId: id,
    });
    expect(parseSourceCaseId(`partner-review:${id}`)).toEqual({
      caseType: 'partner_review',
      id,
      sourceCaseId: `partner-review:${id}`,
    });
    expect(parseSourceCaseId(`dwel:partner-review:${id}`).caseType).toBe('partner_review');
  });

  it('sanitizeOutboxPayload strips screening bodies', () => {
    const clean = sanitizeOutboxPayload({
      action: 'approve',
      derived_summary: { score: 99 },
      screening_report: { body: 'secret' },
      toStage: 'verified',
    });
    expect(clean).toEqual({ action: 'approve', toStage: 'verified' });
    expect(clean).not.toHaveProperty('derived_summary');
  });

  it('requires auth on GET /internal/v1/cases', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = TOKEN;
    const out = mockRes();
    await handleInternalListCases(mockReq('/internal/v1/cases'), out.res, deps);
    expect(out.status).toBe(401);
    expect(out.json.error).toBe('unauthenticated');
  });

  it('lists cases when authorized', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = TOKEN;
    const out = mockRes();
    await handleInternalListCases(
      mockReq('/internal/v1/cases?limit=10', { auth: `Bearer ${TOKEN}` }),
      out.res,
      deps,
    );
    expect(out.status).toBe(200);
    expect(out.json).toMatchObject({ items: [], nextCursor: null, sourceHealth: 'ok' });
  });

  it('requires auth on parties', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = TOKEN;
    const out = mockRes();
    await handleInternalListParties(mockReq('/internal/v1/parties'), out.res, deps);
    expect(out.status).toBe(401);
  });

  it('requires Idempotency-Key on case actions', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = TOKEN;
    const out = mockRes();
    await handleInternalCaseAction(
      mockReq('/internal/v1/cases/partner-review/11111111-1111-4111-8111-111111111111/actions/approve', {
        method: 'POST',
        auth: `Bearer ${TOKEN}`,
        body: {},
      }),
      out.res,
      deps,
      'partner-review:11111111-1111-4111-8111-111111111111',
      'approve',
    );
    expect(out.status).toBe(400);
    expect(out.json.error).toBe('idempotency_key_required');
  });

  it('returns 400 unsupported_action for application mutations', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = TOKEN;
    const appId = '11111111-1111-4111-8111-111111111111';
    queryMock.mockImplementation(async (text: string) => {
      if (typeof text === 'string' && text.includes('from internal_action_idempotency')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const out = mockRes();
    await handleInternalCaseAction(
      mockReq(`/internal/v1/cases/${appId}/actions/approve`, {
        method: 'POST',
        auth: `Bearer ${TOKEN}`,
        headers: { 'idempotency-key': randomUUID() },
        body: {},
      }),
      out.res,
      deps,
      appId,
      'approve',
    );
    expect(out.status).toBe(400);
    expect(out.json.error).toBe('unsupported_action');
  });

  it('returns 409 on If-Match version conflict for partner approve', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = TOKEN;
    const reviewId = '22222222-2222-4222-8222-222222222222';
    const version = '2026-01-01T00:00:00.000Z';
    queryMock.mockImplementation(async (text: string) => {
      if (typeof text === 'string' && text.includes('from internal_action_idempotency')) {
        return { rows: [] };
      }
      if (typeof text === 'string' && text.includes('from landlord_self_execution')) {
        return {
          rows: [
            {
              id: reviewId,
              org_id: '33333333-3333-4333-8333-333333333333',
              license_state: 'TX',
              license_type: 'licensed_broker',
              license_number: 'B-1',
              business_entity_name: 'Acme',
              status: 'pending',
              compliance_tag: 'interim_v1',
              created_at: new Date(version),
              reviewer_notes: null,
              reviewed_at: null,
              reviewed_by_party_id: null,
              updated_at: new Date(version),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const out = mockRes();
    await handleInternalCaseAction(
      mockReq(`/internal/v1/cases/partner-review:${reviewId}/actions/approve`, {
        method: 'POST',
        auth: `Bearer ${TOKEN}`,
        headers: {
          'idempotency-key': randomUUID(),
          'if-match': '"stale-version"',
        },
        body: {},
      }),
      out.res,
      deps,
      `partner-review:${reviewId}`,
      'approve',
    );
    expect(out.status).toBe(409);
    expect(out.json.error).toBe('version_conflict');
    expect(out.json.version).toBe(version);
  });

  it('replays stored idempotent response without re-executing', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = TOKEN;
    const reviewId = '22222222-2222-4222-8222-222222222222';
    const stored = { ok: true, replayed: true };
    queryMock.mockImplementation(async (text: string) => {
      if (typeof text === 'string' && text.includes('from internal_action_idempotency')) {
        return {
          rows: [{ response_status: 200, response_body: stored }],
        };
      }
      throw new Error('should not hit other queries on idempotent replay');
    });
    const out = mockRes();
    await handleInternalCaseAction(
      mockReq(`/internal/v1/cases/partner-review:${reviewId}/actions/approve`, {
        method: 'POST',
        auth: `Bearer ${TOKEN}`,
        headers: { 'idempotency-key': '11111111-1111-4111-8111-111111111111' },
        body: {},
      }),
      out.res,
      deps,
      `partner-review:${reviewId}`,
      'approve',
    );
    expect(out.status).toBe(200);
    expect(out.json).toEqual(stored);
  });

  it('screening-status requires auth', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = TOKEN;
    const out = mockRes();
    await handleInternalScreeningStatus(
      mockReq('/internal/v1/cases/11111111-1111-4111-8111-111111111111/screening-status'),
      out.res,
      deps,
      '11111111-1111-4111-8111-111111111111',
    );
    expect(out.status).toBe(401);
  });

  it('screening-result returns 403 without screening scope (status-only preference)', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = TOKEN;
    const out = mockRes();
    await handleInternalScreeningResult(
      mockReq('/internal/v1/cases/11111111-1111-4111-8111-111111111111/screening-result', {
        auth: `Bearer ${TOKEN}`,
      }),
      out.res,
      deps,
      '11111111-1111-4111-8111-111111111111',
    );
    expect(out.status).toBe(403);
    expect(out.json.error).toBe('screening_view_forbidden');
  });

  it('get case 404 when missing', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = TOKEN;
    queryMock.mockResolvedValue({ rows: [] });
    const out = mockRes();
    await handleInternalGetCase(
      mockReq('/internal/v1/cases/11111111-1111-4111-8111-111111111111', {
        auth: `Bearer ${TOKEN}`,
      }),
      out.res,
      deps,
      '11111111-1111-4111-8111-111111111111',
    );
    expect(out.status).toBe(404);
    expect(out.json.error).toBe('not_found');
  });

  it('optional assertion: rejects missing assertion when HMAC configured', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = TOKEN;
    process.env.DWEL_CC_ASSERTION_HMAC_SECRET = 'assertion-hmac-secret!!';
    const out = mockRes();
    await handleInternalHealth(
      mockReq('/internal/v1/health', { auth: `Bearer ${TOKEN}` }),
      out.res,
      deps,
    );
    expect(out.status).toBe(401);
    expect(out.json.error).toBe('assertion_required');
  });

  it('optional assertion: accepts valid HS256 assertion', async () => {
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = TOKEN;
    const secret = 'assertion-hmac-secret!!';
    process.env.DWEL_CC_ASSERTION_HMAC_SECRET = secret;
    const now = Math.floor(Date.now() / 1000);
    const jwt = signHs256Jwt(
      {
        iss: 'rbit-control-center',
        aud: 'dwel-internal',
        sub: 'emp-1',
        scp: ['dwel.cases.read'],
        product: 'dwel',
        jti: randomUUID(),
        iat: now,
        exp: now + 60,
      },
      secret,
    );
    const out = mockRes();
    await handleInternalHealth(
      mockReq('/internal/v1/health', {
        auth: `Bearer ${TOKEN}`,
        headers: { 'x-rbit-service-assertion': jwt },
      }),
      out.res,
      deps,
    );
    expect(out.status).toBe(200);
    expect(out.json).toMatchObject({ ok: true, product: 'dwel' });
  });

  it('verifyAssertionJwt rejects expired token', () => {
    const secret = 'assertion-hmac-secret!!';
    const now = Math.floor(Date.now() / 1000);
    const jwt = signHs256Jwt(
      {
        iss: 'rbit-control-center',
        aud: 'dwel-internal',
        sub: 'emp-1',
        scp: [],
        product: 'dwel',
        jti: randomUUID(),
        iat: now - 120,
        exp: now - 90,
      },
      secret,
    );
    expect(() =>
      verifyAssertionJwt(jwt, { mode: 'hmac', secret }, { nowSec: now }),
    ).toThrow(/expired/i);
  });
});
