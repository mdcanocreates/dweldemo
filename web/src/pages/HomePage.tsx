import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { ProductFooter, ProductHeader } from '../components/ProductChrome';
import {
  EMPTY_ANSWERS,
  loadAnswers,
  saveAnswers,
  type RenterAnswers,
} from '../intake/answers';
import { track } from '../lib/analytics';

const HERO_PHOTOS = [
  '/landing/hero-01.webp',
  '/landing/hero-02.webp',
  '/landing/hero-03.webp',
  '/landing/hero-04.webp',
  '/landing/hero-05.webp',
  '/landing/hero-06.webp',
] as const;

const ROTATE_MS = 7600;

const BUDGET_TO_RENT: Record<string, string> = {
  under_1500: '1500',
  '1500_2000': '2000',
  '2000_3000': '3000',
  '3000_plus': '4000',
};

const MOVE_IN_TO_URGENCY: Record<string, string> = {
  within_30: 'asap',
  '30_90': '1_3_months',
  after_90: 'flexible',
};

type IntakeDraft = {
  given_name: string;
  family_name: string;
  email: string;
  city: string;
  budget_band: string;
  bedrooms: string;
  move_in_window: string;
};

const EMPTY_INTAKE: IntakeDraft = {
  given_name: '',
  family_name: '',
  email: '',
  city: '',
  budget_band: '',
  bedrooms: '',
  move_in_window: '',
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function draftToAnswers(draft: IntakeDraft): RenterAnswers {
  const prior = loadAnswers();
  const city = draft.city.trim();
  const rent = BUDGET_TO_RENT[draft.budget_band] ?? prior.rent_max_dollars;
  const urgency = MOVE_IN_TO_URGENCY[draft.move_in_window] ?? prior.move_in_urgency;
  return {
    ...EMPTY_ANSWERS,
    ...prior,
    given_name: draft.given_name.trim(),
    family_name: draft.family_name.trim(),
    email: draft.email.trim().toLowerCase(),
    bedrooms_min: draft.bedrooms || prior.bedrooms_min,
    rent_max_dollars: rent,
    move_in_urgency: urgency,
    current_address_city: city || prior.current_address_city,
    profile_complete: false,
  };
}

/** Marketing landing — photo hero + email-code intake (existing auth only). */
export function HomePage() {
  const navigate = useNavigate();
  const { setSession, user } = useAuth();
  const [activeSlide, setActiveSlide] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [draft, setDraft] = useState<IntakeDraft>(EMPTY_INTAKE);
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    const reduced = prefersReducedMotion();
    setReduceMotion(reduced);
    if (reduced) return;
    const timer = window.setInterval(() => {
      setActiveSlide((n) => (n + 1) % HERO_PHOTOS.length);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const canSubmit = useMemo(() => {
    return Boolean(draft.given_name.trim() && draft.family_name.trim() && draft.email.trim());
  }, [draft]);

  function setField<K extends keyof IntakeDraft>(key: K, value: IntakeDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function finishAuthenticated(answers: RenterAnswers) {
    saveAnswers(answers);
    setStatus('Email verified. Continue browsing — finish your profile anytime.');
    navigate('/listings');
  }

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    if (!canSubmit) {
      setError('Enter your first name, last name, and a valid email to continue.');
      return;
    }
    const email = draft.email.trim().toLowerCase();
    setBusy(true);
    try {
      track('signup_started', { product: 'dwel', purpose: 'sign_in', source: 'landing_v5' });
      const answers = draftToAnswers(draft);
      saveAnswers(answers);
      const issued = await api.emailCode(email, 'sign_in');
      setResendIn(issued.retryAfterSeconds || 60);
      setStatus(issued.message);
      if (issued.debug_code) {
        const verified = await api.verifyEmailCode(email, issued.debug_code, 'sign_in');
        await setSession(verified.session_id);
        track('signup_completed', { product: 'dwel', purpose: 'sign_in', source: 'landing_v5' });
        await finishAuthenticated(answers);
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
      const email = draft.email.trim().toLowerCase();
      const verified = await api.verifyEmailCode(email, code.trim(), 'sign_in');
      await setSession(verified.session_id);
      track('signup_completed', { product: 'dwel', purpose: 'sign_in', source: 'landing_v5' });
      await finishAuthenticated(draftToAnswers(draft));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That code is invalid or expired.');
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (resendIn > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const issued = await api.emailCode(draft.email.trim().toLowerCase(), 'sign_in');
      setResendIn(issued.retryAfterSeconds || 60);
      setStatus(issued.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resend the code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="landing landing-v5">
      <ProductHeader />

      <main className="lv5-page" id="top">
        <div className="lv5-hero-layout">
          <section className="lv5-hero-photo" aria-label="Dwel brand photography">
            {/* Decorative only: no controls, dots, swipe, or listing links on photos. */}
            <div className="lv5-photo-stack" aria-hidden="true">
              {HERO_PHOTOS.map((src, index) => (
                <img
                  key={src}
                  className={
                    index === activeSlide || (reduceMotion && index === 0)
                      ? 'lv5-hero-slide is-active'
                      : 'lv5-hero-slide'
                  }
                  src={src}
                  alt=""
                  width={1600}
                  height={1066}
                  decoding="async"
                  fetchPriority={index === 0 ? 'high' : 'auto'}
                  loading={index === 0 ? 'eager' : 'lazy'}
                  draggable={false}
                />
              ))}
            </div>
            <div className="lv5-photo-overlay" aria-hidden="true" />
            <div className="lv5-hero-copy">
              <span className="lv5-hero-kicker">YOUR NEXT HOME STARTS HERE</span>
              <h1>
                Find a home.
                <br />
                Move with <em>more back.</em>
              </h1>
              <p>Explore rentals, compare real offers, and find a place that feels right for you.</p>
              <div className="lv5-hero-actions">
                <Link className="lv5-button lv5-button-mint" to="/listings">
                  Browse homes <span aria-hidden="true">→</span>
                </Link>
                <Link className="lv5-button lv5-button-outline" to="/faqs">
                  How it works
                </Link>
              </div>
            </div>
          </section>

          <section className="lv5-intake-panel" aria-labelledby="signup-title">
            <div className="lv5-intake-heading">
              <h2 id="signup-title">Start your home search.</h2>
              <p>Tell us a little about yourself. We will help you pick up where you left off.</p>
            </div>

            {user ? (
              <div className="lv5-signed-in">
                <p>You are signed in. Browse homes or continue your profile.</p>
                <div className="lv5-hero-actions">
                  <Link className="lv5-button lv5-button-mint" to="/listings">
                    Browse homes
                  </Link>
                  <Link className="lv5-button lv5-button-dark" to="/discover">
                    Continue profile
                  </Link>
                </div>
              </div>
            ) : step === 'form' ? (
              <form id="dwel-intake" onSubmit={requestCode} autoComplete="on" noValidate>
                <div className="lv5-field-grid">
                  <div className="lv5-field">
                    <label htmlFor="first-name">
                      First name <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="first-name"
                      name="given_name"
                      autoComplete="given-name"
                      placeholder="First name"
                      maxLength={80}
                      required
                      value={draft.given_name}
                      onChange={(e) => setField('given_name', e.target.value)}
                    />
                  </div>
                  <div className="lv5-field">
                    <label htmlFor="last-name">
                      Last name <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="last-name"
                      name="family_name"
                      autoComplete="family-name"
                      placeholder="Last name"
                      maxLength={80}
                      required
                      value={draft.family_name}
                      onChange={(e) => setField('family_name', e.target.value)}
                    />
                  </div>
                  <div className="lv5-field lv5-field-full">
                    <label htmlFor="email">
                      Email address <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      placeholder="you@example.com"
                      maxLength={254}
                      required
                      value={draft.email}
                      onChange={(e) => setField('email', e.target.value)}
                    />
                  </div>
                </div>

                <div className="lv5-form-divider">
                  <span>YOUR HOME PREFERENCES</span>
                </div>

                <div className="lv5-field-grid">
                  <div className="lv5-field lv5-field-full">
                    <label htmlFor="city">Where are you looking?</label>
                    <input
                      id="city"
                      name="city"
                      autoComplete="address-level2"
                      placeholder="City or ZIP code"
                      maxLength={100}
                      value={draft.city}
                      onChange={(e) => setField('city', e.target.value)}
                    />
                  </div>
                  <div className="lv5-field">
                    <label htmlFor="budget">Monthly budget</label>
                    <select
                      id="budget"
                      name="budget_band"
                      value={draft.budget_band}
                      onChange={(e) => setField('budget_band', e.target.value)}
                    >
                      <option value="">Any budget</option>
                      <option value="under_1500">Under $1,500</option>
                      <option value="1500_2000">$1,500–$2,000</option>
                      <option value="2000_3000">$2,000–$3,000</option>
                      <option value="3000_plus">$3,000+</option>
                    </select>
                  </div>
                  <div className="lv5-field">
                    <label htmlFor="bedrooms">Bedrooms</label>
                    <select
                      id="bedrooms"
                      name="bedrooms"
                      value={draft.bedrooms}
                      onChange={(e) => setField('bedrooms', e.target.value)}
                    >
                      <option value="">Any</option>
                      <option value="0">Studio</option>
                      <option value="1">1 bedroom</option>
                      <option value="2">2 bedrooms</option>
                      <option value="3">3+ bedrooms</option>
                    </select>
                  </div>
                  <div className="lv5-field lv5-field-full">
                    <label htmlFor="move-in">When are you hoping to move?</label>
                    <select
                      id="move-in"
                      name="move_in_window"
                      value={draft.move_in_window}
                      onChange={(e) => setField('move_in_window', e.target.value)}
                    >
                      <option value="">Just exploring</option>
                      <option value="within_30">Within 30 days</option>
                      <option value="30_90">1–3 months</option>
                      <option value="after_90">More than 3 months</option>
                    </select>
                  </div>
                </div>

                <button className="lv5-submit" type="submit" disabled={busy}>
                  {busy ? 'Sending code…' : 'Continue with email'}{' '}
                  <span aria-hidden="true">→</span>
                </button>
                <p className="lv5-form-disclosure">
                  We will verify your email before creating an account.{' '}
                  <Link to="/privacy">Privacy policy</Link>
                </p>
              </form>
            ) : (
              <form onSubmit={submitCode} className="lv5-code-form">
                <p className="lv5-code-lead">
                  Enter the code sent to <strong>{draft.email.trim().toLowerCase()}</strong>.
                </p>
                <div className="lv5-field lv5-field-full">
                  <label htmlFor="email-code">Verification code</label>
                  <input
                    id="email-code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6-digit code"
                    maxLength={12}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </div>
                <button className="lv5-submit" type="submit" disabled={busy || !code.trim()}>
                  {busy ? 'Verifying…' : 'Verify email'}
                </button>
                <p className="lv5-form-disclosure">
                  <button
                    type="button"
                    className="lv5-text-button"
                    onClick={() => void resendCode()}
                    disabled={busy || resendIn > 0}
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                  </button>
                  {' · '}
                  <button
                    type="button"
                    className="lv5-text-button"
                    onClick={() => {
                      setStep('form');
                      setCode('');
                      setError(null);
                    }}
                  >
                    Edit email
                  </button>
                </p>
              </form>
            )}

            {(error || status) && (
              <p
                className={error ? 'lv5-form-status error' : 'lv5-form-status'}
                role="status"
                aria-live="polite"
              >
                {error ?? status}
              </p>
            )}

            <div className="lv5-intake-footer">
              Already have an account? <Link to="/sign-in">Sign in</Link>
              <span className="lv5-footer-dot">·</span>
              <Link to="/listings">Browse without signing up</Link>
            </div>
          </section>
        </div>

        <nav className="lv5-faq-bar" aria-label="Helpful questions">
          <Link to="/faqs">
            How does Dwel work?<span aria-hidden="true">→</span>
          </Link>
          <Link to="/cashback-terms">
            How does cashback work?<span aria-hidden="true">→</span>
          </Link>
          <Link to="/faqs">
            Can I browse without joining?<span aria-hidden="true">→</span>
          </Link>
          <Link to="/partner">
            For home partners<span aria-hidden="true">→</span>
          </Link>
        </nav>
      </main>

      <ProductFooter />
    </div>
  );
}
