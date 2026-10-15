import { useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

/**
 * MFA enrollment — gated OFF until backend enrollment/verify exists.
 * Enable with VITE_MFA_ENROLLMENT_ENABLED=true.
 */
export function MFAEnrollPage() {
  const { user, refresh } = useAuth();
  const [, setLocation] = useLocation();
  const [method, setMethod] = useState<'totp' | 'passkey'>('totp');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (import.meta.env.VITE_MFA_ENROLLMENT_ENABLED !== 'true') {
    if (user?.role === 'ADMIN') return <Redirect to="/admin" />;
    if (user?.role === 'LANDLORD') return <Redirect to="/dashboard" />;
    if (user?.role === 'BROKER') return <Redirect to="/broker/dashboard" />;
    return <Redirect to="/home" />;
  }

  async function beginEnroll(next: 'totp' | 'passkey') {
    setMethod(next);
    setBusy(true);
    setError(null);
    try {
      const res = await api.mfaEnroll(next);
      setSecret(res.secret);
    } catch {
      setError('Could not start MFA enrollment. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await api.mfaVerify(code || '000000');
      // Until backend persists mfa_enrolled, refresh and continue; gate uses API field when live.
      await refresh();
      if (user?.role === 'ADMIN') setLocation('/admin');
      else if (user?.role === 'LANDLORD') setLocation('/landlord');
      else setLocation('/dashboard');
    } catch {
      setError('Verification failed. Check the code and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-dwel-gray-100 px-4 py-10">
      <Card className="w-full max-w-lg p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">Secure your account</h1>
        <p className="mt-2 text-sm text-dwel-gray-500">
          Landlord and admin accounts require two-factor authentication to protect payment
          information and applicant data. This step cannot be skipped.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            variant={method === 'totp' ? 'primary' : 'secondary'}
            onClick={() => void beginEnroll('totp')}
            disabled={busy}
          >
            Authenticator app
          </Button>
          <Button
            variant={method === 'passkey' ? 'primary' : 'secondary'}
            onClick={() => void beginEnroll('passkey')}
            disabled={busy}
          >
            Passkey
          </Button>
        </div>

        {method === 'totp' && (
          <div className="mt-6 space-y-3 text-sm text-dwel-gray-600">
            <p>Scan the QR code in your authenticator app, or enter the key manually.</p>
            {secret && (
              <p className="rounded-[10px] border border-dwel-gray-200 bg-dwel-gray-50 p-3 font-mono text-xs break-all">
                {secret}
              </p>
            )}
            <label className="block font-medium">
              Verification code
              <Input
                className="mt-1.5"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6-digit code"
              />
            </label>
          </div>
        )}

        {method === 'passkey' && (
          <p className="mt-6 text-sm text-dwel-gray-600">
            Passkey registration uses WebAuthn. Backend challenge wiring lands with the MFA API —
            the enroll button exercises the client contract.
          </p>
        )}

        {error && <p className="mt-4 text-sm text-dwel-red">{error}</p>}

        <Button className="mt-6 w-full" disabled={busy} onClick={() => void verify()}>
          Verify and continue
        </Button>
      </Card>
    </div>
  );
}
