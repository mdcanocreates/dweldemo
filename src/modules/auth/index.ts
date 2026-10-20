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

export { issueEmailCode, verifyEmailCode } from './email-code.js';

export {
  loadSessionIdentity,
  revokeSession,
  pickOrgForRole,
  insertUserSession,
  type SessionIdentity,
} from './session.js';
