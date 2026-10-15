import { Redirect, Route, Switch } from 'wouter';
import { RequireAuth } from './components/auth/RequireAuth';
import { LoginPage, AuthCallbackPage } from './pages/auth/LoginPage';
import { MFAEnrollPage } from './pages/auth/MFAEnrollPage';
import { MFAVerifyPage } from './pages/auth/MFAVerifyPage';
import { GuidedDiscoveryPage } from './pages/onboarding/GuidedDiscoveryPage';
import { RoleSelectionPage } from './pages/onboarding/RoleSelectionPage';
import { RenterPrequalPage } from './pages/onboarding/RenterPrequalPage';
import {
  LandlordSetupPage,
  LandlordVerificationPage,
} from './pages/onboarding/LandlordSetupPage';
import {
  BrokerVerifyPage,
  BrokerPendingPage,
} from './pages/broker/BrokerPages';
import {
  BrokerDashboardPage,
  BrokerListingsPage,
  BrokerApplicantsPage,
  BrokerProvidersPage,
  BrokerProviderDetailPage,
  BrokerScreeningsPage,
} from './pages/broker/BrokerDashboard';
import { BrokerInvitationsPage } from './pages/broker/BrokerInvitationsPage';
import { HomePage } from './pages/renter/HomePage';
import { RenterHomePage } from './pages/renter/RenterHomePage';
import { SearchPage } from './pages/renter/SearchPage';
import { ListingDetailPage } from './pages/renter/ListingDetailPage';
import { SavedPage } from './pages/renter/SavedPage';
import { ApplicationsPage } from './pages/renter/ApplicationsPage';
import { ApplicationDetailPage } from './pages/renter/ApplicationDetailPage';
import { RenterProfilePage } from './pages/renter/ProfilePage';
import { RenterSettingsPage } from './pages/renter/RenterSettingsPage';
import {
  ApplicationScreeningPage,
  NyScreeningOptionsPage,
} from './pages/renter/ScreeningPage';
import {
  LandlordDashboardPage,
  LandlordApplicantsQueuePage,
  LandlordBillingSummary,
} from './pages/landlord/DashboardPage';
import { LandlordSettingsPage } from './pages/landlord/LandlordSettingsPage';
import { LandlordListingsPage } from './pages/landlord/ListingsPage';
import { LandlordListingDetailPage } from './pages/landlord/ListingDetailPage';
import { LandlordScreeningsPage } from './pages/landlord/ScreeningsPage';
import { PartnerPage } from './pages/partner/PartnerPage';
import { AdminDashboardPage } from './pages/admin/DashboardPage';
import {
  AdminCreditsPage,
  AdminFlagsPage,
  AdminLandlordsPage,
  AdminMatchReasonsPage,
  AdminRsTiersPage,
  AdminStateRulesPage,
} from './pages/admin/AdminPages';
import { AdminScreeningProvidersPage } from './pages/admin/ScreeningProvidersPage';
import {
  InternalPreviewPage,
  InternalPreviewSwitcherPage,
} from './pages/internal/InternalPreviewPage';
import { UiPreviewPage } from './pages/internal/UiPreviewPage';
import { DemoBrokerPage } from './pages/demo/DemoBrokerPage';
import { DemoHomeProviderPage } from './pages/demo/DemoHomeProviderPage';
import { DemoRenterPage } from './pages/demo/DemoRenterPage';
import {
  AboutPage,
  CashbackTermsPage,
  ContactPage,
  PrivacyPage,
  TermsPage,
} from './pages/LegalPages';
import { RenterShell } from './components/layout/RenterShell';
import { Card } from './components/ui/Card';
import { LandlordListingFormPage } from './pages/landlord/ListingFormPage';
import { LandlordActivityPage } from './pages/landlord/ActivityPage';
import { LandlordApplicantDetailPage } from './pages/landlord/ApplicantDetailPage';
import { LandlordLeasesPage } from './pages/landlord/LeasesPage';
import { BrokerListingDetailPage } from './pages/broker/BrokerListingDetailPage';
import { BrokerApplicantDetailPage } from './pages/broker/BrokerApplicantDetailPage';
import { BrokerSettingsPage } from './pages/broker/BrokerSettingsPage';
import { ScreeningCenterPage } from './pages/renter/ScreeningCenterPage';
import { SupportPage } from './pages/renter/SupportPage';
import { NotificationsPage } from './pages/renter/NotificationsPage';

function FeesPage() {
  return (
    <RenterShell workspace={false}>
      <Card className="p-6">
        <h1 className="text-2xl font-semibold">Fees and screening</h1>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-dwel-gray-600">
          <li>Browsing and expressing interest are free for renters.</li>
          <li>
            Renters only pay a screening fee when a Home Provider moves forward and a new report is
            required ($30). Eligible recent reports can be shared without a second charge when
            permitted.
          </li>
          <li>Home Provider listing fees follow the published billing model where enabled.</li>
          <li>
            Displayed cashback rates are offer/status architecture only — funding source, cap, and
            payout timing are business decisions and are not activated as paid entitlements here.
          </li>
          <li>No Stripe Connect rent routing or placement-fee extraction in the current product.</li>
        </ul>
      </Card>
    </RenterShell>
  );
}

