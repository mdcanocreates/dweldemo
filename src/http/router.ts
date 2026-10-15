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
  handleCompleteDemoScreening,
  type HttpHandlerDeps,
} from './handlers.js';
import {
  handleCheckrWebhookPost,
  handleCheckrStatus,
  handleDownloadCheckrReportPdf,
  handleGetCheckrScreening,
  handleInitiateCheckrScreening,
} from './checkr-handlers.js';
import {
  handleLandlordCreateListing,
  handleLandlordDecideApplicant,
  handleLandlordReviewMissingInfo,
  handleLandlordMissingInfoDocUrl,
  handleLandlordGetApplicantDetail,
  handleLandlordGetCriteria,
  handleLandlordGetSelfExecution,
  handleLandlordGetSettings,
  handleLandlordListActivity,
  handleLandlordListApplicants,
  handleLandlordListLeases,
  handleLandlordListListings,
  handleLandlordPutCriteria,
  handleLandlordSetListingStatus,
  handleLandlordSubmitSelfExecution,
  handleLandlordUpdateListing,
  handleLandlordUpdateSettings,
  handleLandlordUploadLease,
  handleLandlordUploadListingPhoto,
  handleLandlordConfirmListingFreshness,
  handleLandlordListBrokerInvitations,
  handleLandlordAcceptBrokerInvitation,
  handleLandlordMakeLeaseAvailable,
} from './portal-handlers.js';
import {
  handleBrokerAddNote,
  handleBrokerApplicationDetail,
  handleBrokerCancelInvitation,
  handleBrokerCreateInvitation,
  handleBrokerRevokeDelegation,
  handleBrokerLeads,
  handleBrokerListInvitations,
  handleBrokerOverview,
  handleBrokerPerformance,
  handleBrokerPortfolioApplicants,
  handleBrokerPortfolioListings,
  handleBrokerPortfolioOverview,
  handleBrokerProviderDetail,
  handleBrokerProviders,
  handleBrokerRequestScreening,
  handleBrokerSetRecommendation,
  handleBrokerSubmarkets,
} from './broker-handlers.js';
import {
  handleAttributionVisit,
  handleInternalPartnerMetrics,
} from './attribution-handlers.js';
import {
  handleAcceptBrokerTerms,
  handleGetBrokerTerms,
} from './broker-terms-handlers.js';
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
  handleGetScreeningCenter,
  handleListMyApplications,
  handleListSavedListings,
  handleAddSavedListing,
  handleRemoveSavedListing,
  handleListSupportCases,
  handleCreateSupportCase,
  handleMissingInfoResponse,
  handleMissingInfoUpload,
  handleMissingInfoDocUrl,
  handleListRenterCashback,
  handleListNotifications,
  handleMarkNotificationRead,
  handleReportListingIssue,
  handleNyPath2Purchase,
  handleNyScreeningChoiceStatus,
  handleNyUploadReport,
  handlePayAndConsent,
  handleScreeningEligibility,
  handleRequestAccountDeletion,
  handleGetAccountDeletionRequest,
  handleUpsertRenterIntake,
  handleUpsertRenterProfile,
  handleListRenterLeases,
  handleAcknowledgeRenterLease,
  handleRenterLeaseDownloadUrl,
} from './renter-handlers.js';import {
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
import { handleInternalPreviewAccess, handleInternalPreviewSetRole } from './preview-handlers.js';
import {
  handleInternalCaseAction,
  handleInternalDocumentUrl,
  handleInternalGetApplication,
  handleInternalGetApplicationIntake,
  handleInternalGetCase,
  handleInternalGetParty,
  handleInternalHealth,
  handleInternalListApplications,
  handleInternalListBrokers,
  handleInternalListCaseEvents,
  handleInternalListCases,
  handleInternalListListings,
  handleInternalListPartnerReviews,
  handleInternalListParties,
  handleInternalScreeningResult,
  handleInternalScreeningStatus,
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
    if (method === 'POST' && path === '/v1/attribution/visit') {
      await handleAttributionVisit(req, res, deps);
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
    {
      const m = path.match(/^\/internal\/v1\/partners\/([^/]+)\/metrics$/i);
      if (method === 'GET' && m) {
        await handleInternalPartnerMetrics(req, res, deps, decodeURIComponent(m[1]!));
        return true;
      }
    }
    if (method === 'GET' && path === '/internal/v1/brokers') {
      await handleInternalListBrokers(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/internal/v1/listings') {
      await handleInternalListListings(req, res, deps);
      return true;
    }

    // Control Center contract: cases / parties / screening-status / actions
    if (method === 'GET' && path === '/internal/v1/cases') {
      await handleInternalListCases(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/internal/v1/parties') {
      await handleInternalListParties(req, res, deps);
      return true;
    }
    const internalParty = path.match(
      /^\/internal\/v1\/parties\/([0-9a-f-]{36})$/i,
    );
    if (method === 'GET' && internalParty) {
      await handleInternalGetParty(req, res, deps, internalParty[1]!);
      return true;
    }
    const internalCaseAction = path.match(
      /^\/internal\/v1\/cases\/([^/]+)\/actions\/([a-z0-9_-]+)$/i,
    );
    if (method === 'POST' && internalCaseAction) {
      await handleInternalCaseAction(
        req,
        res,
        deps,
        decodeURIComponent(internalCaseAction[1]!),
        internalCaseAction[2]!,
      );
      return true;
    }
    const internalDocUrl = path.match(
      /^\/internal\/v1\/documents\/([0-9a-f-]{36})\/signed-url$/i,
    );
    if (method === 'POST' && internalDocUrl) {
      await handleInternalDocumentUrl(req, res, deps, internalDocUrl[1]!);
      return true;
    }
    const internalCaseEvents = path.match(
      /^\/internal\/v1\/cases\/([^/]+)\/events$/i,
    );
    if (method === 'GET' && internalCaseEvents) {
      await handleInternalListCaseEvents(
        req,
        res,
        deps,
        decodeURIComponent(internalCaseEvents[1]!),
      );
      return true;
    }
    const internalScreeningStatus = path.match(
      /^\/internal\/v1\/cases\/([^/]+)\/screening-status$/i,
    );
    if (method === 'GET' && internalScreeningStatus) {
      await handleInternalScreeningStatus(
        req,
        res,
        deps,
        decodeURIComponent(internalScreeningStatus[1]!),
      );
      return true;
    }
    const internalScreeningResult = path.match(
      /^\/internal\/v1\/cases\/([^/]+)\/screening-result$/i,
    );
    if (method === 'GET' && internalScreeningResult) {
      await handleInternalScreeningResult(
        req,
        res,
        deps,
        decodeURIComponent(internalScreeningResult[1]!),
      );
      return true;
    }
    const internalCase = path.match(/^\/internal\/v1\/cases\/([^/]+)$/i);
    if (method === 'GET' && internalCase) {
      await handleInternalGetCase(
        req,
        res,
        deps,
        decodeURIComponent(internalCase[1]!),
      );
      return true;
    }

    if (method === 'GET' && path === '/v1/internal/preview') {
      await handleInternalPreviewAccess(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/internal/preview') {
      await handleInternalPreviewSetRole(req, res, deps);
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
    if (method === 'POST' && path === '/v1/renter/account/deletion-request') {
      await handleRequestAccountDeletion(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/renter/account/deletion-request') {
      await handleGetAccountDeletionRequest(req, res, deps);
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
    if (method === 'GET' && path === '/v1/renter/saved') {
      await handleListSavedListings(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/renter/saved') {
      await handleAddSavedListing(req, res, deps);
      return true;
    }
    if (method === 'DELETE' && path === '/v1/renter/saved') {
      await handleRemoveSavedListing(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/renter/support-cases') {
      await handleListSupportCases(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/renter/support-cases') {
      await handleCreateSupportCase(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/renter/screening-center') {
      await handleGetScreeningCenter(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/renter/cashback') {
      await handleListRenterCashback(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/notifications') {
      await handleListNotifications(req, res, deps);
      return true;
    }
    {
      const m = path.match(/^\/v1\/notifications\/([0-9a-f-]{36})\/read$/i);
      if (method === 'POST' && m) {
        await handleMarkNotificationRead(req, res, deps, m[1]!);
        return true;
      }
    }
    {
      const m = path.match(/^\/v1\/listings\/([0-9a-f-]{36})\/report-issue$/i);
      if (method === 'POST' && m) {
        await handleReportListingIssue(req, res, deps, m[1]!);
        return true;
      }
    }
    {
      const m = path.match(
        /^\/v1\/renter\/applications\/([0-9a-f-]{36})\/missing-info-response$/i,
      );
      if (method === 'POST' && m) {
        await handleMissingInfoResponse(req, res, deps, m[1]!);
        return true;
      }
    }
    {
      const m = path.match(
        /^\/v1\/renter\/applications\/([0-9a-f-]{36})\/missing-info\/([0-9a-f-]{36})\/documents$/i,
      );
      if (method === 'POST' && m) {
        await handleMissingInfoUpload(req, res, deps, m[1]!, m[2]!);
        return true;
      }
    }
    {
      const m = path.match(
        /^\/v1\/renter\/applications\/([0-9a-f-]{36})\/missing-info\/documents\/([0-9a-f-]{36})\/url$/i,
      );
      if (method === 'POST' && m) {
        await handleMissingInfoDocUrl(req, res, deps, m[1]!, m[2]!);
        return true;
      }
    }
    {
      const m = path.match(/^\/v1\/renter\/applications\/([0-9a-f-]{36})\/leases$/i);
      if (method === 'GET' && m) {
        await handleListRenterLeases(req, res, deps, m[1]!);
        return true;
      }
    }
    {
      const m = path.match(
        /^\/v1\/renter\/applications\/([0-9a-f-]{36})\/leases\/([0-9a-f-]{36})\/acknowledge$/i,
      );
      if (method === 'POST' && m) {
        await handleAcknowledgeRenterLease(req, res, deps, m[1]!, m[2]!);
        return true;
      }
    }
    {
      const m = path.match(
        /^\/v1\/renter\/applications\/([0-9a-f-]{36})\/leases\/([0-9a-f-]{36})\/download-url$/i,
      );
      if (method === 'GET' && m) {
        await handleRenterLeaseDownloadUrl(req, res, deps, m[1]!, m[2]!);
        return true;
      }
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

    if (method === 'GET' && path === '/v1/landlord/activity') {
      await handleLandlordListActivity(req, res, deps);
      return true;
    }
    {
      const m = path.match(/^\/v1\/landlord\/applicants\/([0-9a-f-]{36})$/i);
      if (method === 'GET' && m) {
        const applicationId = m[1]!;
        if (!UUID_RE.test(applicationId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'validation_error', message: 'invalid application id' }));
          return true;
        }
        await handleLandlordGetApplicantDetail(req, res, deps, applicationId);
        return true;
      }
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
    const landlordFreshness = path.match(
      /^\/v1\/landlord\/listings\/([0-9a-f-]{36})\/confirm-freshness$/i,
    );
    if (method === 'POST' && landlordFreshness) {
      const listingId = landlordFreshness[1]!;
      if (!UUID_RE.test(listingId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validation_error', message: 'invalid listing id' }));
        return true;
      }
      await handleLandlordConfirmListingFreshness(req, res, deps, listingId);
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
    const landlordCriteria = path.match(
      /^\/v1\/landlord\/listings\/([0-9a-f-]{36})\/criteria$/i,
    );
    if (landlordCriteria) {
      const listingId = landlordCriteria[1]!;
      if (!UUID_RE.test(listingId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validation_error', message: 'invalid listing id' }));
        return true;
      }
      if (method === 'GET') {
        await handleLandlordGetCriteria(req, res, deps, listingId);
        return true;
      }
      if (method === 'PUT') {
        await handleLandlordPutCriteria(req, res, deps, listingId);
        return true;
      }
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
    const landlordMirReview = path.match(
      /^\/v1\/landlord\/listings\/([0-9a-f-]{36})\/applicants\/([0-9a-f-]{36})\/missing-info\/([0-9a-f-]{36})\/review$/i,
    );
    if (method === 'POST' && landlordMirReview) {
      await handleLandlordReviewMissingInfo(
        req,
        res,
        deps,
        landlordMirReview[1]!,
        landlordMirReview[2]!,
        landlordMirReview[3]!,
      );
      return true;
    }
    const landlordMirDoc = path.match(
      /^\/v1\/landlord\/applicants\/([0-9a-f-]{36})\/missing-info\/documents\/([0-9a-f-]{36})\/url$/i,
    );
    if (method === 'POST' && landlordMirDoc) {
      await handleLandlordMissingInfoDocUrl(
        req,
        res,
        deps,
        landlordMirDoc[1]!,
        landlordMirDoc[2]!,
      );
      return true;
    }
    const landlordLease = path.match(
      /^\/v1\/landlord\/listings\/([0-9a-f-]{36})\/applicants\/([0-9a-f-]{36})\/lease$/i,
    );
    if (landlordLease) {
      const listingId = landlordLease[1]!;
      const applicationId = landlordLease[2]!;
      if (!UUID_RE.test(listingId) || !UUID_RE.test(applicationId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validation_error', message: 'invalid id' }));
        return true;
      }
      if (method === 'POST') {
        await handleLandlordUploadLease(req, res, deps, listingId, applicationId);
        return true;
      }
      if (method === 'GET') {
        await handleLandlordListLeases(req, res, deps, listingId, applicationId);
        return true;
      }
    }
    const landlordListingLeases = path.match(
      /^\/v1\/landlord\/listings\/([0-9a-f-]{36})\/leases$/i,
    );
    if (method === 'GET' && landlordListingLeases) {
      const listingId = landlordListingLeases[1]!;
      if (!UUID_RE.test(listingId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validation_error', message: 'invalid listing id' }));
        return true;
      }
      await handleLandlordListLeases(req, res, deps, listingId);
      return true;
    }
    {
      const m = path.match(
        /^\/v1\/landlord\/listings\/([0-9a-f-]{36})\/applicants\/([0-9a-f-]{36})\/leases\/([0-9a-f-]{36})\/make-available$/i,
      );
      if (method === 'POST' && m) {
        await handleLandlordMakeLeaseAvailable(req, res, deps, m[1]!, m[2]!, m[3]!);
        return true;
      }
    }
    if (method === 'GET' && path === '/v1/landlord/broker-invitations') {
      await handleLandlordListBrokerInvitations(req, res, deps);
      return true;
    }
    {
      const m = path.match(
        /^\/v1\/landlord\/broker-invitations\/([0-9a-f-]{36})\/accept$/i,
      );
      if (method === 'POST' && m) {
        await handleLandlordAcceptBrokerInvitation(req, res, deps, m[1]!);
        return true;
      }
    }

    if (method === 'GET' && path === '/v1/broker/invitations') {
      await handleBrokerListInvitations(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/broker/invitations') {
      await handleBrokerCreateInvitation(req, res, deps);
      return true;
    }
    {
      const m = path.match(/^\/v1\/broker\/invitations\/([0-9a-f-]{36})\/cancel$/i);
      if (method === 'POST' && m) {
        await handleBrokerCancelInvitation(req, res, deps, m[1]!);
        return true;
      }
    }
    {
      const m = path.match(
        /^\/v1\/broker\/delegations\/([0-9a-f-]{36})\/revoke$/i,
      );
      if (method === 'POST' && m) {
        await handleBrokerRevokeDelegation(req, res, deps, m[1]!);
        return true;
      }
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
    if (method === 'GET' && path === '/v1/broker/portfolio') {
      await handleBrokerPortfolioOverview(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/broker/providers') {
      await handleBrokerProviders(req, res, deps);
      return true;
    }
    {
      const m = path.match(/^\/v1\/broker\/providers\/([^/]+)$/);
      if (method === 'GET' && m) {
        await handleBrokerProviderDetail(req, res, deps, decodeURIComponent(m[1]!));
        return true;
      }
    }
    if (method === 'GET' && path === '/v1/broker/portfolio/listings') {
      await handleBrokerPortfolioListings(req, res, deps);
      return true;
    }
    if (method === 'GET' && path === '/v1/broker/portfolio/applicants') {
      await handleBrokerPortfolioApplicants(req, res, deps);
      return true;
    }
    {
      const m = path.match(
        /^\/v1\/broker\/applications\/([0-9a-f-]{36})$/i,
      );
      if (method === 'GET' && m) {
        await handleBrokerApplicationDetail(req, res, deps, m[1]!);
        return true;
      }
    }
    {
      const m = path.match(
        /^\/v1\/broker\/applications\/([0-9a-f-]{36})\/request-screening$/i,
      );
      if (method === 'POST' && m) {
        await handleBrokerRequestScreening(req, res, deps, m[1]!);
        return true;
      }
    }
    {
      const m = path.match(
        /^\/v1\/broker\/applications\/([0-9a-f-]{36})\/notes$/i,
      );
      if (method === 'POST' && m) {
        await handleBrokerAddNote(req, res, deps, m[1]!);
        return true;
      }
    }
    {
      const m = path.match(
        /^\/v1\/broker\/applications\/([0-9a-f-]{36})\/recommendation$/i,
      );
      if (method === 'POST' && m) {
        await handleBrokerSetRecommendation(req, res, deps, m[1]!);
        return true;
      }
    }
    if (method === 'GET' && path === '/v1/broker/terms') {
      await handleGetBrokerTerms(req, res, deps);
      return true;
    }
    if (method === 'POST' && path === '/v1/broker/terms') {
      await handleAcceptBrokerTerms(req, res, deps);
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
      /^\/v1\/applications\/([0-9a-f-]{36})(?:\/(consent|submit-screening|pay-consent|complete-demo-screening|screening-eligibility))?$/i,
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
      if (method === 'GET' && action === 'screening-eligibility') {
        await handleScreeningEligibility(req, res, deps, applicationId);
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
      if (method === 'POST' && action === 'complete-demo-screening') {
        await handleCompleteDemoScreening(req, res, deps, applicationId);
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

    if (method === 'POST' && path === '/v1/webhooks/checkr') {
      await handleCheckrWebhookPost(req, res, deps);
      return true;
    }

    if (method === 'GET' && path === '/v1/admin/integrations/checkr') {
      await handleCheckrStatus(req, res);
      return true;
    }

    const checkrAppMatch = path.match(
      /^\/v1\/applications\/([0-9a-f-]{36})\/checkr-screening(?:\/(initiate|pdf))?$/i,
    );
    if (checkrAppMatch) {
      const applicationId = checkrAppMatch[1]!;
      const action = checkrAppMatch[2];
      if (!UUID_RE.test(applicationId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validation_error', message: 'invalid application id' }));
        return true;
      }
      if (method === 'GET' && !action) {
        await handleGetCheckrScreening(req, res, deps, applicationId);
        return true;
      }
      if (method === 'POST' && action === 'initiate') {
        await handleInitiateCheckrScreening(req, res, deps, applicationId);
        return true;
      }
      if (method === 'GET' && action === 'pdf') {
        await handleDownloadCheckrReportPdf(req, res, deps, applicationId);
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
