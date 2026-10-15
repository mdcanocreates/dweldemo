import { useEffect, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { api, ApiError } from '../../api/client';
import { AuthShell } from '../../components/layout/AuthShell';
import { PreviewRoleSwitcher } from '../../components/layout/PreviewRoleSwitcher';
import { Button } from '../../components/ui/Button';
import { BrandMark } from '../../components/brand/BrandMark';
import { useAuth } from '../../hooks/useAuth';
import { setPreviewRole, type PreviewRole } from '../../lib/internal-preview';

const ROLE_LABEL: Record<PreviewRole, string> = {
  renter: 'Renter',
  landlord: 'Home Provider',
  broker: 'Broker',
};

/**
 * Server-authorized preview entry.
 * Does not invent roles client-side — waits for GET+POST /v1/internal/preview.
 */
export function InternalPreviewPage() {
  const { user, loading } = useAuth();
  const [, params] = useRoute('/internal/preview/:role');
  const [, setLocation] = useLocation();
  const roleParam = (params?.role ?? '') as PreviewRole | string;
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setLocation(
        `/auth/login?returnTo=${encodeURIComponent(`/internal/preview/${roleParam || 'landlord'}`)}`,
      );
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const access = await api.internalPreviewAccess();
        if (cancelled) return;
        if (!access.allowed) {
          setError('Preview is not enabled for this account.');
          setChecking(false);
          return;
        }
        const role = (roleParam === 'broker' || roleParam === 'landlord' || roleParam === 'renter'
          ? roleParam
          : null) as PreviewRole | null;
        if (!role || !access.roles.includes(role)) {
          setError('Unknown or unauthorized preview role.');
          setChecking(false);
          return;
        }
        const set = await api.internalPreviewSetRole(role);
        if (cancelled) return;
        if (!set.allowed) {
          setError('Could not set preview role.');
          setChecking(false);
          return;
        }
        setPreviewRole(role);
        if (role === 'landlord') setLocation('/dashboard');
        else if (role === 'broker') setLocation('/broker/dashboard');
        else setLocation('/home');
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : 'Preview authorization failed.',
          );
          setChecking(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, loading, roleParam, setLocation]);

  if (error) {
    return (
      <AuthShell title="Preview unavailable" subtitle={error}>
        <Link href="/">
          <Button>Back to Dwel</Button>
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Opening preview…" subtitle="Confirming server authorization.">
      {checking && <p className="text-sm text-dwel-gray-500">Please wait…</p>}
    </AuthShell>
  );
}

export function InternalPreviewSwitcherPage() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [allowed, setAllowed] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setLocation(`/auth/login?returnTo=${encodeURIComponent('/internal/preview')}`);
      return;
    }
    void api
      .internalPreviewAccess()
      .then((r) => {
        setAllowed(r.allowed);
        setRoles(r.roles);
        if (!r.allowed) setError('Not authorized for internal preview.');
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Preview check failed.');
      });
  }, [user, loading, setLocation]);

  async function enter(role: PreviewRole) {
    try {
      const set = await api.internalPreviewSetRole(role);
      if (!set.allowed) {
        setError('Could not set preview role.');
        return;
      }
      setPreviewRole(role);
      setLocation(`/internal/preview/${role}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set preview role.');
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F6F3]">
      <header className="sticky top-0 z-40 border-b border-dwel-gray-200/80 bg-dwel-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1098px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <BrandMark href="/" />
          <PreviewRoleSwitcher tone="light" />
        </div>
      </header>
      <main className="mx-auto max-w-[480px] px-4 py-12 sm:px-6">
        <h1 className="font-display text-2xl font-semibold text-dwel-black">
          Internal preview
        </h1>
        <p className="mt-2 text-sm text-dwel-gray-500">
          Server-authorized UI inspection only. Does not change your real roles or memberships.
        </p>
        {error && (
          <div className="mt-6 rounded-[10px] border border-red-200 bg-red-50 p-4 text-sm text-dwel-red">
            {error}
          </div>
        )}
        {allowed && (
          <div className="mt-8 flex flex-col gap-3">
            <p className="text-sm text-dwel-gray-600">Viewing as:</p>
            {roles.includes('renter') && (
              <Button variant="secondary" onClick={() => void enter('renter')}>
                {ROLE_LABEL.renter}
              </Button>
            )}
            {roles.includes('landlord') && (
              <Button onClick={() => void enter('landlord')}>{ROLE_LABEL.landlord}</Button>
            )}
            {roles.includes('broker') && (
              <Button variant="secondary" onClick={() => void enter('broker')}>
                {ROLE_LABEL.broker}
              </Button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
