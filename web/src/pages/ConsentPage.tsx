import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { SandboxCheckout } from '../components/SandboxCheckout';
import { track } from '../lib/analytics';
import { useAuth } from '../auth';
import { readAccessToken } from '../accessToken';
import { ErrorState, Shell } from '../components/Shell';

export function ConsentPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const nyPath2Standalone = params.get('ny_path2') === '1' || id === 'new';
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [copy, setCopy] = useState<{ text: string; is_placeholder: boolean } | null>(null);
  const [feeCents, setFeeCents] = useState(2900);
  const [agreed, setAgreed] = useState(false);
  const [cardOk, setCardOk] = useState(false);
  const [sandbox, setSandbox] = useState<{ enabled: boolean; publishableKey: string | null }>({
    enabled: false,
    publishableKey: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user && nyPath2Standalone) {
      navigate('/');
      return;
    }
    void (async () => {
      const consent = await api.consentCopy();
      setCopy(consent.consent);
      const fee = await api.screeningFee();
      setFeeCents(fee.fee.amount_cents);
      const stripe = await api.stripePaymentConfig();
      setSandbox({
        enabled: stripe.sandbox && Boolean(stripe.publishable_key?.startsWith('pk_test_')),
        publishableKey: stripe.publishable_key,
      });
    })().catch((err) => {
      setError(err instanceof ApiError ? err.message : 'Could not load consent');
    });
  }, [user, loading, navigate, nyPath2Standalone]);

  async function submit(paymentIntentId?: string) {
    if (!agreed || busy) return;
    if (!sandbox.enabled && !cardOk) return;
    setBusy(true);
    setError(null);
    try {
      if (nyPath2Standalone) {
        await api.purchaseNyPath2(paymentIntentId);
        setDone(true);
        setTimeout(() => navigate('/listings'), 800);
        return;
      }
      const access = readAccessToken(id);
      await api.payAndConsent(
        id,
        { agreed: true, ny_path2: params.get('ny_path2') === '1', payment_intent_id: paymentIntentId },
        access ?? undefined,
      );
      setDone(true);
      setTimeout(() => navigate('/applications'), 800);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Payment or consent failed');
    } finally {
      setBusy(false);
    }
  }

  const dollars = (feeCents / 100).toFixed(2);

  return (
    <Shell>
      <p className="section-eyebrow">Screening · FCRA consent</p>
      <h1 className="section-title">Consent & payment</h1>
      {error && <ErrorState title="Could not continue">{error}</ErrorState>}
      {done && <p>Saved. Redirecting…</p>}

      {copy && (
        <div
          className={copy.is_placeholder ? 'placeholder-copy' : 'card'}
          style={{ marginTop: '1rem', padding: copy.is_placeholder ? undefined : '1rem' }}
        >
          {copy.text}
        </div>
      )}

      <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', marginTop: '1rem' }}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>I have read and agree</span>
      </label>

      <section className="card" style={{ padding: '1.1rem', marginTop: '1.25rem', maxWidth: '28rem' }}>
        <p className="section-eyebrow">Payment</p>
        <p style={{ fontFamily: 'var(--font-d)', fontWeight: 700, fontSize: '1.35rem' }}>
          Pay ${dollars} and submit
        </p>
        <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
          This fee is credited toward your first month&apos;s rent if placed through Dwel.
        </p>
        <p className="hint">
          {sandbox.enabled
            ? 'Sandbox checkout. Test cards only. This payment is not real revenue.'
            : 'Use a test card in this sandbox environment.'}
        </p>
        {sandbox.enabled && sandbox.publishableKey ? (
          <SandboxCheckout
            publishableKey={sandbox.publishableKey}
            purpose={nyPath2Standalone ? 'ny_path2_screening' : 'applicant_screening_fee'}
            applicationId={nyPath2Standalone ? undefined : id}
            onPaid={(paymentIntentId) => {
              track('payment_succeeded', { product: 'dwel', sandbox: true });
              track('screening_authorized', { product: 'dwel' });
              void submit(paymentIntentId);
            }}
            onFailed={(message) => {
              track('payment_failed', { product: 'dwel', sandbox: true });
              setError(message);
            }}
          />
        ) : (
          <>
            <div className="field" style={{ marginTop: '0.85rem' }}>
              <label htmlFor="card">Card</label>
              <input
                id="card"
                placeholder="4242 4242 4242 4242"
                onChange={(e) => setCardOk(e.target.value.replace(/\s/g, '').length >= 15)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!agreed || !cardOk || busy}
              onClick={() => void submit()}
            >
              {busy ? 'Processing…' : `Pay $${dollars} and submit`}
            </button>
          </>
        )}
      </section>

      <p style={{ marginTop: '1rem' }}>
        <Link to="/applications">Back to applications</Link>
      </p>
    </Shell>
  );
}
