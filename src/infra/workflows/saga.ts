/**
 * Temporal-style durable saga seam (§2.4).
 * In CI: InProcessSagaRunner persists step state to screening_saga_state.
 * Production: swap for Temporal worker client — WorkflowRunner interface is the seam.
 */

import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';

export type SagaStepResult = {
  nextStep?: string;
  completed?: boolean;
  failed?: boolean;
  payload?: Record<string, unknown>;
};

export type SagaContext = {
  workflowId: string;
  runId: string;
  screeningOrderId: string;
  step: string;
  state: Record<string, unknown>;
};

export type SagaActivity = (
  client: DbClient,
  ctx: SagaContext,
) => Promise<SagaStepResult>;

export interface WorkflowRunner {
  startScreeningSaga(
    client: DbClient,
    input: { screeningOrderId: string; workflowId?: string },
  ): Promise<{ workflowId: string; runId: string }>;
  /**
   * Advance saga until blocked or complete. Temporal would wait on timers/signals;
   * simulator drives steps synchronously / via queue.
   */
  advance(
    client: DbClient,
    workflowId: string,
  ): Promise<{ status: string; step: string }>;
}

export class InProcessSagaRunner implements WorkflowRunner {
  constructor(private readonly activities: Map<string, SagaActivity>) {}

  async startScreeningSaga(
    client: DbClient,
    input: { screeningOrderId: string; workflowId?: string },
  ): Promise<{ workflowId: string; runId: string }> {
    const workflowId = input.workflowId ?? `screening-${input.screeningOrderId}`;
    const runId = randomUUID();
    await client.query(
      `insert into screening_saga_state (
         screening_order_id, workflow_id, run_id, status, step, state_payload
       ) values ($1,$2,$3,'running','submit', '{}'::jsonb)
       on conflict (screening_order_id) do update
         set workflow_id = excluded.workflow_id,
             run_id = excluded.run_id,
             status = 'running',
             step = 'submit',
             state_payload = '{}'::jsonb,
             updated_at = now()`,
      [input.screeningOrderId, workflowId, runId],
    );
    return { workflowId, runId };
  }

  async advance(
    client: DbClient,
    workflowId: string,
  ): Promise<{ status: string; step: string }> {
    const { rows } = await client.query<{
      screening_order_id: string;
      run_id: string;
      status: string;
      step: string;
      state_payload: Record<string, unknown>;
    }>(
      `select screening_order_id, run_id, status, step, state_payload
       from screening_saga_state where workflow_id = $1 for update`,
      [workflowId],
    );
    const row = rows[0];
    if (!row) throw new Error(`saga not found: ${workflowId}`);
    if (row.status !== 'running') {
      return { status: row.status, step: row.step };
    }

    const activity = this.activities.get(row.step);
    if (!activity) {
      await client.query(
        `update screening_saga_state
         set status = 'failed', step = $2, updated_at = now()
         where workflow_id = $1`,
        [workflowId, row.step],
      );
      return { status: 'failed', step: row.step };
    }

    const result = await activity(client, {
      workflowId,
      runId: row.run_id,
      screeningOrderId: row.screening_order_id,
      step: row.step,
      state: row.state_payload ?? {},
    });

    const nextState = { ...row.state_payload, ...(result.payload ?? {}) };
    if (result.failed) {
      await client.query(
        `update screening_saga_state
         set status = 'failed', state_payload = $2::jsonb, updated_at = now()
         where workflow_id = $1`,
        [workflowId, JSON.stringify(nextState)],
      );
      return { status: 'failed', step: row.step };
    }
    if (result.completed) {
      await client.query(
        `update screening_saga_state
         set status = 'completed', step = 'done', state_payload = $2::jsonb, updated_at = now()
         where workflow_id = $1`,
        [workflowId, JSON.stringify(nextState)],
      );
      return { status: 'completed', step: 'done' };
    }
    const nextStep = result.nextStep ?? row.step;
    await client.query(
      `update screening_saga_state
       set step = $2, state_payload = $3::jsonb, updated_at = now()
       where workflow_id = $1`,
      [workflowId, nextStep, JSON.stringify(nextState)],
    );
    return { status: 'running', step: nextStep };
  }

  /** Drive until terminal or maxSteps (CI helper). */
  async runToIdle(
    client: DbClient,
    workflowId: string,
    maxSteps = 20,
  ): Promise<{ status: string; step: string }> {
    let last = { status: 'running', step: '' };
    for (let i = 0; i < maxSteps; i++) {
      last = await this.advance(client, workflowId);
      if (last.status !== 'running') return last;
      // If step didn't change and still running, wait for external signal (webhooks).
      if (last.step === 'await_products') return last;
    }
    return last;
  }
}

/** Production Temporal worker registration seam — not bound in CI. */
export type TemporalWorkerSeam = {
  taskQueue: string;
  registerScreeningWorkflow(runner: WorkflowRunner): void;
};

export function createTemporalWorkerSeam(taskQueue = 'screening'): TemporalWorkerSeam {
  return {
    taskQueue,
    registerScreeningWorkflow(_runner: WorkflowRunner) {
      // Production: Temporal worker binds workflows/activities here.
    },
  };
}
