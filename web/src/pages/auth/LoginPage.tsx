import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { api, ApiError, getSessionToken, redeemMagicLinkOnce, setSessionToken } from '../../api/client';
import { AuthShell } from '../../components/layout/AuthShell';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../hooks/useAuth';
import { getPartyRole, setPartyRole } from '../../lib/user-flow-store';
import { consumeAuthReturn, peekAuthReturn, setAuthReturn } from '../../lib/auth-return';
import { mergeAnonymousSaves } from '../../hooks/useSavedListings';
import {
  isNetlifyDemoMode,
  netlifyDemoHomeForRole,
  startNetlifyDemoSession,
  type NetlifyDemoRole,
} from '../../lib/netlify-demo';

function readQuery(): URLSearchParams {
  try {
    const hash = window.location.hash;
    const q = hash.includes('?') ? hash.split('?')[1] : '';
    if (q) return new URLSearchParams(q);
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

function readDemoRole(q: URLSearchParams): NetlifyDemoRole {
  const raw = (q.get('role') ?? '').toLowerCase();
  if (raw === 'broker' || raw === 'landlord' || raw === 'renter') return raw;
  const rt = q.get('returnTo') ?? '';
  if (rt.includes('broker')) return 'broker';
  if (rt.includes('dashboard') || rt.includes('landlord') || rt.includes('partner/landlord')) {
    return 'landlord';
  }
  return 'renter';
}

/** /auth/login — one AuthShell; returnTo drives post-auth destination. */
export function LoginPage() {
  const [, setLocation] = useLocation();
  const { setSession } = useAuth();
  const q = readQuery();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const demoBuild = isNetlifyDemoMode();

  const returnTo = q.get('returnTo') ?? '';
  const secondaryLabel =
    returnTo.includes('/listing/') || returnTo.includes('interest')
      ? 'Keep browsing without an account'
      : 'Back to Dwel';

  useEffect(() => {
    const rt = q.get('returnTo');
    const action = q.get('action') ?? undefined;
    if (rt) setAuthReturn({ returnTo: rt, action });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDevToken(null);
    try {
      if (demoBuild) {
        const role = readDemoRole(q);
        const started = startNetlifyDemoSession(email.trim(), role);
        if (!started.ok) {
          setError(started.error);
          return;
        }
        setPartyRole(role === 'landlord' ? 'landlord' : role);
        setSessionToken('netlify-demo-session');
        await setSession('netlify-demo-session');
        const dest =
          (returnTo && returnTo.startsWith('/') ? returnTo : null) ?? netlifyDemoHomeForRole(role);
        setLocation(dest);
        return;
      }

      const res = await api.magicLink(email.trim(), 'sign_in');
      setSent(true);
      if (res.redeem_token) setDevToken(res.redeem_token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start sign-in.');
    } finally {
      setBusy(false);
    }
  }

  function continueDev(token: string) {
    const ret = peekAuthReturn();
    const params = new URLSearchParams({ token, purpose: 'sign_in' });
    if (ret?.returnTo) params.set('returnTo', ret.returnTo);
    if (ret?.action) params.set('action', ret.action);
    setLocation(`/auth/callback?${params.toString()}`);
  }

  return (
    <AuthShell secondaryHref="/" secondaryLabel={secondaryLabel}>
      {demoBuild && (
        <div className="mb-4 rounded-[10px] border border-dwel-mint/40 bg-dwel-mint/10 p-3 text-sm text-dwel-gray-700">
          <p className="font-semibold text-dwel-black">Demo access (not secure authentication)</p>
          <p className="mt-1 text-dwel-gray-600">
            Enter an allowlisted RBIT email to explore simulated Dwel data. No magic link is sent.
            This does not grant production access.
          </p>
        </div>
      )}
      {sent && !demoBuild ? (
        <div className="space-y-4">
          <div className="rounded-[10px] border border-dwel-mint bg-dwel-mint/15 p-4 text-sm">
            Check your email — we sent a sign-in link to <strong>{email}</strong>.
          </div>
          {devToken && (
            <div className="rounded-[10px] border border-dwel-gray-200 bg-dwel-gray-50 p-4 text-sm">
              <p className="font-semibold">Continue on this device</p>
              <p className="mt-1 text-dwel-gray-500">Email delivery is off in this environment.</p>
              <Button className="mt-3" onClick={() => continueDev(devToken)}>
                Continue
              </Button>
            </div>
          )}
          <Button variant="ghost" onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
          <label className="block text-sm font-medium text-dwel-gray-600">
            Email address
            <Input
              className="mt-1.5"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy
              ? demoBuild
                ? 'Entering…'
                : 'Sending…'
              : demoBuild
                ? 'Enter demo'
                : 'Send sign-in link'}
          </Button>
        </form>
      )}

      {error && (
        <div className="mt-4 rounded-[10px] border border-red-200 bg-red-50 p-4 text-sm text-dwel-red">
          {error}
        </div>
      )}
    </AuthShell>
  );
}

function resolvePostAuthDestination(): string {
  const ret = consumeAuthReturn();
  if (ret?.returnTo) {
    const path = ret.returnTo.startsWith('/') ? ret.returnTo : `/${ret.returnTo}`;
    if (ret.action && !path.includes('action=')) {
      const sep = path.includes('?') ? '&' : '?';
      return `${path}${sep}action=${encodeURIComponent(ret.action)}`;
    }
    return path;
  }

  const role = getPartyRole();
  if (!role) return '/onboarding/role';
  if (role === 'landlord') return '/partner/landlord';
  if (role === 'broker') return '/partner/broker';
  return '/home';
}

/** Prefer internal preview hub for allowlisted demo accounts when no returnTo. */
async function resolvePostAuthDestinationAsync(): Promise<string> {
  const peek = peekAuthReturn();
  if (peek?.returnTo) return resolvePostAuthDestination();
  try {
    const access = await api.internalPreviewAccess();
    if (access.allowed) return '/internal/preview';
  } catch {
    /* fall through */
  }
  return resolvePostAuthDestination();
}

/** /auth/callback — returnTo-aware; merge anonymous saves */
export function AuthCallbackPage() {
  const [search] = useState(() => {
    const hash = window.location.hash;
    if (hash.includes('?')) return hash.split('?')[1] ?? '';
    return window.location.search.replace(/^\?/, '');
  });
  const [, setLocation] = useLocation();
  const { setSession } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(search);
    const token = q.get('token');
    const purpose = (q.get('purpose') as 'sign_in') || 'sign_in';
    const returnTo = q.get('returnTo');
    const action = q.get('action') ?? undefined;
    if (returnTo) setAuthReturn({ returnTo, action });

    if (!token) {
      setError('Missing sign-in token.');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        // StrictMode remounts effects in dev — redeem exactly once per token.
        const redeemed = await redeemMagicLinkOnce(token, purpose);
        if (cancelled) return;

        const pending = peekAuthReturn();
        if (pending?.returnTo?.includes('/listing/') || pending?.action === 'interest') {
          setPartyRole('renter');
        }

        // Authoritative hydration via /v1/auth/me
        await setSession(redeemed.session_id);
        if (cancelled) return;
        mergeAnonymousSaves();
        setLocation(await resolvePostAuthDestinationAsync());
      } catch (err) {
        if (cancelled) return;
        // If a concurrent StrictMode pass already established a session, hydrate + continue.
        if (getSessionToken()) {
          try {
            await setSession(getSessionToken()!);
          } catch {
            /* ignore */
          }
          if (!cancelled) setLocation(await resolvePostAuthDestinationAsync());
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'Sign-in link is invalid or expired.',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [search, setLocation, setSession]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F6F3] px-4">
      <Card className="w-full max-w-md p-6 text-center">
        {error ? (
          <>
            <h1 className="text-xl font-semibold">Sign-in failed</h1>
            <p className="mt-2 text-sm text-dwel-red">{error}</p>
            <Link href="/auth/login">
              <Button className="mt-6">Request a new link</Button>
            </Link>
          </>
        ) : (
          <p className="mt-2 text-sm text-dwel-gray-500">Signing you in…</p>
        )}
      </Card>
    </div>
  );
}
