import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { ErrorState, Shell } from '../components/Shell';
import {
  answersToProfilePayload,
  loadAnswers,
  mergeServerRecords,
  profileFieldsComplete,
  saveAnswers,
  type RenterAnswers,
} from '../intake/answers';

type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';
type AccountProfile = 'unknown' | 'missing' | 'loaded' | 'load_failed';

function sameDraft(a: RenterAnswers, b: RenterAnswers): boolean {
  const keys: Array<keyof RenterAnswers> = [
    'given_name',
    'family_name',
    'phone',
    'email',
    'move_in_urgency',
    'bedrooms_min',
    'rent_max_dollars',
    'preferred_state',
    'has_pets',
  ];
  return keys.every((key) => a[key] === b[key]);
}

/** Renter profile form. Account fields load from the server when a session exists. */
export function DiscoverPage() {
  const { user, loading, setSession, refresh } = useAuth();
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<RenterAnswers>(() => loadAnswers());
  const [baseline, setBaseline] = useState<RenterAnswers>(() => loadAnswers());
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [accountProfile, setAccountProfile] = useState<AccountProfile>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingAnswers, setPendingAnswers] = useState<RenterAnswers | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      const local = loadAnswers();
      if (!user) {
        if (cancelled) return;
        setAnswers(local);
        setBaseline(local);
        setAccountProfile('unknown');
        setHydrated(true);
        setSaveState('unsaved');
        return;
      }
      try {
        const data = await api.getRenterProfile();
        if (cancelled) return;
        const merged = mergeServerRecords(local, data.profile, null);
        setAnswers(merged);
        setBaseline(merged);
        saveAnswers(merged);
        setAccountProfile('loaded');
        setSaveState(profileFieldsComplete(merged) ? 'saved' : 'unsaved');
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setAnswers(local);
          setBaseline(local);
          setAccountProfile('missing');
          setSaveState('unsaved');
          setError(null);
        } else {
          setAnswers(local);
          setBaseline(local);
          setAccountProfile('load_failed');
          setSaveState('error');
          setError(
            err instanceof ApiError
              ? err.message
              : 'Your account profile could not be loaded. What you see may be from this browser only.',
          );
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  function setField<K extends keyof RenterAnswers>(key: K, value: RenterAnswers[K]) {
    const next = { ...answers, [key]: value, profile_complete: false };
    saveAnswers(next);
    setAnswers(next);
    setSaveState(sameDraft(next, baseline) && accountProfile === 'loaded' ? 'saved' : 'unsaved');
  }

  async function persistProfile(next: RenterAnswers): Promise<boolean> {
    if (!profileFieldsComplete(next)) {
      setSaveState('error');
      setError('This profile is incomplete. Fill every required field before saving.');
      return false;
    }
    setSaveState('saving');
    setError(null);
    const profile = await api.upsertRenterProfile(answersToProfilePayload(next));
    const merged = mergeServerRecords(next, profile.profile, null);
    saveAnswers(merged);
    setAnswers(merged);
    setBaseline(merged);
    setAccountProfile('loaded');
    setSaveState('saved');
    return true;
  }

  async function finishProfile(next: RenterAnswers) {
    setError(null);
    try {
      if (!user) {
        const issued = await api.emailCode(next.email.trim(), 'sign_in');
        if (!issued.debug_code) {
          setPendingEmail(next.email.trim());
          setPendingAnswers(next);
          setSaveState('unsaved');
          setError('Enter the 6-digit code sent to your email to finish.');
          return;
        }
        const verified = await api.verifyEmailCode(next.email.trim(), issued.debug_code, 'sign_in');
        await setSession(verified.session_id);
        await refresh();
      }
      const saved = await persistProfile(next);
      if (!saved) return;
      if (next.preferred_state.trim().toUpperCase() === 'NY') {
        navigate('/screening-choice', { replace: true });
      } else {
        navigate('/listings', { replace: true });
      }
    } catch (err) {
      setSaveState('error');
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not save profile.');
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void finishProfile(answers);
  }

  const incomplete = hydrated && !profileFieldsComplete(answers);
  const statusLine =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? 'Saved to your account.'
        : saveState === 'unsaved'
          ? 'Unsaved changes.'
          : null;

  return (
    <Shell>
      <div className="stack" style={{ maxWidth: '36rem' }}>
        <p className="landing-hero-eyebrow">Renter profile</p>
        <h1>Tell Dwel what you need.</h1>
        <p className="muted">
          This is a short form. When you finish, we email a 6-digit code so the profile stays on
          your account.
        </p>
        {!hydrated && <p className="muted">Loading your saved profile…</p>}
        {accountProfile === 'missing' && hydrated && (
          <p className="muted">No profile is saved on this account yet.</p>
        )}
        {accountProfile === 'load_failed' && (
          <p className="muted">
            Your account profile could not be loaded. This form is showing a browser draft, not the
            saved account.
          </p>
        )}
        {incomplete && <p>This profile is incomplete.</p>}
        {statusLine && <p className={saveState === 'saved' ? undefined : 'muted'}>{statusLine}</p>}
        {error && <ErrorState title="Profile not saved">{error}</ErrorState>}
        {pendingEmail && pendingAnswers && (
          <form
            className="panel form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                setSaveState('saving');
                setError(null);
                try {
                  const verified = await api.verifyEmailCode(pendingEmail, code, 'sign_in');
                  await setSession(verified.session_id);
                  await refresh();
                  const saved = await persistProfile(pendingAnswers);
                  if (!saved) return;
                  setPendingEmail(null);
                  if (pendingAnswers.preferred_state.trim().toUpperCase() === 'NY') {
                    navigate('/screening-choice', { replace: true });
                  } else {
                    navigate('/listings', { replace: true });
                  }
                } catch (err) {
                  setSaveState('error');
                  setError(
                    err instanceof ApiError || err instanceof Error ? err.message : 'That code did not work.',
                  );
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
            <button type="submit" className="btn btn-primary" disabled={saveState === 'saving'}>
              {saveState === 'saving' ? 'Checking…' : 'Continue'}
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
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saveState === 'saving' || Boolean(pendingEmail) || !hydrated}
          >
            {saveState === 'saving' ? 'Saving…' : 'Save profile'}
          </button>
        </form>
        <p>
          <Link to="/listings">Browse homes</Link>
        </p>
      </div>
    </Shell>
  );
}
