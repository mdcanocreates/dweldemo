/** Scoring module public surface (§8 / Phase 7). */

export {
  RENTER_SCORE_MODEL_KEY,
  RULES_V0_VERSION,
  ML_V1_CANDIDATE_VERSION,
  FEATURE_SET_VERSION,
  type RenterFeatures,
  type RenterFeatureName,
  type FeatureObservation,
  type FeatureAssemblyInput,
  type AssembledFeatures,
  type ScoreResult,
  type Phase7GateResult,
} from './types.js';

export {
  assembleFeatures,
  assembleOnlineFeatures,
  assembleTrainingFeatures,
  filterPointInTime,
  findLeakingObservations,
  featuresEqual,
  FEATURE_NAMES,
} from './features.js';

export {
  RULES_V0_WEIGHTS,
  runRulesV0,
  runMlV1Candidate,
  replayFromSnapshot,
} from './rules-v0.js';

export {
  evaluatePhase7Gate,
  GATE_MIN_SPAN_DAYS,
  GATE_MIN_LABEL_COVERAGE,
  GATE_HORIZON_DAYS,
} from './gate.js';

export {
  ensureRulesV0Registered,
  getActiveRenterScoreModel,
  isModelActivated,
} from './registry.js';

export {
  computeRenterScore,
  recomputeHistoricalScore,
  loadScore,
  type ComputeScoreInput,
  type PersistedScore,
} from './score.js';

export {
  assembleTrainingMatrix,
  assertTrainingPointInTime,
  runTrainingPipeline,
  offlineEval,
  assertPoisonedFixtureFailsPipeline,
  assembleFeaturesIgnoringPit,
  type TrainingRowFixture,
  type TrainingRow,
  type TrainingPipelineResult,
} from './training.js';

export {
  makePoisonedFixture,
  detectLeakageInAssembled,
  runFeatureLeakageGate,
  type LeakageGateResult,
} from './leakage.js';

export {
  shadowScoreFeatures,
  compareScoreDistributions,
  runShadowHarness,
  recordShadowScoresRefuseActivation,
  assertNotActivatingFromShadow,
  type ShadowScorePair,
  type ShadowRunSummary,
} from './shadow.js';

export {
  computeFeatureDrift,
  computeScoreDrift,
  runDriftMonitors,
  assertDriftAllowsActivation,
  type FeatureDriftReport,
  type DriftMonitorResult,
} from './drift.js';

export {
  activateModelViaConfig,
  tryActivateMlCandidate,
  assertRulesV0ActiveWhenGateUnmet,
  type ActivationResult,
} from './activation.js';

export { generateParityFixtures, type ParityFixture } from './fixtures.js';

export { runOfflineOnlineParity, type ParityResult } from './parity.js';
