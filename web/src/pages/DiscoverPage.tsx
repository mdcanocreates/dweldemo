import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  serverProfileSaved,
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
    'household_size',
  ];
  return keys.every((key) => a[key] === b[key]);
}

/** Renter profile form. Account fields load from the server when a session exists. */
export function DiscoverPage() {
  const { user, loading, setSession, refresh } = useAuth();
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<RenterAnswers>(() => loadAnswers());
  const answersRef = useRef(answers);
  const editGeneration = useRef(0);
  function remember(next: RenterAnswers) {
    answersRef.current = next;
    setAnswers(next);
  }
  const [baseline, setBaseline] = useState<RenterAnswers>(() => loadAnswers());
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [accountProfile, setAccountProfile] = useState<AccountProfile>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingAnswers, setPendingAnswers] = useState<RenterAnswers | null>(null);
  const [code, setCode] = useState('');
  const profileRevision = useRef<string | null>(null);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    const generation = editGeneration.current;
    (async () => {
      const local = loadAnswers();
      if (!user) {
        if (cancelled) return;
        remember(local);
        setBaseline(local);
        setAccountProfile('unknown');
        setHydrated(true);
        setSaveState('unsaved');
        return;
      }
      try {
        const data = await api.getRenterProfile();
        if (cancelled || editGeneration.current !== generation) return;
        const merged = mergeServerRecords(local, data.profile, null);
        const savedOnAccount = serverProfileSaved(data.profile);
        profileRevision.current = data.profile.updated_at;
        remember(merged);
        setBaseline(merged);
        saveAnswers(merged);
        setAccountProfile(savedOnAccount ? 'loaded' : 'missing');
        setSaveState(savedOnAccount ? 'saved' : 'unsaved');
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          remember(local);
          setBaseline(local);
          setAccountProfile('missing');
          setSaveState('unsaved');
          setError(null);
        } else {
          remember(local);
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
    editGeneration.current += 1;
    const next = { ...answersRef.current, [key]: value, profile_complete: false };
    remember(next);
    saveAnswers(next);
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
    let profile: { profile: Parameters<typeof mergeServerRecords>[1] & { updated_at?: string } };
    try {
      profile = await api.upsertRenterProfile(
        answersToProfilePayload(next, profileRevision.current),
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'profile_conflict') {
        const saved = (err.details as { profile?: Parameters<typeof mergeServerRecords>[1] } | null)
          ?.profile;
        if (saved) {
          profileRevision.current = saved.updated_at ?? null;
          const merged = mergeServerRecords(next, saved, null);
          saveAnswers(merged);
          remember(merged);
          setBaseline(merged);
        }
        setSaveState('error');
        setAccountProfile('loaded');
        setError('This profile was saved in another session. The form now shows the saved account.');
        return false;
      }
      throw err;
    }
    profileRevision.current = profile.profile.updated_at ?? null;
    const merged = mergeServerRecords(next, profile.profile, null);
    saveAnswers(merged);
    remember(merged);
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

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const value = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    const next = {
      ...answersRef.current,
      given_name: value('given_name'),
      family_name: value('family_name'),
      phone: value('phone'),
      email: value('email'),
      move_in_urgency: value('move_in_urgency'),
      rent_max_dollars: value('rent_max_dollars'),
      bedrooms_min: value('bedrooms_min'),
      preferred_state: value('preferred_state').toUpperCase(),
      has_pets: (form.elements.namedItem('has_pets') as HTMLInputElement | null)?.checked ?? false,
      household_size: value('household_size'),
    };
    answersRef.current = next;
    void finishProfile(next);
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
              name="given_name"
              required
              value={answers.given_name ?? ''}
              onChange={(e) => setField('given_name', e.target.value)}
            />
          </label>
          <label>
            Last name
            <input
              name="family_name"
              required
              value={answers.family_name ?? ''}
              onChange={(e) => setField('family_name', e.target.value)}
            />
          </label>
          <label>
            Phone
            <input
              name="phone"
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
              name="email"
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
              name="move_in_urgency"
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
              name="rent_max_dollars"
              required
              inputMode="decimal"
              value={answers.rent_max_dollars ?? ''}
              onChange={(e) => setField('rent_max_dollars', e.target.value)}
            />
          </label>
          <label>
            Minimum bedrooms
            <input
              name="bedrooms_min"
              required
              inputMode="numeric"
              value={answers.bedrooms_min ?? ''}
              onChange={(e) => setField('bedrooms_min', e.target.value)}
            />
          </label>
          <label>
            Household size
            <input
              name="household_size"
              required
              inputMode="numeric"
              min={1}
              value={answers.household_size ?? ''}
              onChange={(e) => setField('household_size', e.target.value)}
            />
          </label>
          <label>
            State
            <input
              name="preferred_state"
              required
              maxLength={2}
              value={answers.preferred_state ?? ''}
              onChange={(e) => setField('preferred_state', e.target.value.toUpperCase())}
              placeholder="TX"
            />
          </label>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              name="has_pets"
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
