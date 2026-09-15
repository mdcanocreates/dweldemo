import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { ErrorState, Shell } from '../components/Shell';

export function SignInPage() {
  const [params] = useSearchParams();
  const role = params.get('role');
  const purpose = useMemo(() => {
    if (role === 'landlord') return 'landlord_sign_in' as const;
    if (role === 'broker') return 'broker_sign_in' as const;
    return 'sign_in' as const;
  }, [role]);

  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [email, setEmail] = useState('');
  const [redeemToken, setRedeemToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    setRedeemToken(null);
    try {
      const res = await api.magicLink(email.trim(), purpose);
      setMessage(res.message);
      if (res.redeem_token) setRedeemToken(res.redeem_token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start sign-in.');
    } finally {
      setBusy(false);
    }
  }

  async function completeRedeem(token: string) {
    setBusy(true);
    setError(null);
    try {
      const redeemed = await api.redeem(token, purpose);
      await setSession(redeemed.session_id);
      if (role === 'broker') navigate('/broker');
      else if (role === 'landlord') navigate('/landlord');
      else navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in link is invalid or expired.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="stack" style={{ maxWidth: '28rem' }}>
        <h1>Sign in</h1>
        <p>Passwordless email link. No passwords stored on dwel.20.</p>
        <form className="panel form-grid" onSubmit={(e) => void requestLink(e)}>
          <label>
            Work email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Email me a sign-in link'}
          </button>
        </form>
        {message && (
          <div className="callout">
            <strong>Check your email</strong>
            {message}
          </div>
        )}
        {redeemToken && (
          <div className="callout">
            <strong>Continue on this device</strong>
            Email delivery is not configured in this environment, so you can finish sign-in here.
            <div style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void completeRedeem(redeemToken)}
              >
                Continue
              </button>
            </div>
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
