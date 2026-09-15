import { Navigate, Route, Routes } from 'react-router-dom';
import { ApplicationPage } from './pages/ApplicationPage';
import { ApplicationDetailsPage } from './pages/ApplicationDetailsPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { ApplyPage } from './pages/ApplyPage';
import {
  AdminAuditPage,
  AdminCertnPage,
  AdminConsentPage,
  AdminFlagsPage,
  AdminGuard,
  AdminIndexRedirect,
  AdminOrgsPage,
  AdminSelfExecutionPage,
  AdminUsersPage,
} from './pages/AdminPortal';
import {
  BrokerDashboardPage,
  BrokerGuard,
  BrokerLeadsPage,
  BrokerListingsPage,
  BrokerOverviewPage,
  BrokerPaymentsPage,
} from './pages/BrokerPortal';
import { CalculatorPage } from './pages/CalculatorPage';
import { ConsentPage } from './pages/ConsentPage';
import { HomePage } from './pages/HomePage';
import {
  LandlordApplicantsPage,
  LandlordEditListingPage,
  LandlordGuard,
  LandlordListingsPage,
  LandlordNewListingPage,
  LandlordOverviewPage,
  LandlordPaymentsPage,
  LandlordSelfExecutionPage,
  LandlordSettingsPage,
} from './pages/LandlordPortal';
import { ListingDetailPage } from './pages/ListingDetailPage';
import { ListingsPage } from './pages/ListingsPage';
import { BrokersMarketingPage, LandlordsMarketingPage } from './pages/MarketingPages';
import { OnboardPage, ScreeningChoicePage } from './pages/OnboardPage';
import { SignInPage } from './pages/SignInPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/onboard" element={<OnboardPage />} />
      <Route path="/screening-choice" element={<ScreeningChoicePage />} />
      <Route path="/listings" element={<ListingsPage />} />
      <Route path="/listings/:id" element={<ListingDetailPage />} />
      <Route path="/apply/:listingId" element={<ApplyPage />} />
      <Route path="/applications/new/:listingId" element={<ApplyPage />} />
      <Route path="/applications" element={<ApplicationsPage />} />
      <Route path="/applications/:id/details" element={<ApplicationDetailsPage />} />
      <Route path="/applications/:id/consent" element={<ConsentPage />} />
      <Route path="/applications/:id" element={<ApplicationPage />} />
      <Route path="/landlords" element={<LandlordsMarketingPage />} />
      <Route path="/brokers" element={<BrokersMarketingPage />} />
      <Route path="/calculator" element={<CalculatorPage />} />
      <Route path="/sign-in" element={<SignInPage />} />

      <Route path="/landlord" element={<LandlordGuard />}>
        <Route index element={<LandlordOverviewPage />} />
        <Route path="listings" element={<LandlordListingsPage />} />
        <Route path="listings/new" element={<LandlordNewListingPage />} />
        <Route path="listings/:id/edit" element={<LandlordEditListingPage />} />
        <Route path="listings/:id/applicants" element={<LandlordApplicantsPage />} />
        <Route path="settings" element={<LandlordSettingsPage />} />
        <Route path="settings/self-execution" element={<LandlordSelfExecutionPage />} />
        <Route path="settings/payments" element={<LandlordPaymentsPage />} />
        <Route path="applications" element={<Navigate to="/landlord/listings" replace />} />
        <Route path="portfolio" element={<Navigate to="/landlord/listings" replace />} />
        <Route path="calculator" element={<Navigate to="/calculator" replace />} />
      </Route>

      <Route path="/broker" element={<BrokerGuard />}>
        <Route index element={<BrokerOverviewPage />} />
        <Route path="dashboard" element={<BrokerDashboardPage />} />
        <Route path="leads" element={<BrokerLeadsPage />} />
        <Route path="settings/payments" element={<BrokerPaymentsPage />} />
        <Route path="listings" element={<BrokerListingsPage />} />
        <Route path="clients" element={<Navigate to="/broker/dashboard" replace />} />
        <Route path="activity" element={<Navigate to="/broker/dashboard" replace />} />
      </Route>

      <Route path="/admin" element={<AdminGuard />}>
        <Route index element={<AdminIndexRedirect />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="orgs" element={<AdminOrgsPage />} />
        <Route path="config/consent" element={<AdminConsentPage />} />
        <Route path="integrations/certn" element={<AdminCertnPage />} />
        <Route path="reviews/self-execution" element={<AdminSelfExecutionPage />} />
        <Route path="config/flags" element={<AdminFlagsPage />} />
        <Route path="audit" element={<AdminAuditPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
