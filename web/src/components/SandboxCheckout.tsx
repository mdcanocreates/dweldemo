import { useMemo, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { api } from '../api';
import { track } from '../lib/analytics';

function CheckoutForm({
  onPaid,
  onFailed,
}: {
  onPaid: (paymentIntentId: string) => void;
  onFailed: (message: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    const result = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });
    setBusy(false);
    if (result.error) {
      onFailed(result.error.message ?? 'Sandbox payment failed');
      return;
    }
    const intent = result.paymentIntent;
    if (!intent || intent.status !== 'succeeded') {
      onFailed('Sandbox payment was not completed');
      return;
    }
    onPaid(intent.id);
  }

  return (
    <div className="stack">
      <PaymentElement />
      <button type="button" className="btn btn-primary" disabled={!stripe || busy} onClick={() => void pay()}>
        {busy ? 'Checking test payment…' : 'Submit sandbox payment'}
      </button>
    </div>
  );
}

export function SandboxCheckout({
  publishableKey,
  purpose,
  applicationId,
  onPaid,
  onFailed,
}: {
  publishableKey: string;
  purpose: 'applicant_screening_fee' | 'ny_path2_screening';
  applicationId?: string;
  onPaid: (paymentIntentId: string) => void;
  onFailed: (message: string) => void;
}) {
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const created = await api.createSandboxPaymentIntent({
        purpose,
        application_id: applicationId,
      });
      track('payment_started', { product: 'dwel', sandbox: true, purpose });
      setClientSecret(created.client_secret);
    } catch (err) {
      onFailed(err instanceof Error ? err.message : 'Could not start sandbox payment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="hint">Sandbox checkout. Test cards only. This is not a real payment and is not recorded as revenue.</p>
      {!clientSecret ? (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void start()}>
          {busy ? 'Starting…' : 'Continue sandbox checkout'}
        </button>
      ) : (
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <CheckoutForm onPaid={onPaid} onFailed={onFailed} />
        </Elements>
      )}
    </div>
  );
}
