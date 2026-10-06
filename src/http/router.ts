import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  handleAuthLogout,
  handleAuthMagicLink,
  handleAuthMe,
  handleAuthRedeem,
} from './auth-handlers.js';
import {
  ensureWebhookWorker,
  handleCertnWebhookGet,
  handleCertnWebhookPost,
  handleCreateApplication,
  handleGetApplication,
  handleGetListing,
  handleListListings,
  handleRecordConsent,
  handleSubmitScreening,
  type HttpHandlerDeps,
} from './handlers.js';
import {
  handleLandlordCreateListing,
  handleLandlordDecideApplicant,
  handleLandlordGetSelfExecution,
  handleLandlordGetSettings,
  handleLandlordListApplicants,
  handleLandlordListListings,
  handleLandlordSetListingStatus,
  handleLandlordSubmitSelfExecution,
  handleLandlordUpdateListing,
  handleLandlordUpdateSettings,
  handleLandlordUploadListingPhoto,
} from './portal-handlers.js';
import {
  handleBrokerLeads,
  handleBrokerOverview,
  handleBrokerPerformance,
  handleBrokerSubmarkets,
} from './broker-handlers.js';
import {
  handleConnectCreateAccount,
  handleConnectDashboardLink,
  handleConnectGetAccount,
  handleConnectOnboardingLink,
} from './connect-handlers.js';
import {
  handleCreateInterestApplication,
  handleGetConsentCopy,
  handleGetRenterIntake,
  handleGetApplicationIntakeDetail,
  handleGetRenterProfile,
  handleGetScreeningFee,
  handleListMyApplications,
  handleNyPath2Purchase,
  handleNyScreeningChoiceStatus,
  handleNyUploadReport,
  handlePayAndConsent,
  handleUpsertRenterIntake,
  handleUpsertRenterProfile,
} from './renter-handlers.js';
import {
  handleAdminAssignRole,
  handleAdminAudit,
  handleAdminCertnStatus,
  handleAdminDecideSelfExecution,
  handleAdminGetConsent,
  handleAdminListFlags,
  handleAdminListOrgs,
  handleAdminListSelfExecution,
  handleAdminListUsers,
  handleAdminOrgFlags,
  handleAdminPutConsent,
  handleAdminSetFlag,
} from './admin-handlers.js';
import {
  handleInternalGetApplication,
  handleInternalGetApplicationIntake,
  handleInternalHealth,
  handleInternalListApplications,
  handleInternalListPartnerReviews,
} from './internal-handlers.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createApiRouter(deps: HttpHandlerDeps) {
  ensureWebhookWorker(deps.pool);

  return async function route(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const path = req.url?.split('?')[0] ?? '';
    const method = req.method ?? 'GET';

    if (method === 'POST' && path === '/v1/auth/magic-link') {
      await handleAuthMagicLink(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/auth/redeem') {
      await handleAuthRedeem(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/auth/me') {
      await handleAuthMe(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/auth/logout') {
      await handleAuthLogout(req, res, deps);
      return true;
    }

    // Control Center staff APIs (service token) — not customer session auth
    if (method === 'GET' && path === '/internal/v1/health') {
      await handleInternalHealth(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/internal/v1/applications') {
      await handleInternalListApplications(req, res, deps);
      return true;
    }
    const internalAppIntake = path.match(
      /^\/internal\/v1\/applications\/([0-9a-f-]{36})\/intake$/i,
    );
    if (method === 'GET' && internalAppIntake) {
      await handleInternalGetApplicationIntake(req, res, deps, internalAppIntake[1]!);
      return true;
    }
    const internalApp = path.match(/^\/internal\/v1\/applications\/([0-9a-f-]{36})$/i);
    if (method === 'GET' && internalApp) {
      await handleInternalGetApplication(req, res, deps, internalApp[1]!);
      return true;
    }
    if (method === 'GET' && path === '/internal/v1/partner-reviews') {
      await handleInternalListPartnerReviews(req, res, deps);
      return true;
    }

    if (method === 'GET' && path === '/v1/renter/profile') {
      await handleGetRenterProfile(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/renter/profile') {
      await handleUpsertRenterProfile(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/renter/intake') {
      await handleGetRenterIntake(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/renter/intake') {
      await handleUpsertRenterIntake(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/renter/applications') {
      await handleListMyApplications(req, res, deps);
      return true;
    }
    const appDetail = path.match(/^\/v1\/renter\/applications\/([0-9a-f-]{36})\/details$/i);
    if (method === 'GET' && appDetail) {
      await handleGetApplicationIntakeDetail(req, res, deps, appDetail[1]!);
      return true;
    }
    if (method === 'POST' && path === '/v1/renter/interest') {
      await handleCreateInterestApplication(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/renter/screening-choice') {
      await handleNyScreeningChoiceStatus(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/renter/screening-reports') {
      await handleNyUploadReport(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/renter/screening-path2') {
      await handleNyPath2Purchase(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/config/screening-fee') {
      await handleGetScreeningFee(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/config/consent-copy') {
      await handleGetConsentCopy(req, res, deps);
      return true;
    }

    if (method === 'GET' && path === '/v1/landlord/settings') {
      await handleLandlordGetSettings(req, res, deps);
      return true;
    }
    if (method === 'PUT' && path === '/v1/landlord/settings') {
      await handleLandlordUpdateSettings(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/landlord/settings/self-execution') {
      await handleLandlordGetSelfExecution(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/landlord/settings/self-execution') {
      await handleLandlordSubmitSelfExecution(req, res, deps);
      return true;
    }

    if (method === 'GET' && path === '/v1/landlord/listings') {
      await handleLandlordListListings(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/landlord/listings') {
      await handleLandlordCreateListing(req, res, deps);
      return true;
    }
    const landlordListingPut = path.match(/^\/v1\/landlord\/listings\/([0-9a-f-]{36})$/i);
    if (method === 'PUT' && landlordListingPut) {
      const listingId = landlordListingPut[1]!;
      if (!UUID_RE.test(listingId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validation_error', message: 'invalid listing id' }));
        return true;
      }
      await handleLandlordUpdateListing(req, res, deps, listingId);
      return true;
    }
    const landlordStatus = path.match(
      /^\/v1\/landlord\/listings\/([0-9a-f-]{36})\/status$/i,
    );
    if (method === 'POST' && landlordStatus) {
      const listingId = landlordStatus[1]!;
      if (!UUID_RE.test(listingId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validation_error', message: 'invalid listing id' }));
        return true;
      }
      await handleLandlordSetListingStatus(req, res, deps, listingId);
      return true;
    }
    const landlordPhoto = path.match(
      /^\/v1\/landlord\/listings\/([0-9a-f-]{36})\/photos$/i,
    );
    if (method === 'POST' && landlordPhoto) {
      const listingId = landlordPhoto[1]!;
      if (!UUID_RE.test(listingId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validation_error', message: 'invalid listing id' }));
        return true;
      }
      await handleLandlordUploadListingPhoto(req, res, deps, listingId);
      return true;
    }
    const landlordApplicants = path.match(
      /^\/v1\/landlord\/listings\/([0-9a-f-]{36})\/applicants$/i,
    );
    if (method === 'GET' && landlordApplicants) {
      const listingId = landlordApplicants[1]!;
      if (!UUID_RE.test(listingId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validation_error', message: 'invalid listing id' }));
        return true;
      }
      await handleLandlordListApplicants(req, res, deps, listingId);
      return true;
    }
    const landlordDecide = path.match(
      /^\/v1\/landlord\/listings\/([0-9a-f-]{36})\/applicants\/([0-9a-f-]{36})\/decision$/i,
    );
    if (method === 'POST' && landlordDecide) {
      const listingId = landlordDecide[1]!;
      const applicationId = landlordDecide[2]!;
      if (!UUID_RE.test(listingId) || !UUID_RE.test(applicationId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validation_error', message: 'invalid id' }));
        return true;
      }
      await handleLandlordDecideApplicant(req, res, deps, listingId, applicationId);
      return true;
    }

    if (method === 'GET' && path === '/v1/broker/overview') {
      await handleBrokerOverview(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/broker/performance') {
      await handleBrokerPerformance(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/broker/leads') {
      await handleBrokerLeads(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/broker/submarkets') {
      await handleBrokerSubmarkets(req, res, deps);
      return true;
    }

    if (method === 'GET' && path === '/v1/stripe/connect/account') {
      await handleConnectGetAccount(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/stripe/connect/account') {
      await handleConnectCreateAccount(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/stripe/connect/onboarding-link') {
      await handleConnectOnboardingLink(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/stripe/connect/dashboard-link') {
      await handleConnectDashboardLink(req, res, deps);
      return true;
    }

    if (method === 'GET' && path === '/v1/listings') {
      await handleListListings(req, res, deps);
      return true;
    }

    if (method === 'GET' && path.startsWith('/v1/listings/')) {
      const listingId = path.slice('/v1/listings/'.length);
      if (!UUID_RE.test(listingId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validation_error', message: 'invalid listing id' }));
        return true;
      }
      await handleGetListing(req, res, deps, listingId);
      return true;
    }

    if (method === 'POST' && path === '/v1/applications') {
      await handleCreateApplication(req, res, deps);
      return true;
    }

    const appMatch = path.match(
      /^\/v1\/applications\/([0-9a-f-]{36})(?:\/(consent|submit-screening|pay-consent))?$/i,
    );
    if (appMatch) {
      const applicationId = appMatch[1]!;
      const action = appMatch[2];
      if (!UUID_RE.test(applicationId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validation_error', message: 'invalid application id' }));
        return true;
      }
      if (method === 'GET' && !action) {
        await handleGetApplication(req, res, deps, applicationId);
        return true;
      }
      if (method === 'POST' && action === 'consent') {
        await handleRecordConsent(req, res, deps, applicationId);
        return true;
      }
      if (method === 'POST' && action === 'pay-consent') {
        await handlePayAndConsent(req, res, deps, applicationId);
        return true;
      }
      if (method === 'POST' && action === 'submit-screening') {
        await handleSubmitScreening(req, res, deps, applicationId);
        return true;
      }
    }

    if (path === '/v1/webhooks/certn') {
      if (method === 'GET') {
        await handleCertnWebhookGet(req, res);
        return true;
      }
      if (method === 'POST') {
        await handleCertnWebhookPost(req, res, deps);
        return true;
      }
    }

    if (method === 'GET' && path === '/v1/admin/users') {
      await handleAdminListUsers(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/admin/users/roles') {
      await handleAdminAssignRole(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/admin/orgs') {
      await handleAdminListOrgs(req, res, deps);
      return true;
    }
    const adminOrgFlags = path.match(/^\/v1\/admin\/orgs\/([0-9a-f-]{36})\/flags$/i);
    if (method === 'PUT' && adminOrgFlags) {
      await handleAdminOrgFlags(req, res, deps, adminOrgFlags[1]!);
      return true;
    }
    if (method === 'GET' && path === '/v1/admin/config/consent') {
      await handleAdminGetConsent(req, res, deps);
      return true;
    }
    if (method === 'PUT' && path === '/v1/admin/config/consent') {
      await handleAdminPutConsent(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/admin/integrations/certn') {
      await handleAdminCertnStatus(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/admin/reviews/self-execution') {
      await handleAdminListSelfExecution(req, res, deps);
      return true;
    }
    const adminSeDecide = path.match(
      /^\/v1\/admin\/reviews\/self-execution\/([0-9a-f-]{36})\/decision$/i,
    );
    if (method === 'POST' && adminSeDecide) {
      await handleAdminDecideSelfExecution(req, res, deps, adminSeDecide[1]!);
      return true;
    }
    if (method === 'GET' && path === '/v1/admin/config/flags') {
      await handleAdminListFlags(req, res, deps);
      return true;
    }
    const adminFlag = path.match(/^\/v1\/admin\/config\/flags\/([a-z0-9_]+)$/i);
    if (method === 'PUT' && adminFlag) {
      await handleAdminSetFlag(req, res, deps, adminFlag[1]!);
      return true;
    }
    if (method === 'GET' && path === '/v1/admin/audit') {
      await handleAdminAudit(req, res, deps);
      return true;
    }

    return false;
  };
}
