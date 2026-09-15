import { randomUUID } from 'node:crypto';

export type TraceContext = {
  requestId: string;
  parentSpanId?: string;
};

export function newRequestId(): string {
  return randomUUID();
}

export function createTraceContext(parent?: TraceContext): TraceContext {
  return {
    requestId: parent?.requestId ?? newRequestId(),
    parentSpanId: parent?.requestId,
  };
}

/** Minimal span marker until OpenTelemetry exporter is wired in infra. */
export async function withSpan<T>(
  name: string,
  ctx: TraceContext,
  fn: (span: { name: string; requestId: string }) => Promise<T>,
): Promise<T> {
  const span = { name, requestId: ctx.requestId };
  return fn(span);
}
