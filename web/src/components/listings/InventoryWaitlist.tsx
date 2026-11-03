import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import {
  EMPTY_ANSWERS,
  loadAnswers,
  saveAnswers,
  type RenterAnswers,
} from '../../intake/answers';
import { track } from '../../lib/analytics';

const WAITLIST_KEY = 'dwel20.waitlist.v1';

export type WaitlistPrefs = {
  city: string;
  bedrooms: string;
  budget_band: string;
  email: string;
  saved_at: string;
};

const BUDGET_TO_RENT: Record<string, string> = {
  under_1500: '1500',
  '1500_2000': '2000',
  '2000_3000': '3000',
  '3000_plus': '4000',
};

function loadWaitlist(): WaitlistPrefs | null {
  try {
    const raw = localStorage.getItem(WAITLIST_KEY);
    return raw ? (JSON.parse(raw) as WaitlistPrefs) : null;
  } catch {
    return null;
  }
}

function persistWaitlist(prefs: WaitlistPrefs) {
  localStorage.setItem(WAITLIST_KEY, JSON.stringify(prefs));
}

function prefsToAnswers(prefs: WaitlistPrefs): RenterAnswers {
  const prior = loadAnswers();
  return {
    ...EMPTY_ANSWERS,
    ...prior,
    email: prefs.email.trim().toLowerCase(),
    bedrooms_min: prefs.bedrooms || prior.bedrooms_min,
    rent_max_dollars: BUDGET_TO_RENT[prefs.budget_band] ?? prior.rent_max_dollars,
    current_address_city: prefs.city.trim() || prior.current_address_city,
    profile_complete: false,
  };
}

/** Consumer waitlist when the public catalog has no publishable homes. */
export function InventoryWaitlist({
  initialCity = '',
}: {
  initialCity?: string;
}) {
  const { setSession, user } = useAuth();
  const existing = loadWaitlist();
  const [city, setCity] = useState(initialCity || existing?.city || '');
  const [bedrooms, setBedrooms] = useState(existing?.bedrooms || '');
  const [budget, setBudget] = useState(existing?.budget_band || '');
  const [email, setEmail] = useState(existing?.email || '');
  const [step, setStep] = useState<'form' | 'code' | 'done'>(existing ? 'done' : 'form');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedCity = city.trim();
    if (!trimmedCity || !trimmedEmail) {
      setError('Enter a city and a valid email so we can notify you.');
      return;
    }
    setBusy(true);
    try {
      const prefs: WaitlistPrefs = {
        city: trimmedCity,
        bedrooms,
        budget_band: budget,
        email: trimmedEmail,
        saved_at: new Date().toISOString(),
      };
      persistWaitlist(prefs);
      saveAnswers(prefsToAnswers(prefs));
      track('waitlist_started', { product: 'dwel', source: 'listings_empty' });

      if (user) {
        setStep('done');
        setStatus('Preferences saved. We will email you when matching homes are listed.');
        return;
      }

      const issued = await api.emailCode(trimmedEmail, 'sign_in');
      setResendIn(issued.retryAfterSeconds || 60);
      setStatus(issued.message);
      if (issued.debug_code) {
        const verified = await api.verifyEmailCode(trimmedEmail, issued.debug_code, 'sign_in');
        await setSession(verified.session_id);
        track('waitlist_completed', { product: 'dwel', source: 'listings_empty' });
        setStep('done');
        setStatus('You are on the list. We will email you when matching homes are available.');
        return;
      }
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start email verification.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmedEmail = email.trim().toLowerCase();
      const verified = await api.verifyEmailCode(trimmedEmail, code.trim(), 'sign_in');
      await setSession(verified.session_id);
      track('waitlist_completed', { product: 'dwel', source: 'listings_empty' });
      setStep('done');
      setStatus('You are on the list. We will email you when matching homes are available.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That code is invalid or expired.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (resendIn > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const issued = await api.emailCode(email.trim().toLowerCase(), 'sign_in');
      setResendIn(issued.retryAfterSeconds || 60);
      setStatus(issued.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resend the code.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'done') {
    return (
      <section className="dwel-empty-inventory" data-testid="listings-empty" aria-labelledby="empty-title">
        <h2 id="empty-title">You are on the list</h2>
        <p>
          We saved your search for <strong>{city || existing?.city || 'your area'}</strong>. When matching
          homes are listed on Dwel, we will email {email || existing?.email || 'you'}.
        </p>
        <p className="dwel-empty-inventory__note">
          You can keep browsing anytime. No fictional or demo homes are shown in this catalog.
        </p>
        <div className="dwel-empty-inventory__actions">
          <Link className="btn btn-primary" to="/">
            Back to home
          </Link>
          <Link className="btn btn-outline" to="/discover">
            Complete your profile
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="dwel-empty-inventory" data-testid="listings-empty" aria-labelledby="empty-title">
      <h2 id="empty-title">Homes are coming soon</h2>
      <p>
        We are adding real, verified rentals to Dwel. Tell us where you want to live and we will email you
        when matching homes are available.
      </p>

      {step === 'form' ? (
        <form className="dwel-empty-inventory__form" onSubmit={requestCode} noValidate>
          <div className="dwel-empty-inventory__grid">
            <div className="field">
              <label htmlFor="wait-city">City or ZIP</label>
              <input
                id="wait-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Austin, TX or 78704"
                maxLength={100}
                required
                autoComplete="address-level2"
              />
            </div>
            <div className="field">
              <label htmlFor="wait-beds">Bedrooms</label>
              <select id="wait-beds" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)}>
                <option value="">Any</option>
                <option value="0">Studio</option>
                <option value="1">1+</option>
                <option value="2">2+</option>
                <option value="3">3+</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="wait-budget">Monthly budget</label>
              <select id="wait-budget" value={budget} onChange={(e) => setBudget(e.target.value)}>
                <option value="">Any</option>
                <option value="under_1500">Under $1,500</option>
                <option value="1500_2000">$1,500–$2,000</option>
                <option value="2000_3000">$2,000–$3,000</option>
                <option value="3000_plus">$3,000+</option>
              </select>
            </div>
            <div className="field dwel-empty-inventory__full">
              <label htmlFor="wait-email">Email</label>
              <input
                id="wait-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                maxLength={254}
                required
                autoComplete="email"
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Sending code…' : 'Notify me when homes are listed'}
          </button>
          <p className="dwel-empty-inventory__note">
            We verify your email with a one-time code. You can also{' '}
            <Link to="/">return home</Link> or <Link to="/sign-in">sign in</Link>.
          </p>
        </form>
      ) : (
        <form className="dwel-empty-inventory__form" onSubmit={submitCode}>
          <p>
            Enter the code sent to <strong>{email.trim().toLowerCase()}</strong>.
          </p>
          <div className="field">
            <label htmlFor="wait-code">Verification code</label>
            <input
              id="wait-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
            {busy ? 'Verifying…' : 'Confirm and join the list'}
          </button>
          <p className="dwel-empty-inventory__note">
            <button type="button" className="dwel-text-link" onClick={() => void resend()} disabled={busy || resendIn > 0}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>
            {' · '}
            <button
              type="button"
              className="dwel-text-link"
              onClick={() => {
                setStep('form');
                setCode('');
                setError(null);
              }}
            >
              Edit details
            </button>
          </p>
        </form>
      )}

      {(error || status) && (
        <p className={error ? 'dwel-empty-inventory__status is-error' : 'dwel-empty-inventory__status'} role="status">
          {error ?? status}
        </p>
      )}
    </section>
  );
}
