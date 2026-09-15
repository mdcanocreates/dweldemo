import type { DbClient } from '../../src/db/pool.js';
import type { PipelineInput } from '../../src/modules/screening/index.js';
import {
  resumeApplicationFromPrescreen,
  runApplicationPipeline,
} from '../../src/modules/screening/index.js';

export const TEST_DISCLOSURE_VERSION = 'test-disclosure-v1';

export function withTestScreeningConsent<T extends PipelineInput>(input: T): T {
  return {
    ...input,
    screeningConsent: input.screeningConsent ?? {
      disclosureVersion: TEST_DISCLOSURE_VERSION,
    },
  };
}

export async function runTestApplicationPipeline(
  client: DbClient,
  input: PipelineInput,
) {
  return runApplicationPipeline(client, withTestScreeningConsent(input));
}

export async function resumeTestApplicationFromPrescreen(
  client: DbClient,
  input: PipelineInput & { applicationId: string; skipDeviceGate?: boolean },
) {
  return resumeApplicationFromPrescreen(client, withTestScreeningConsent(input));
}
