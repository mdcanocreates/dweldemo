import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { ErrorState, Shell } from '../components/Shell';
import {
  answersToProfilePayload,
  loadAnswers,
  saveAnswers,
  type RenterAnswers,
} from '../intake/answers';

/** Renter profile form. The old chat intake is not the public path. */
export function DiscoverPage() {
  const { user, setSession, refresh } = useAuth();
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<RenterAnswers>(() => loadAnswers());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingAnswers, setPendingAnswers] = useState<RenterAnswers | null>(null);
  const [code, setCode] = useState('');

  function setField<K extends keyof RenterAnswers>(key: K, value: RenterAnswers[K]) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  async function finishProfile(next: RenterAnswers) {
    setBusy(true);
    setError(null);
    saveAnswers({ ...next, profile_complete: true });
    try {
      if (!user) {
        const issued = await api.emailCode(next.email.trim(), 'sign_in');
        if (!issued.debug_code) {
          setPendingEmail(next.email.trim());
          setPendingAnswers(next);
          setError('Enter the 6-digit code sent to your email to finish.');
          return;
        }
        const verified = await api.verifyEmailCode(next.email.trim(), issued.debug_code, 'sign_in');
        await setSession(verified.session_id);
        await refresh();
      }
      const profile = await api.upsertRenterProfile(answersToProfilePayload(next));
      if (profile.profile.preferred_state === 'NY') {
        navigate('/screening-choice', { replace: true });
      } else {
        navigate('/listings', { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not save profile.');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void finishProfile(answers);
  }

  return (
    <Shell>
      <div className="stack" style={{ maxWidth: '36rem' }}>
        <p className="landing-hero-eyebrow">Renter profile</p>
        <h1>Tell Dwel what you need.</h1>
        <p className="muted">
          This is a short form. When you finish, we email a 6-digit code so the profile stays on
          your account.
        </p>
        {error && <ErrorState title="Profile not saved">{error}</ErrorState>}
        {pendingEmail && pendingAnswers && (
          <form
            className="panel form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  const verified = await api.verifyEmailCode(pendingEmail, code, 'sign_in');
                  await setSession(verified.session_id);
                  await refresh();
                  const profile = await api.upsertRenterProfile(
                    answersToProfilePayload(pendingAnswers),
                  );
                  setPendingEmail(null);
                  if (profile.profile.preferred_state === 'NY') {
                    navigate('/screening-choice', { replace: true });
                  } else {
                    navigate('/listings', { replace: true });
                  }
                } catch (err) {
                  setError(err instanceof ApiError || err instanceof Error ? err.message : 'That code did not work.');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <label>
              6-digit code
              <input
                type="text"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(ev) => setCode(ev.target.value)}
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
        )}
        <form className="panel form-grid" onSubmit={onSubmit}>
          <label>
            First name
            <input
              required
              value={answers.given_name ?? ''}
              onChange={(e) => setField('given_name', e.target.value)}
            />
          </label>
          <label>
            Last name
            <input
              required
              value={answers.family_name ?? ''}
              onChange={(e) => setField('family_name', e.target.value)}
            />
          </label>
          <label>
            Phone
            <input
              required
              type="tel"
              autoComplete="tel"
              value={answers.phone ?? ''}
              onChange={(e) => setField('phone', e.target.value)}
            />
          </label>
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={answers.email ?? ''}
              onChange={(e) => setField('email', e.target.value)}
            />
          </label>
          <label>
            When do you need to move?
            <select
              required
              value={answers.move_in_urgency ?? ''}
              onChange={(e) => setField('move_in_urgency', e.target.value)}
            >
              <option value="">Choose one</option>
              <option value="immediate">ASAP</option>
              <option value="within_30_days">Within 30 days</option>
              <option value="within_60_days">Within 60 days</option>
              <option value="flexible">Flexible</option>
            </select>
          </label>
          <label>
            Max monthly rent
            <input
              required
              inputMode="decimal"
              value={answers.rent_max_dollars ?? ''}
              onChange={(e) => setField('rent_max_dollars', e.target.value)}
            />
          </label>
          <label>
            Minimum bedrooms
            <input
              required
              inputMode="numeric"
              value={answers.bedrooms_min ?? ''}
              onChange={(e) => setField('bedrooms_min', e.target.value)}
            />
          </label>
          <label>
            State
            <input
              required
              maxLength={2}
              value={answers.preferred_state ?? ''}
              onChange={(e) => setField('preferred_state', e.target.value.toUpperCase())}
              placeholder="TX"
            />
          </label>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={Boolean(answers.has_pets)}
              onChange={(e) => setField('has_pets', e.target.checked)}
            />
            I have pets
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || Boolean(pendingEmail)}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </form>
        <p>
          <Link to="/listings">Browse homes</Link>
        </p>
      </div>
    </Shell>
  );
}
