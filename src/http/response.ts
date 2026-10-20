import type { ServerResponse } from 'node:http';
import { AppError } from '../modules/shared/errors.js';

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(body));
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof AppError) {
    sendJson(res, err.status, { error: err.code, message: err.message });
    return;
  }
  sendJson(res, 500, { error: 'internal_error', message: 'internal server error' });
}
