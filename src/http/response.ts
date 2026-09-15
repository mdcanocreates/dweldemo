import type { ServerResponse } from 'node:http';
import { AppError } from '../modules/shared/errors.js';

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof AppError) {
    sendJson(res, err.status, { error: err.code, message: err.message });
    return;
  }
  sendJson(res, 500, { error: 'internal_error', message: 'internal server error' });
}
