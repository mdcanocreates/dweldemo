export {
  resolveSolarUnderwritingConfig,
  resolveSolarTiersConfig,
  resolveTier,
  type SolarUnderwritingConfig,
  type SolarTiersConfig,
  type SolarTierDef,
} from './config.js';

export {
  SOLAR_ENGINE_MODEL_KEY,
  SOLAR_ENGINE_VERSION,
  computeExpectedProfitShareCents,
  runSolarUnderwriting,
  replaySolarUnderwriting,
  type UnderwritingInput,
  type UnderwritingResult,
} from './engine.js';

export { ensureSolarUnderwritingModel, assertSolarModelActive } from './registry.js';

export {
  submitSolarDeal,
  markSolarDealInstalled,
  cancelSolarDeal,
  getLatestUnderwritingDecision,
  type SubmitSolarDealInput,
  type SubmitSolarDealResult,
} from './deal.js';

export { ingestPartnerRemittance, type DealRemittanceLine } from './remittance.js';

export {
  generateSolarRemittanceStatement,
  matchRemittanceToStatement,
  resolveRemittanceVarianceThresholdCents,
} from './statements.js';

export { quickQuoteSolar, verifyQuoteToken, type QuickQuoteResult } from './quick-quote.js';

export { disburseHomeownerCashback } from './disburse.js';

export {
  journalSolarApprovalAccrual,
  journalSolarRemittanceReceived,
  journalSolarHomeownerDisbursement,
} from './ledger-flows.js';
