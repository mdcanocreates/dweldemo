import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth';
import { StagingBanner } from './components/layout/StagingBanner';
import { configureAnalytics, startEngagementTracking, trackPageview } from './lib/analytics';
import { SavedHomesProvider } from './savedHomes';
import './styles.css';
import './styles/landing-v5.css';

configureAnalytics({
  enabled: import.meta.env.VITE_ANALYTICS_ENABLED === 'true',
  apiKey: import.meta.env.VITE_POSTHOG_KEY,
  host: import.meta.env.VITE_POSTHOG_HOST,
  product: 'dwel',
});
trackPageview(window.location.href);
startEngagementTracking();
window.addEventListener('hashchange', () => trackPageview(window.location.href));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <SavedHomesProvider>
          <StagingBanner />
          <App />
        </SavedHomesProvider>
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
);
