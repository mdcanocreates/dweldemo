import { Writable } from 'node:stream';
import pino, { type Logger } from 'pino';
import { redactValue } from './redact.js';

export type LogCapture = {
  lines: string[];
  clear(): void;
};

export function createLogCapture(): LogCapture & { stream: Writable } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return {
    lines,
    stream,
    clear() {
      lines.length = 0;
    },
  };
}

export function createLogger(opts?: {
  requestId?: string;
  destination?: Writable;
  level?: string;
}): Logger {
  const base = pino(
    {
      level: opts?.level ?? 'info',
      formatters: {
        log(object) {
          return redactValue(object) as Record<string, unknown>;
        },
      },
      hooks: {
        logMethod(inputArgs, method) {
          if (inputArgs.length >= 2 && typeof inputArgs[0] === 'object') {
            inputArgs[0] = redactValue(inputArgs[0]);
          }
          if (inputArgs.length >= 1 && typeof inputArgs[inputArgs.length - 1] === 'string') {
            const last = inputArgs.length - 1;
            inputArgs[last] = redactValue(inputArgs[last]);
          }
          return method.apply(this, inputArgs);
        },
      },
      base: opts?.requestId ? { request_id: opts.requestId } : undefined,
      redact: {
        paths: [
          'ssn',
          'email',
          'phone',
          'dob',
          'given_name',
          'family_name',
          'government_id',
          'card_number',
          '*.ssn',
          '*.email',
          '*.phone',
          '*.dob',
          '*.given_name',
          '*.family_name',
          '*.government_id',
        ],
        censor: '[REDACTED]',
      },
    },
    opts?.destination,
  );
  return base;
}
