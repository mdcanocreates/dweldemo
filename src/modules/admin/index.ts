export {
  AdminQueryInterceptor,
  wrapAdminClient,
  getAdminDashboard,
  adminLookupById,
  type QueryLogEntry,
  type AdminDashboardSnapshot,
} from './console.js';

export {
  assertAdmin,
  assertSuperAdmin,
  assignUserRole,
  decideSelfExecutionReview,
  getCertnAdminStatus,
  getConsentConfig,
  listAdminOrgs,
  listAdminUsers,
  listAuditEvents,
  listPlatformFlags,
  listSelfExecutionReviews,
  setOrgBrokerPayoutsFlag,
  setPlatformFlag,
  updateConsentConfig,
} from './ops.js';
