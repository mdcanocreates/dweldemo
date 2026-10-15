import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, getSessionToken, setSessionToken } from '../api/client';
import { setPreviewRole } from '../lib/internal-preview';
import {
  getUiPreviewRole,
  isUiPreviewActive,
  isUiPreviewPath,
  stopUiPreview,
} from '../lib/ui-preview';
import {
  getNetlifyDemoEmail,
  getNetlifyDemoRole,
  isNetlifyDemoMode,
  isNetlifyDemoSessionActive,
  netlifyDemoEventName,
  stopNetlifyDemoSession,
} from '../lib/netlify-demo';
import { clearPartyRole, getPartyRole, setPartyRole } from '../lib/user-flow-store';
import type { MeResponse, PartyRole, UserRole } from '../types';

type AuthState = {
  user: MeResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setSession: (sessionId: string) => Promise<MeResponse | null>;
  logout: () => Promise<void>;
  needsMfaEnrollment: boolean;
  needsMfaChallenge: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

/** Feature gate: unfinished MFA/passkey UI must not block acceptance. */
function isMfaEnrollmentEnabled(): boolean {
  return import.meta.env.VITE_MFA_ENROLLMENT_ENABLED === 'true';
}

/** Public meeting demo must not touch /v1/* even for session probe. */
function isPublicDemoPath(): boolean {
  const hash = window.location.hash || '';
  return hash.startsWith('#/demo');
}

function uiPreviewMe(): MeResponse {
  const role = getUiPreviewRole() ?? 'renter';
  return {
    party_id: 'ui-preview-party',
    session_id: 'ui-preview-session',
    role: role === 'landlord' ? 'LANDLORD' : role === 'broker' ? 'BROKER' : 'APPLICANT',
    email: 'ui-preview@localhost',
    given_name: 'UI',
    family_name: 'Preview',
    mfa_enrolled: true,
    mfa_required: false,
    renter_profile_complete: true,
    party_role: role === 'landlord' ? 'landlord' : role === 'broker' ? 'broker' : 'renter',
    roles: [
      { role: 'applicant', org_id: null },
      { role: 'landlord', org_id: 'ui-org-oaks' },
      { role: 'broker', org_id: 'ui-org-broker' },
    ],
  };
}

function netlifyDemoMe(): MeResponse {
  const role = getNetlifyDemoRole() ?? 'renter';
  const email = getNetlifyDemoEmail() ?? 'demo@rbitfinancial.com';
  const localPart = email.split('@')[0] ?? 'demo';
  return {
    party_id: 'netlify-demo-party',
    session_id: 'netlify-demo-session',
    role: role === 'landlord' ? 'LANDLORD' : role === 'broker' ? 'BROKER' : 'APPLICANT',
    email,
    given_name: 'Demo',
    family_name: localPart,
    mfa_enrolled: true,
    mfa_required: false,
    renter_profile_complete: true,
    party_role: role === 'landlord' ? 'landlord' : role === 'broker' ? 'broker' : 'renter',
    roles: [
      { role: 'applicant', org_id: null },
      { role: 'landlord', org_id: 'ui-org-oaks' },
      { role: 'broker', org_id: 'ui-org-broker' },
    ],
  };
}

function syncPartyRoleFromMe(me: MeResponse): PartyRole {
  const existing = getPartyRole();
  if (existing) return existing;
  if (me.role === 'LANDLORD') {
    setPartyRole('landlord');
    return 'landlord';
  }
  if (me.role === 'BROKER') {
    setPartyRole('broker');
    return 'broker';
  }
  if (me.role === 'ADMIN') {
    setPartyRole('admin');
    return 'admin';
  }
  const roles = me.roles ?? [];
  if (roles.some((r) => r.role === 'landlord')) {
    setPartyRole('landlord');
    return 'landlord';
  }
  if (roles.some((r) => r.role === 'broker' || r.role === 'broker_admin')) {
    setPartyRole('broker');
    return 'broker';
  }
  setPartyRole('renter');
  return 'renter';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (isPublicDemoPath()) {
      setUser(null);
      setLoading(false);
      return;
    }
    if (isUiPreviewActive()) {
      const me = uiPreviewMe();
      setPartyRole(me.party_role ?? 'renter');
      setUser(me);
      setLoading(false);
      return;
    }
    if (isNetlifyDemoMode() && isNetlifyDemoSessionActive()) {
      const me = netlifyDemoMe();
      setPartyRole(me.party_role ?? 'renter');
      setUser(me);
      setLoading(false);
      return;
    }
    if (isNetlifyDemoMode()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.me();
      if (me) {
        const partyRole = syncPartyRoleFromMe(me);
        setUser({ ...me, party_role: partyRole });
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onHash = () => {
      if (isPublicDemoPath()) {
        setUser(null);
        setLoading(false);
        return;
      }
      if (isUiPreviewPath() || isUiPreviewActive()) {
        void refresh();
        return;
      }
      void refresh();
    };
    const onDemo = () => {
      void refresh();
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener(netlifyDemoEventName(), onDemo);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener(netlifyDemoEventName(), onDemo);
    };
  }, [refresh]);

  const setSession = useCallback(async (sessionId: string) => {
    setSessionToken(sessionId);
    setLoading(true);
    try {
      if (isNetlifyDemoMode() && isNetlifyDemoSessionActive()) {
        const me = netlifyDemoMe();
        setPartyRole(me.party_role ?? 'renter');
        setUser(me);
        return me;
      }
      const me = await api.me();
      if (me) {
        const partyRole = syncPartyRoleFromMe(me);
        const next = { ...me, party_role: partyRole };
        setUser(next);
        return next;
      }
      setUser(null);
      return null;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    if (isUiPreviewActive()) {
      stopUiPreview();
      clearPartyRole();
      setUser(null);
      setLoading(false);
      window.location.hash = '#/internal/ui-preview';
      return;
    }
    if (isNetlifyDemoMode()) {
      stopNetlifyDemoSession();
      setSessionToken(null);
      clearPartyRole();
      setUser(null);
      setLoading(false);
      window.location.hash = '#/auth/login';
      return;
    }
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setSessionToken(null);
    clearPartyRole();
    setUser(null);
    setPreviewRole(null);
  }, []);

  const needsMfaEnrollment = Boolean(
    isMfaEnrollmentEnabled() &&
      user &&
      user.mfa_required &&
      !user.mfa_enrolled &&
      (user.role === 'LANDLORD' || user.role === 'ADMIN' || user.role === 'BROKER'),
  );

  const needsMfaChallenge = false;

  const value = useMemo(
    () => ({
      user,
      loading,
      refresh,
      setSession,
      logout,
      needsMfaEnrollment,
      needsMfaChallenge,
    }),
    [user, loading, refresh, setSession, logout, needsMfaEnrollment, needsMfaChallenge],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useRole(): UserRole | null {
  return useAuth().user?.role ?? null;
}

export function hasSessionCookie(): boolean {
  return Boolean(getSessionToken());
}