export default function App() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/home">
        <RequireAuth roles={['APPLICANT']}>
          <RenterHomePage />
        </RequireAuth>
      </Route>
      <Route path="/partner" component={PartnerPage} />
      <Route path="/partner/landlord">
        <Redirect to="/dashboard" />
      </Route>
      <Route path="/partner/broker">
        <Redirect to="/broker/dashboard" />
      </Route>
      <Route path="/for-landlords">
        <Redirect to="/partner" />
      </Route>
      <Route path="/for-brokers">
        <Redirect to="/partner" />
      </Route>
      <Route path="/brokers">
        <Redirect to="/partner" />
      </Route>
      <Route path="/fees" component={FeesPage} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/contact" component={ContactPage} />
      <Route path="/cashback-terms" component={CashbackTermsPage} />
      <Route path="/search" component={SearchPage} />
      <Route path="/listing/:id" component={ListingDetailPage} />
      <Route path="/saved" component={SavedPage} />

      <Route path="/auth/login" component={LoginPage} />
      <Route path="/auth/callback" component={AuthCallbackPage} />
      <Route path="/sign-in">
        <Redirect to="/auth/login" />
      </Route>
      <Route path="/auth/mfa/enroll" component={MFAEnrollPage} />
      <Route path="/auth/mfa/verify" component={MFAVerifyPage} />

      <Route path="/internal/preview/:role" component={InternalPreviewPage} />
      <Route path="/internal/preview" component={InternalPreviewSwitcherPage} />
      <Route path="/internal/ui-preview" component={UiPreviewPage} />
      <Route path="/demo/broker" component={DemoBrokerPage} />
      <Route path="/demo/home-provider" component={DemoHomeProviderPage} />
      <Route path="/demo/renter" component={DemoRenterPage} />
      <Route path="/demo">
        <Redirect to="/demo/renter" />
      </Route>

      <Route path="/discover" component={GuidedDiscoveryPage} />
      <Route path="/onboarding/role" component={RoleSelectionPage} />
      <Route path="/onboarding/renter/profile" component={RenterPrequalPage} />
      <Route path="/onboarding">
        <Redirect to="/discover" />
      </Route>
      <Route path="/onboarding/landlord/setup" component={LandlordSetupPage} />
      <Route path="/onboarding/broker/verify" component={BrokerVerifyPage} />
      <Route path="/onboarding/broker/pending" component={BrokerPendingPage} />
      <Route path="/settings/verification" component={LandlordVerificationPage} />

      <Route path="/applications/:id/screening/ny">
        <RequireAuth roles={['APPLICANT']}>
          <NyScreeningOptionsPage />
        </RequireAuth>
      </Route>
      <Route path="/applications/:id/screening">
        <RequireAuth roles={['APPLICANT']}>
          <ApplicationScreeningPage />
        </RequireAuth>
      </Route>
      <Route path="/applications/:id">
        <RequireAuth roles={['APPLICANT']}>
          <ApplicationDetailPage />
        </RequireAuth>
      </Route>
      <Route path="/applications">
        <RequireAuth roles={['APPLICANT']}>
          <ApplicationsPage />
        </RequireAuth>
      </Route>
      <Route path="/screening">
        <RequireAuth roles={['APPLICANT']}>
          <ScreeningCenterPage />
        </RequireAuth>
      </Route>
      <Route path="/support">
        <RequireAuth roles={['APPLICANT']}>
          <SupportPage />
        </RequireAuth>
      </Route>
      <Route path="/notifications">
        <RequireAuth roles={['APPLICANT', 'LANDLORD', 'BROKER']}>
          <NotificationsPage />
        </RequireAuth>
      </Route>
      <Route path="/profile">
        <RequireAuth roles={['APPLICANT']}>
          <RenterProfilePage />
        </RequireAuth>
      </Route>
      <Route path="/renter/settings">
        <RequireAuth roles={['APPLICANT']}>
          <RenterSettingsPage />
        </RequireAuth>
      </Route>

      <Route path="/dashboard">
        <RequireAuth roles={['LANDLORD']}>
          <LandlordDashboardPage />
        </RequireAuth>
      </Route>
      <Route path="/listings/applicants">
        <RequireAuth roles={['LANDLORD']}>
          <LandlordApplicantsQueuePage />
        </RequireAuth>
      </Route>
      <Route path="/listings/new">
        <RequireAuth roles={['LANDLORD']}>
          <LandlordListingFormPage mode="create" />
        </RequireAuth>
      </Route>
      <Route path="/listings">
        <RequireAuth roles={['LANDLORD']}>
          <LandlordListingsPage />
        </RequireAuth>
      </Route>
      <Route path="/landlord/listings/:id/edit">
        <RequireAuth roles={['LANDLORD']}>
          <LandlordListingFormPage mode="edit" />
        </RequireAuth>
      </Route>
      <Route path="/landlord/listings/:id">
        <RequireAuth roles={['LANDLORD']}>
          <LandlordListingDetailPage />
        </RequireAuth>
      </Route>
      <Route path="/landlord/applicants/:applicationId">
        <RequireAuth roles={['LANDLORD']}>
          <LandlordApplicantDetailPage />
        </RequireAuth>
      </Route>
      <Route path="/landlord/screenings">
        <RequireAuth roles={['LANDLORD']}>
          <LandlordScreeningsPage />
        </RequireAuth>
      </Route>
      <Route path="/settings">
        <RequireAuth roles={['LANDLORD']}>
          <LandlordSettingsPage />
        </RequireAuth>
      </Route>
      <Route path="/landlord/billing">
        <RequireAuth roles={['LANDLORD']}>
          <LandlordBillingSummary />
        </RequireAuth>
      </Route>
      <Route path="/landlord/activity">
        <RequireAuth roles={['LANDLORD']}>
          <LandlordActivityPage />
        </RequireAuth>
      </Route>
      <Route path="/landlord/leases">
        <RequireAuth roles={['LANDLORD']}>
          <LandlordLeasesPage />
        </RequireAuth>
      </Route>
      <Route path="/landlord">
        <Redirect to="/dashboard" />
      </Route>

      <Route path="/broker/dashboard">
        <RequireAuth roles={['BROKER']}>
          <BrokerDashboardPage />
        </RequireAuth>
      </Route>
      <Route path="/broker/providers/:id">
        <RequireAuth roles={['BROKER']}>
          <BrokerProviderDetailPage />
        </RequireAuth>
      </Route>
      <Route path="/broker/providers">
        <RequireAuth roles={['BROKER']}>
          <BrokerProvidersPage />
        </RequireAuth>
      </Route>
      <Route path="/broker/invitations">
        <RequireAuth roles={['BROKER']}>
          <BrokerInvitationsPage />
        </RequireAuth>
      </Route>
      <Route path="/broker/invite">
        <Redirect to="/broker/invitations" />
      </Route>
      <Route path="/broker/listings/:id">
        <RequireAuth roles={['BROKER']}>
          <BrokerListingDetailPage />
        </RequireAuth>
      </Route>
      <Route path="/broker/listings">
        <RequireAuth roles={['BROKER']}>
          <BrokerListingsPage />
        </RequireAuth>
      </Route>
      <Route path="/broker/applicants/:applicationId">
        <RequireAuth roles={['BROKER']}>
          <BrokerApplicantDetailPage />
        </RequireAuth>
      </Route>
      <Route path="/broker/applicants">
        <RequireAuth roles={['BROKER']}>
          <BrokerApplicantsPage />
        </RequireAuth>
      </Route>
      <Route path="/broker/screenings">
        <RequireAuth roles={['BROKER']}>
          <BrokerScreeningsPage />
        </RequireAuth>
      </Route>
      <Route path="/broker/settings">
        <RequireAuth roles={['BROKER']}>
          <BrokerSettingsPage />
        </RequireAuth>
      </Route>

      <Route path="/admin">
        <RequireAuth roles={['ADMIN']}>
          <AdminDashboardPage />
        </RequireAuth>
      </Route>
      <Route path="/admin/rs-tiers">
        <RequireAuth roles={['ADMIN']}>
          <AdminRsTiersPage />
        </RequireAuth>
      </Route>
      <Route path="/admin/landlords">
        <RequireAuth roles={['ADMIN']}>
          <AdminLandlordsPage />
        </RequireAuth>
      </Route>
      <Route path="/admin/state-rules">
        <RequireAuth roles={['ADMIN']}>
          <AdminStateRulesPage />
        </RequireAuth>
      </Route>
      <Route path="/admin/credits">
        <RequireAuth roles={['ADMIN']}>
          <AdminCreditsPage />
        </RequireAuth>
      </Route>
      <Route path="/admin/flags">
        <RequireAuth roles={['ADMIN']}>
          <AdminFlagsPage />
        </RequireAuth>
      </Route>
      <Route path="/admin/screening">
        <RequireAuth roles={['ADMIN']}>
          <AdminScreeningProvidersPage />
        </RequireAuth>
      </Route>
      <Route path="/admin/match-reasons">
        <RequireAuth roles={['ADMIN']}>
          <AdminMatchReasonsPage />
        </RequireAuth>
      </Route>

      <Route>
        <Redirect to="/" />
      </Route>
    </Switch>
  );
}
