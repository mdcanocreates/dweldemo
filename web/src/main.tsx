import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { AuthProvider } from './hooks/useAuth';
import { useAppHashLocation } from './lib/hash-location';
import { captureAttributionOnBoot } from './lib/attribution';
import { api } from './api/client';
import App from './App';
import { StagingBanner } from './components/layout/StagingBanner';
import { NetlifyDemoChrome } from './components/demo/NetlifyDemoChrome';
import { isNetlifyDemoMode } from './lib/netlify-demo';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Standalone Netlify demo must not POST attribution to a live API.
if (!isNetlifyDemoMode()) {
  void captureAttributionOnBoot((body) => api.attributionVisit(body));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router hook={useAppHashLocation}>
        <AuthProvider>
          <NetlifyDemoChrome />
          <StagingBanner />
          <App />
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
