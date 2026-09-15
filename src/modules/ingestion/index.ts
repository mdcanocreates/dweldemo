export {
  runIngestionPipeline,
  ingestManualListing,
  ingestCsvRows,
  ensureManualSource,
  ensureCsvSource,
  ensureMappingVersion,
  replayRawRecords,
  handlePushIngest,
  type PipelineCounts,
  type CanonicalListingFields,
} from './pipeline.js';

export type {
  ListingSourceAdapter,
  AdapterKind,
  SourceConfig,
  RawRecord,
  ConnectionTestResult,
  AdapterCapabilities,
  IngestionThresholds,
} from './types.js';
export { DEFAULT_INGESTION_THRESHOLDS, PRECEDENCE } from './types.js';

export {
  getAdapter,
  listAdapters,
  CONFORMANCE_ADAPTER_KINDS,
} from './adapters/registry.js';
export { collectAsync } from './adapters/base.js';

export {
  putCredential,
  getCredential,
  activeSecrets,
  rotateCredential,
  completeRotation,
  refreshOAuth,
  resetCredentialVault,
  sanitizeErrorDetail,
  credentialExpiryRunwayDays,
} from './credentials.js';

export {
  acquireSyncSlot,
  recordSyncSuccess,
  recordSyncFailure,
  getBreakerState,
  resetRateLimiters,
} from './rate-limit.js';

export {
  verifyPushSignature,
  signPushBody,
  mintPushSecret,
  parsePushRecords,
  resetPushNonces,
} from './push.js';

export {
  evaluateQualityGates,
  markSyncQuarantined,
  requestQuarantineOverride,
  applyQuarantineOverride,
} from './quality.js';

export {
  applyDeltaDelistSignal,
  stampAbsentFromReconcile,
  applyDelistGrace,
} from './delist.js';

export { mergeCanonicalListing, recomputeListingAfterDelist } from './merge.js';

export {
  serializeListingForApi,
  findDisplayLeaks,
  type SourceDisplayRule,
  type ListingApiShape,
} from './display-serialize.js';

export {
  createUnclaimedIngestionOrg,
  submitOrgClaim,
  approveOrgClaim,
} from './org-claim.js';

export {
  createPartnerSource,
  testPartnerConnection,
  previewMapping,
  dryRunPartnerSource,
  activatePartnerSource,
} from './onboarding.js';

export { getSourceObservability } from './observability.js';
export { syncSourceFromAdapter } from './sync.js';
export { applyMediaPolicy } from './media.js';
export { transformRecord, DEFAULT_FIELD_MAP } from './transform.js';
