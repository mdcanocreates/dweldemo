import type { DbClient } from '../../db/pool.js';
import { resolveConfig } from '../config/index.js';

const PLACEHOLDER =
  '[PLACEHOLDER] This is non-legal sandbox FCRA one-time-use consent copy. Counsel must replace before any production use.';

export async function resolveFcraConsentCopy(
  client: DbClient,
  at = new Date(),
): Promise<{ key: string; text: string; is_placeholder: boolean }> {
  try {
    const cfg = await resolveConfig(client, 'consent_copy', at);
    const payload = (cfg?.payload ?? {}) as { fcra_one_time_use?: string };
    const text = payload.fcra_one_time_use?.trim() || PLACEHOLDER;
    return {
      key: 'consent_copy.fcra_one_time_use',
      text,
      is_placeholder: text.includes('[PLACEHOLDER]'),
    };
  } catch {
    return {
      key: 'consent_copy.fcra_one_time_use',
      text: PLACEHOLDER,
      is_placeholder: true,
    };
  }
}
