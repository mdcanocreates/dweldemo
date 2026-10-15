import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { api, ApiError } from '../../api/client';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { buildLoginHref, setAuthReturn } from '../../lib/auth-return';

type Prefill = {
  given_name?: string;
  family_name?: string;
  email?: string;
  phone?: string;
  /** When true, do not show or require email (authenticated user). */
  hideEmail?: boolean;
};

type Props = {
  open: boolean;
  listingPath: string;
  listingName: string;
  onClose: () => void;
  prefill?: Prefill;
};

/**
 * Level 1 account capture at intent — name + email + phone (design3.md §9).
 * Soft sheet, not a hard wall. Authenticated users never re-enter email.
 */
export function InterestAuthSheet({
  open,
  listingPath,
  listingName,
  onClose,
  prefill,
}: Props) {
  const [first, setFirst] = useState(prefill?.given_name ?? '');
  const [last, setLast] = useState(prefill?.family_name ?? '');
  const [email, setEmail] = useState(prefill?.email ?? '');
  const [phone, setPhone] = useState(prefill?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFirst(prefill?.given_name ?? '');
    setLast(prefill?.family_name ?? '');
    setEmail(prefill?.email ?? '');
    setPhone(prefill?.phone ?? '');
    setSent(false);
    setError(null);
    setDevToken(null);
  }, [open, prefill?.given_name, prefill?.family_name, prefill?.email, prefill?.phone]);

  if (!open) return null;

  const hideEmail = Boolean(prefill?.hideEmail && (prefill.email || email));

  async function onContinue(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const resolvedEmail = (hideEmail ? prefill?.email || email : email).trim();
    try {
      localStorage.setItem(
        'dwel.pending_profile.v1',
        JSON.stringify({
          given_name: first.trim(),
          family_name: last.trim(),
          email: resolvedEmail,
          phone: phone.trim(),
        }),
      );
    } catch {
      /* ignore */
    }
    setAuthReturn({ returnTo: listingPath, action: 'interest' });

    // Already signed in — close identity sheet; parent resumes interest with pending fields.
    if (hideEmail) {
      setBusy(false);
      onClose();
      window.dispatchEvent(new CustomEvent('dwel:interest-identity-saved'));
      return;
    }

    try {
      const res = await api.magicLink(resolvedEmail, 'sign_in');
      setSent(true);
      if (res.redeem_token) setDevToken(res.redeem_token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start sign-in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-dwel-black/40"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal
        className="relative z-10 w-full max-w-md rounded-t-[20px] border border-dwel-gray-200 bg-dwel-white p-6 shadow-lg sm:rounded-[10px]"
      >
        <h2 className="text-xl font-semibold">
          {hideEmail ? 'Complete your profile' : 'Interested in this home?'}
        </h2>
        <p className="mt-1 text-sm font-medium text-dwel-gray-700">{listingName}</p>
        <p className="mt-2 text-sm text-dwel-gray-500">
          {hideEmail
            ? 'Add the remaining details so we can send your interest.'
            : 'Create your Dwel profile to send your interest and keep track of this home.'}
        </p>

        {sent ? (
          <div className="mt-5 space-y-3 text-sm">
            <div className="rounded-[10px] border border-dwel-mint bg-dwel-mint/15 p-3">
              Check your email — we sent a sign-in link to <strong>{email}</strong>.
            </div>
            {devToken && (
              <Link
                href={`/auth/callback?token=${encodeURIComponent(devToken)}&purpose=sign_in&returnTo=${encodeURIComponent(listingPath)}&action=interest`}
              >
                <Button className="w-full">Continue on this device</Button>
              </Link>
            )}
          </div>
        ) : (
          <form className="mt-5 space-y-3" onSubmit={(e) => void onContinue(e)}>
            <Input
              required
              placeholder="First name"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              disabled={busy}
            />
            <Input
              required
              placeholder="Last name"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              disabled={busy}
            />
            {!hideEmail && (
              <Input
                type="email"
                required
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            )}
            {hideEmail && email && (
              <p className="rounded-[10px] bg-dwel-gray-50 px-3 py-2 text-sm text-dwel-gray-600">
                Signed in as <strong>{email}</strong>
              </p>
            )}
            <Input
              type="tel"
              required
              placeholder="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={busy}
            />
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Saving…' : hideEmail ? 'Continue →' : 'Continue →'}
            </Button>
          </form>
        )}

        {error && <p className="mt-3 text-sm text-dwel-red">{error}</p>}

        <button
          type="button"
          className="mt-4 w-full text-sm font-semibold underline underline-offset-2"
          onClick={onClose}
        >
          Keep browsing
        </button>
        {!hideEmail && (
          <p className="mt-3 text-center text-xs text-dwel-gray-400">
            Already have an account?{' '}
            <Link
              href={buildLoginHref(listingPath, 'interest')}
              className="font-semibold underline"
              onClick={() => setAuthReturn({ returnTo: listingPath, action: 'interest' })}
            >
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
