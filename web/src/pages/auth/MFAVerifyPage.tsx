import { useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

export function MFAVerifyPage() {
  const { user, refresh } = useAuth();
  const [, setLocation] = useLocation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (import.meta.env.VITE_MFA_ENROLLMENT_ENABLED !== 'true') {
    return <Redirect to="/home" />;
  }

  async function onVerify() {
    setBusy(true);
    setError(null);
    try {
      await api.mfaVerify(code);
      await refresh();
      if (user?.role === 'ADMIN') setLocation('/admin');
      else if (user?.role === 'LANDLORD') setLocation('/landlord');
      else setLocation('/dashboard');
    } catch {
      setError('Invalid code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-dwel-gray-100 px-4 py-10">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">Confirm it&apos;s you</h1>
        <p className="mt-2 text-sm text-dwel-gray-500">
          Enter the code from your authenticator app, or use your passkey.
        </p>
        <label className="mt-6 block text-sm font-medium text-dwel-gray-600">
          Authentication code
          <Input
            className="mt-1.5"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
          />
        </label>
        {error && <p className="mt-3 text-sm text-dwel-red">{error}</p>}
        <Button className="mt-6 w-full" disabled={busy} onClick={() => void onVerify()}>
          Continue
        </Button>
      </Card>
    </div>
  );
}
