import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { ErrorState, Shell } from '../components/Shell';

type Purpose = 'sign_in' | 'landlord_sign_in' | 'broker_sign_in';

function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  return raw;
}

export function SignInPage() {
  const [params] = useSearchParams();
  const role = params.get('role');
  const next = safeNext(params.get('next'));
  const purpose = useMemo<Purpose>(() => {
    if (role === 'landlord') return 'landlord_sign_in';
    if (role === 'broker') return 'broker_sign_in';
    return 'sign_in';
  }, [role]);

  const navigate = useNavigate();
  const { setSession, loading, user } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [remember, setRemember] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (loading || !user) return;
    if (next) navigate(next, { replace: true });
    else if (role === 'broker') navigate('/broker', { replace: true });
    else if (role === 'landlord') navigate('/landlord', { replace: true });
    else navigate('/', { replace: true });
  }, [loading, user, role, navigate, next]);

  function destination() {
    if (next) navigate(next, { replace: true });
    else if (role === 'broker') navigate('/broker', { replace: true });
    else if (role === 'landlord') navigate('/landlord', { replace: true });
    else navigate('/', { replace: true });
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.emailCode(email.trim(), purpose, remember);
      setMessage(res.message);
      setResendIn(res.retryAfterSeconds || 60);
      if (res.debug_code) {
        const verified = await api.verifyEmailCode(email.trim(), res.debug_code, purpose, remember);
        await setSession(verified.session_id);
        destination();
        return;
      }
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start sign-in.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const verified = await api.verifyEmailCode(email.trim(), code, purpose, remember);
      await setSession(verified.session_id);
      destination();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That code is invalid or expired.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="stack" style={{ maxWidth: '28rem', margin: '0 auto' }}>
        <p className="landing-hero-eyebrow">Dwel</p>
        <h1>Sign in</h1>
        <p className="muted">Enter your email. We send a 6-digit code to this page.</p>
        {loading ? (
          <p className="muted">Checking your session…</p>
        ) : step === 'email' ? (
          <form className="panel form-grid" onSubmit={(e) => void requestCode(e)}>
            <label>
              Email
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember this device for 30 days
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a code'}
            </button>
          </form>
        ) : (
          <form className="panel form-grid" onSubmit={(e) => void submitCode(e)}>
            <label>
              6-digit code
              <input
                type="text"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                pattern="[0-9 ]{6,12}"
                maxLength={12}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || resendIn > 0}
              onClick={() => void requestCode({ preventDefault() {} } as React.FormEvent)}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>
          </form>
        )}
        {message && (
          <div className="callout">
            <strong className="callout-title">Check your email</strong>
            <div className="callout-body">{message}</div>
          </div>
        )}
        {error && <ErrorState title="Sign-in blocked">{error}</ErrorState>}
        <p>
          <Link to="/">Back home</Link>
        </p>
      </div>
    </Shell>
  );
}
