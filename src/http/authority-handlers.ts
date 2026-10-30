import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withSystemBypass } from '../db/bypass.js';
import { withTenantContext } from '../db/tenant.js';
import type { DbPool } from '../db/pool.js';
import {
  CreateHousingCase,
  UpdateHousingCase,
  UploadIntent,
  VerifyAssistance,
  AuthorityRole,
} from '../modules/authority/contracts.js';
import {
  acceptInvitation,
  acceptShare,
  acknowledgePacket,
  authorityLiteEnabled,
  authoritySandboxEnabled,
  confirmLeaseup,
  applyTrustedScan,
  caseWorkspace,
  completeUpload,
  confirmMfa,
  createHousingCase,
  createLead,
  createTask,
  createSandboxAgency,
  createUploadIntent,
  dashboard,
  enrollMfa,
  getHousingCase,
  inviteStaff,
  leaseupReport,
  listAudit,
  listHousingCases,
  listTasks,
  listMyAgencies,
  listParticipantCases,
  listProviderLeads,
  listTimeline,
  loadStaff,
  openPreview,
  patchPacketSection,
  previewDocument,
  previewImport,
  patchTask,
  recordExternalInspection,
  rescheduleAppointment,
  revokeShare,
  scheduleAppointment,
  sendOutreach,
  shareCase,
  startPacket,
  submitPacket,
  verifyAssistance,
} from '../modules/authority/service.js';
import { AppError } from '../modules/shared/errors.js';
import { requireSession } from './session-auth.js';
import { readJsonBody } from './request.js';
import { sendError, sendJson } from './response.js';

const UUID = '([0-9a-f-]{36})';

function requestId(req: IncomingMessage): string {
  const header = req.headers['x-request-id'];
  return (Array.isArray(header) ? header[0] : header)?.trim() || randomUUID();
}

function idempotencyKey(req: IncomingMessage): string | null {
  const header = req.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || null;
}

