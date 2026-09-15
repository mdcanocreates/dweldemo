/**
 * SQS-style worker tier — in-process queue for CI (§2.4).
 * Production seam: swap InProcessQueue for SQS-backed implementation.
 */

export type QueueMessage<T = Record<string, unknown>> = {
  id: string;
  queue: string;
  body: T;
  attempts: number;
  enqueuedAt: Date;
};

export type QueueHandler<T = Record<string, unknown>> = (
  msg: QueueMessage<T>,
) => Promise<void>;

export interface JobQueue {
  enqueue<T extends Record<string, unknown>>(
    queue: string,
    body: T,
    opts?: { id?: string },
  ): Promise<string>;
  registerHandler<T extends Record<string, unknown>>(
    queue: string,
    handler: QueueHandler<T>,
  ): void;
  /** Drain ready messages (CI / in-process). */
  drain(max?: number): Promise<number>;
  depth(queue?: string): number;
}

import { randomUUID } from 'node:crypto';

type InternalMsg = QueueMessage & { queue: string };

export class InProcessQueue implements JobQueue {
  private messages: InternalMsg[] = [];
  private handlers = new Map<string, QueueHandler>();
  private deadLetters: InternalMsg[] = [];
  private readonly maxAttempts: number;

  constructor(opts?: { maxAttempts?: number }) {
    this.maxAttempts = opts?.maxAttempts ?? 3;
  }

  async enqueue<T extends Record<string, unknown>>(
    queue: string,
    body: T,
    opts?: { id?: string },
  ): Promise<string> {
    const id = opts?.id ?? randomUUID();
    this.messages.push({
      id,
      queue,
      body,
      attempts: 0,
      enqueuedAt: new Date(),
    });
    return id;
  }

  registerHandler<T extends Record<string, unknown>>(
    queue: string,
    handler: QueueHandler<T>,
  ): void {
    this.handlers.set(queue, handler as QueueHandler);
  }

  async drain(max = 100): Promise<number> {
    let processed = 0;
    while (processed < max && this.messages.length > 0) {
      const msg = this.messages.shift()!;
      const handler = this.handlers.get(msg.queue);
      if (!handler) {
        this.deadLetters.push(msg);
        processed++;
        continue;
      }
      msg.attempts += 1;
      try {
        await handler(msg);
        processed++;
      } catch {
        if (msg.attempts >= this.maxAttempts) {
          this.deadLetters.push(msg);
        } else {
          this.messages.push(msg);
        }
        processed++;
      }
    }
    return processed;
  }

  depth(queue?: string): number {
    if (!queue) return this.messages.length;
    return this.messages.filter((m) => m.queue === queue).length;
  }

  deadLetterCount(): number {
    return this.deadLetters.length;
  }

  clear(): void {
    this.messages = [];
    this.deadLetters = [];
  }
}

let defaultQueue = new InProcessQueue();

export function getJobQueue(): InProcessQueue {
  return defaultQueue;
}

export function resetJobQueue(): InProcessQueue {
  defaultQueue = new InProcessQueue();
  return defaultQueue;
}
