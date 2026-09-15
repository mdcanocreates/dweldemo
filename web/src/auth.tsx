import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setMemorySessionId } from './api';

export type AuthUser = {
  partyId: string;
  sessionId: string;
  landlordOrgId: string | null;
  brokerOrgId: string | null;
  roles: Array<{ role: string; orgId: string | null }>;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setSession: (sessionId: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setMemorySessionId(me.session_id);
      setUser({
        partyId: me.party_id,
        sessionId: me.session_id,
        landlordOrgId: me.landlord_org_id,
        brokerOrgId: me.broker_org_id,
        roles: me.roles.map((r) => ({ role: r.role, orgId: r.org_id })),
      });
    } catch {
      setMemorySessionId(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setSession = useCallback(
    async (sessionId: string) => {
      setMemorySessionId(sessionId);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // clear locally anyway
    }
    setMemorySessionId(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, refresh, setSession, logout }),
    [user, loading, refresh, setSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requires AuthProvider');
  return ctx;
}
