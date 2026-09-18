import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { FrogPageLoader } from '../components/FrogPageLoader';
import { GuidedChat } from '../components/GuidedChat';
import { ErrorState, Shell } from '../components/Shell';
import { useDelayedPending } from '../hooks/useDelayedPending';
import {
  answersToProfilePayload,
  loadAnswers,
  profileComplete,
  saveAnswers,
  type RenterAnswers,
} from '../intake/answers';

/** Homepage — matching profile chat locked beside hero (viewport-pinned). */
export function HomePage() {
  const { user, setSession, refresh } = useAuth();
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<RenterAnswers>(() => loadAnswers());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(() => profileComplete(loadAnswers()) && Boolean(user));
  const showFrog = useDelayedPending(busy, 400);

  const persist = useCallback((next: RenterAnswers) => {
    setAnswers(next);
    saveAnswers(next);
  }, []);

  async function finishProfile(next: RenterAnswers) {
    setBusy(true);
    setError(null);
    saveAnswers({ ...next, profile_complete: true });
    try {
      if (!user) {
        const magic = await api.magicLink(next.email.trim(), 'sign_in');
        if (!magic.redeem_token) {
          throw new Error('Check your email for a private link, then return here to finish.');
        }
        const redeemed = await api.redeem(magic.redeem_token, 'sign_in');
        await setSession(redeemed.session_id);
        await refresh();
      }
      const profile = await api.upsertRenterProfile(answersToProfilePayload(next));
      setDone(true);
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

  if (showFrog) {
    return (
      <Shell>
        <FrogPageLoader />
      </Shell>
    );
  }

  return (
    <Shell lockViewport>
      <div className="hero-chat-section">
        <section className="hero-panel home-hero-dark">
          <div className="home-hero-glow" aria-hidden />
          <div className="home-hero-art" aria-hidden>
            <svg className="hero-line-art" viewBox="0 0 420 320" fill="none">
              <path
                d="M40 260 C90 200, 130 220, 160 180 C190 140, 210 100, 250 90 C290 80, 310 120, 340 110"
                stroke="currentColor"
                strokeWidth="1.5"
                opacity="0.45"
              />
              <path d="M70 250 V180 H120 V250" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
              <path d="M80 200 H110 M80 220 H110" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
              <path
                d="M200 250 L230 210 H290 L320 250 Z M230 210 V190 H290 V210"
                stroke="currentColor"
                strokeWidth="1.5"
                opacity="0.55"
              />
              <circle cx="360" cy="70" r="18" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
              <path d="M352 70 H368 M360 62 V78" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
            </svg>
          </div>
          <div className="home-hero-inner">
            <h1 className="home-hero-title">
              Move with
              <br />
              <span>more back.</span>
            </h1>
            <p className="home-hero-copy">
              Tell Dwel what you need — we save your profile with a private link, then you browse and
              apply without re-entering the basics.
            </p>
            <div className="home-hero-actions">
              <a className="btn btn-primary" href="#dwel-chat">
                Start matching
              </a>
              <Link className="btn btn-ghost-on-dark" to="/landlords">
                For landlords
              </Link>
            </div>
          </div>
        </section>
        <section className="chat-panel">
          {done ? (
            <div className="panel stack chat-done">
              <h2 className="font-display" style={{ fontSize: '1.5rem' }}>
                You&apos;re ready to browse.
              </h2>
              <p className="muted">
                Your matching preferences are saved. When you find a home, screening happens after you
                express interest.
              </p>
              <Link className="btn btn-primary" to="/listings">
                Find a home
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div style={{ padding: '0.75rem 1rem 0', flexShrink: 0 }}>
                  <ErrorState title="Could not save profile">{error}</ErrorState>
                </div>
              )}
              <GuidedChat
                mode="profile"
                initialAnswers={answers}
                busy={busy}
                onAnswersChange={persist}
                onComplete={(a) => void finishProfile(a)}
              />
            </>
          )}
        </section>
      </div>
    </Shell>
  );
}
