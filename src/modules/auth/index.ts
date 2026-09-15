export {
  issueMagicToken,
  redeemMagicToken,
  resetAuthRateLimits,
  platformEmailHmac,
  type MagicTokenIssueResult,
} from './passwordless.js';

export {
  issueApplicationAccessToken,
  validateApplicationAccessToken,
  revokeApplicationAccessTokens,
  resetApplicationAccessRateLimits,
  resolveApplicationAccessTtlMs,
  type IssueApplicationAccessTokenInput,
  type IssueApplicationAccessTokenResult,
  type ValidateApplicationAccessInput,
} from './application-access.js';

export {
  loadSessionIdentity,
  revokeSession,
  pickOrgForRole,
  type SessionIdentity,
} from './session.js';