export async function handleAuthority(
  req: IncomingMessage,
  res: ServerResponse,
  deps: { pool: DbPool },
  method: string,
  path: string,
): Promise<boolean> {
  if (!path.startsWith('/v1/authority')) return false;
  if (!authorityLiteEnabled()) {
    sendJson(res, 404, { error: 'not_found', message: 'not found' });
    return true;
  }
  try {
    if (method === 'POST' && path === '/v1/authority/internal/scans') {
      const provided = req.headers['x-authority-scanner'];
      const token = (Array.isArray(provided) ? provided[0] : provided)?.trim() ?? '';
      const body = z
        .object({
          documentId: z.string().uuid(),
          sha256: z.string().length(64),
          verdict: z.enum(['clean', 'malicious', 'error']),
          evidenceId: z.string().min(3).max(120),
        })
        .strict()
        .parse(await readJsonBody(req));
      const scanned = await withSystemBypass(deps.pool, (client) =>
        applyTrustedScan(client, { ...body, token }),
      );
      sendJson(res, 200, scanned);
      return true;
    }

    const identity = await requireSession(deps.pool, req);
    const partyId = identity.partyId;
    const mfaUntil = identity.authorityMfaUntil;
    const rid = requestId(req);

    if (method === 'POST' && path === '/v1/authority/mfa/enroll') {
      const enrolled = await withTenantContext(deps.pool, { partyId }, (client) => enrollMfa(client, partyId));
      sendJson(res, 200, enrolled);
      return true;
    }
    if (method === 'POST' && path === '/v1/authority/mfa/confirm') {
      const body = z.object({ code: z.string().regex(/^\d{6}$/) }).strict().parse(await readJsonBody(req));
      const confirmed = await withTenantContext(deps.pool, { partyId }, (client) =>
        confirmMfa(client, partyId, identity.sessionId, body.code),
      );
      sendJson(res, 200, confirmed);
      return true;
    }

    if (method === 'POST' && path === '/v1/authority/sandbox/agencies') {
      if (!authoritySandboxEnabled()) throw new AppError('not found', 'not_found', 404);
      const body = z.object({ displayName: z.string().min(2).max(120) }).parse(await readJsonBody(req));
      const created = await withSystemBypass(deps.pool, (client) =>
        createSandboxAgency(client, { partyId, displayName: body.displayName }),
      );
      sendJson(res, 201, created);
      return true;
    }

    if (method === 'POST' && path === '/v1/authority/invitations/accept') {
      const body = z.object({ token: z.string().min(16) }).parse(await readJsonBody(req));
      const accepted = await withSystemBypass(deps.pool, (client) =>
        acceptInvitation(client, { partyId, token: body.token }),
      );
      sendJson(res, 200, accepted);
      return true;
    }

    if (method === 'GET' && path === '/v1/authority/me') {
      const agencies = await withTenantContext(deps.pool, { partyId }, (client) =>
        listMyAgencies(client, partyId),
      );
      sendJson(res, 200, agencies);
      return true;
    }

    if (method === 'GET' && path === '/v1/authority/participant/cases') {
      const cases = await withTenantContext(deps.pool, { partyId }, (client) =>
        listParticipantCases(client, partyId),
      );
      sendJson(res, 200, cases);
      return true;
    }

    if (method === 'GET' && path === '/v1/authority/provider/leads') {
      const leads = await withTenantContext(deps.pool, { partyId }, (client) =>
        listProviderLeads(client, partyId),
      );
      sendJson(res, 200, leads);
      return true;
    }

    if (method === 'POST' && path === '/v1/authority/shares/accept') {
      const body = z.object({ shareId: z.string().uuid() }).parse(await readJsonBody(req));
      const accepted = await withTenantContext(deps.pool, { partyId }, (client) =>
        acceptShare(client, partyId, body.shareId, rid),
      );
      sendJson(res, 200, accepted);
      return true;
    }

    if (method === 'POST' && path === '/v1/authority/shares/revoke') {
      const body = z.object({ shareId: z.string().uuid() }).parse(await readJsonBody(req));
      const revoked = await withTenantContext(deps.pool, { partyId }, (client) =>
        revokeShare(client, partyId, body.shareId),
      );
      sendJson(res, 200, revoked);
      return true;
    }

    if (method === 'GET' && path.startsWith('/v1/authority/previews/')) {
      const token = path.slice('/v1/authority/previews/'.length);
      const opened = await withTenantContext(deps.pool, { partyId }, (client) =>
        openPreview(client, partyId, token),
      );
      sendJson(res, 200, opened, { 'Cache-Control': 'private, no-store' });
      return true;
    }

    const agency = path.match(new RegExp(`^/v1/authority/agencies/${UUID}(?:/(.+))?$`, 'i'));
    if (!agency) throw new AppError('not found', 'not_found', 404);
    const agencyId = agency[1]!;
    const rest = agency[2] ?? '';

    const run = <T>(fn: (staff: Awaited<ReturnType<typeof loadStaff>>, client: import('../db/pool.js').DbClient) => Promise<T>) =>
      withTenantContext(deps.pool, { partyId }, async (client) => {
        const staff = await loadStaff(client, partyId, agencyId);
        return fn(staff, client);
      });

    if (method === 'GET' && rest === 'dashboard') {
      sendJson(res, 200, await run((staff, client) => dashboard(client, staff)));
      return true;
    }
    if (method === 'GET' && rest === 'cases') {
      sendJson(res, 200, await run((staff, client) => listHousingCases(client, staff)));
      return true;
    }
    if (method === 'POST' && rest === 'cases') {
      const body = CreateHousingCase.parse(await readJsonBody(req));
      const created = await run((staff, client) =>
        createHousingCase(client, staff, body, idempotencyKey(req), rid),
      );
      sendJson(res, created.replayed ? 200 : 201, created);
      return true;
    }
    if (method === 'POST' && rest === 'invitations') {
      const body = z
        .object({ email: z.string().email(), role: AuthorityRole })
        .parse(await readJsonBody(req));
      const invited = await run((staff, client) => inviteStaff(client, staff, body));
      sendJson(res, 201, authoritySandboxEnabled() ? invited : { invitationId: invited.invitationId, expiresAt: invited.expiresAt });
      return true;
    }
    if (method === 'GET' && rest === 'reports/leaseup') {
      sendJson(res, 200, await run((staff, client) => leaseupReport(client, staff)));
      return true;
    }
    if (method === 'POST' && rest === 'integrations/imports/preview') {
      const body = z.object({ csv: z.string().max(100_000) }).parse(await readJsonBody(req));
      sendJson(res, 200, await run((staff, client) => previewImport(client, staff, body.csv)));
      return true;
    }

    const oneCase = rest.match(new RegExp(`^cases/${UUID}$`, 'i'));
    if (oneCase && method === 'GET') {
      sendJson(res, 200, await run((staff, client) => getHousingCase(client, staff, oneCase[1]!)));
      return true;
    }
    if (oneCase && method === 'PATCH') {
      const body = UpdateHousingCase.parse(await readJsonBody(req));
      sendJson(
        res,
        200,
        await run(async (staff, client) => {
          const current = await getHousingCase(client, staff, oneCase[1]!);
          if (current.case.version !== body.version) {
            throw new AppError('stale case version', 'precondition_failed', 412);
          }
          await client.query(
            `update authority_housing_case
             set search_preferences = coalesce($3::jsonb, search_preferences),
                 status = coalesce($4, status),
                 version = version + 1,
                 updated_at = now()
             where id = $1 and agency_id = $2 and version = $5`,
            [
              oneCase[1],
              staff.agencyId,
              body.searchPreferences ? JSON.stringify(body.searchPreferences) : null,
              body.status ?? null,
              body.version,
            ],
          );
          return getHousingCase(client, staff, oneCase[1]!);
        }),
      );
      return true;
    }

    const share = rest.match(new RegExp(`^cases/${UUID}/share$`, 'i'));
    if (share && method === 'POST') {
      const body = z
        .object({
          granteePartyId: z.string().uuid(),
          purpose: z.string().min(3).max(200),
          days: z.number().int().min(1).max(90).default(14),
        })
        .parse(await readJsonBody(req));
      sendJson(res, 201, await run((staff, client) => shareCase(client, staff, share[1]!, body)));
      return true;
    }

    const leads = rest.match(new RegExp(`^cases/${UUID}/leads$`, 'i'));
    if (leads && method === 'POST') {
      const body = z
        .object({ listingId: z.string().uuid(), providerPartyId: z.string().uuid() })
        .parse(await readJsonBody(req));
      sendJson(res, 201, await run((staff, client) => createLead(client, staff, leads[1]!, body)));
      return true;
    }

    const packets = rest.match(new RegExp(`^cases/${UUID}/packets$`, 'i'));
    if (packets && method === 'POST') {
      const body = z.object({ leadId: z.string().uuid() }).parse(await readJsonBody(req));
      sendJson(res, 201, await run((staff, client) => startPacket(client, staff, packets[1]!, body.leadId)));
      return true;
    }

    const timeline = rest.match(new RegExp(`^cases/${UUID}/timeline$`, 'i'));
    if (timeline && method === 'GET') {
      sendJson(res, 200, await run((staff, client) => listTimeline(client, staff, timeline[1]!)));
      return true;
    }

    const upload = rest.match(new RegExp(`^cases/${UUID}/documents/upload-intent$`, 'i'));
    if (upload && method === 'POST') {
      const body = UploadIntent.parse(await readJsonBody(req));
      sendJson(res, 201, await run((staff, client) => createUploadIntent(client, staff, upload[1]!, body)));
      return true;
    }

    const appointments = rest.match(new RegExp(`^cases/${UUID}/appointments$`, 'i'));
    if (appointments && method === 'POST') {
      const body = z.object({ windowStart: z.string().datetime({ offset: true }) }).parse(await readJsonBody(req));
      sendJson(
        res,
        201,
        await run((staff, client) => scheduleAppointment(client, staff, appointments[1]!, body.windowStart)),
      );
      return true;
    }

    const leaseup = rest.match(new RegExp(`^cases/${UUID}/leaseup$`, 'i'));
    if (leaseup && method === 'POST') {
      const body = z.object({ source: z.string().min(3).max(200) }).parse(await readJsonBody(req));
      sendJson(
        res,
        200,
        await run((staff, client) => confirmLeaseup(client, staff, leaseup[1]!, body.source, rid, mfaUntil)),
      );
      return true;
    }

    const verify = rest.match(new RegExp(`^cases/${UUID}/assistance$`, 'i'));
    if (verify && method === 'POST') {
      const body = VerifyAssistance.parse(await readJsonBody(req));
      sendJson(res, 200, await run((staff, client) => verifyAssistance(client, staff, verify[1]!, body, mfaUntil)));
      return true;
    }

    const outreach = rest.match(new RegExp(`^leads/${UUID}/outreach$`, 'i'));
    if (outreach && method === 'POST') {
      const body = z.object({ body: z.string().min(1).max(2000) }).parse(await readJsonBody(req));
      const key = idempotencyKey(req);
      if (!key) throw new AppError('idempotency key is required', 'validation_error', 400);
      sendJson(res, 201, await run((staff, client) => sendOutreach(client, staff, outreach[1]!, { body: body.body, idempotencyKey: key })));
      return true;
    }

    const packetSubmit = rest.match(new RegExp(`^packets/${UUID}/submit$`, 'i'));
    if (packetSubmit && method === 'POST') {
      const body = z.object({ status: z.string().optional() }).parse(await readJsonBody(req).catch(() => ({})));
      if (body.status === 'agency_approved') {
        throw new AppError('packet submission cannot approve tenancy', 'forbidden', 403);
      }
      sendJson(res, 200, await run((staff, client) => submitPacket(client, staff, packetSubmit[1]!, rid)));
      return true;
    }

    const packetAck = rest.match(new RegExp(`^packets/${UUID}/acknowledge$`, 'i'));
    if (packetAck && method === 'POST') {
      const body = z.object({ reference: z.string().min(3).max(200) }).parse(await readJsonBody(req));
      sendJson(
        res,
        200,
        await run((staff, client) => acknowledgePacket(client, staff, packetAck[1]!, body.reference, rid, mfaUntil)),
      );
      return true;
    }

    const packetPart = rest.match(new RegExp(`^packets/${UUID}/(participant|provider)$`, 'i'));
    if (packetPart && method === 'PATCH') {
      const fields = z.record(z.unknown()).parse(await readJsonBody(req));
      const section = packetPart[2] === 'provider' ? 'provider' : 'participant';
      const saved = await withTenantContext(deps.pool, { partyId }, (client) =>
        patchPacketSection(client, { partyId, packetId: packetPart[1]!, section, fields }),
      );
      sendJson(res, 200, saved);
      return true;
    }

    const result = rest.match(new RegExp(`^appointments/${UUID}/result$`, 'i'));
    if (result && method === 'POST') {
      const body = z
        .object({
          source: z.string().min(3).max(200),
          observation: z.string().min(1).max(500),
          passed: z.boolean().optional(),
        })
        .parse(await readJsonBody(req));
      if (body.passed !== undefined) {
        throw new AppError('inspection pass or fail is not recorded by Dwel', 'forbidden', 403);
      }
      sendJson(
        res,
        200,
        await run((staff, client) =>
          recordExternalInspection(client, staff, result[1]!, {
            source: body.source,
            observation: body.observation,
          }),
        ),
      );
      return true;
    }

    const preview = rest.match(new RegExp(`^documents/${UUID}/preview$`, 'i'));
    if (preview && method === 'GET') {
      const issued = await withTenantContext(deps.pool, { partyId }, async (client) => {
        await loadStaff(client, partyId, agencyId);
        return previewDocument(client, partyId, preview[1]!);
      });
      sendJson(res, 200, issued, { 'Cache-Control': 'private, no-store' });
      return true;
    }

    const workspace = rest.match(new RegExp(`^cases/${UUID}/workspace$`, 'i'));
    if (workspace && method === 'GET') {
      sendJson(res, 200, await run((staff, client) => caseWorkspace(client, staff, workspace[1]!)));
      return true;
    }

    const taskCreate = rest.match(new RegExp(`^cases/${UUID}/tasks$`, 'i'));
    if (taskCreate && method === 'POST') {
      const body = z
        .object({
          title: z.string().min(3).max(160),
          dueAt: z.string().datetime({ offset: true }).nullable().optional(),
          assigneePartyId: z.string().uuid().nullable().optional(),
        })
        .strict()
        .parse(await readJsonBody(req));
      sendJson(
        res,
        201,
        await run((staff, client) =>
          createTask(
            client,
            staff,
            taskCreate[1]!,
            { title: body.title, dueAt: body.dueAt ?? null, assigneePartyId: body.assigneePartyId ?? null },
            rid,
          ),
        ),
      );
      return true;
    }

    if (method === 'GET' && rest === 'tasks') {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const caseId = url.searchParams.get('caseId') ?? undefined;
      sendJson(res, 200, await run((staff, client) => listTasks(client, staff, caseId)));
      return true;
    }

    const taskPatch = rest.match(new RegExp(`^tasks/${UUID}$`, 'i'));
    if (taskPatch && method === 'PATCH') {
      const body = z
        .object({
          status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).optional(),
          dueAt: z.string().datetime({ offset: true }).nullable().optional(),
          expectedVersion: z.number().int().positive(),
        })
        .strict()
        .parse(await readJsonBody(req));
      sendJson(res, 200, await run((staff, client) => patchTask(client, staff, taskPatch[1]!, body, rid)));
      return true;
    }

    const reschedule = rest.match(new RegExp(`^appointments/${UUID}/reschedule$`, 'i'));
    if (reschedule && method === 'POST') {
      const body = z
        .object({
          startAt: z.string().datetime({ offset: true }),
          endAt: z.string().datetime({ offset: true }),
          reason: z.string().trim().min(5).max(500),
          expectedVersion: z.number().int().positive(),
          passed: z.boolean().optional(),
        })
        .strict()
        .parse(await readJsonBody(req));
      if (body.passed !== undefined) {
        throw new AppError('inspection pass or fail is not recorded by Dwel', 'forbidden', 403);
      }
      sendJson(
        res,
        200,
        await run((staff, client) =>
          rescheduleAppointment(
            client,
            staff,
            reschedule[1]!,
            { startAt: body.startAt, endAt: body.endAt, reason: body.reason, expectedVersion: body.expectedVersion },
            rid,
          ),
        ),
      );
      return true;
    }

    if (method === 'GET' && rest === 'audit') {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const limit = Number(url.searchParams.get('limit') ?? '25');
      sendJson(
        res,
        200,
        await run((staff, client) =>
          listAudit(client, staff, {
            caseId: url.searchParams.get('caseId') ?? undefined,
            kind: url.searchParams.get('kind') ?? undefined,
            limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25,
          }),
        ),
      );
      return true;
    }

    const complete = rest.match(new RegExp(`^documents/${UUID}/complete$`, 'i'));
    if (complete && method === 'POST') {
      const body = z.object({ bytesBase64: z.string().min(4).max(7_000_000) }).strict().parse(await readJsonBody(req));
      const bytes = Buffer.from(body.bytesBase64, 'base64');
      sendJson(
        res,
        200,
        await run((staff, client) => completeUpload(client, staff, complete[1]!, bytes)),
      );
      return true;
    }

    throw new AppError('not found', 'not_found', 404);
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendJson(res, 400, { error: 'validation_error', message: 'invalid request body' });
      return true;
    }
    sendError(res, err);
    return true;
  }
}
