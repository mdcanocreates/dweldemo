import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { setLandlordVerification } from '../../lib/user-flow-store';

/** userFlow.md — /onboarding/landlord/setup */
export function LandlordSetupPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [orgName, setOrgName] = useState('');
  const [individual, setIndividual] = useState(false);

  function finish() {
    setLandlordVerification('partial');
    setLocation('/dashboard');
  }

  return (
    <div className="min-h-screen bg-dwel-gray-100 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-semibold">Landlord setup</h1>
        <p className="mt-1 text-sm text-dwel-gray-500">
          Lightweight start — full ownership docs are asked only when you act on an applicant.
        </p>
        <Card className="mt-6 space-y-4 p-6">
          {step === 1 && (
            <>
              <h2 className="font-semibold">Identity</h2>
              <Input placeholder="Full legal name" value={name} onChange={(e) => setName(e.target.value)} />
              <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <label className="block text-sm text-dwel-gray-600">
                Government ID (jpg, png, pdf)
                <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="mt-1 block w-full text-sm" />
              </label>
              <p className="text-xs text-dwel-gray-500">
                MFA (TOTP) is required for landlords — enroll on the next screen when backend MFA is
                live.
              </p>
              <Button className="w-full" disabled={!name || !phone} onClick={() => setStep(2)}>
                Next
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <h2 className="font-semibold">Organization</h2>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={individual}
                  onChange={(e) => setIndividual(e.target.checked)}
                />
                Individual owner
              </label>
              {!individual && (
                <Input
                  placeholder="Organization / company name"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                />
              )}
              <p className="text-xs text-dwel-gray-500">
                Pricing cohort is assigned automatically from global account count and locked for
                life (COHORT_1 / 2 / 3).
              </p>
              <Button
                className="w-full"
                disabled={!individual && !orgName.trim()}
                onClick={finish}
              >
                Go to dashboard
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/** userFlow.md — deferred verification gate */
export function LandlordVerificationPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-dwel-gray-100 px-4 py-10">
      <Card className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="text-xl font-semibold">Verify property ownership</h1>
        <p className="text-sm text-dwel-gray-500">
          Before you can review applicants, we need a few more documents. One-time requirement.
        </p>
        <label className="block text-sm">
          Utility bill
          <input type="file" className="mt-1 block w-full text-sm" />
        </label>
        <label className="block text-sm">
          Deed or ownership title
          <input type="file" className="mt-1 block w-full text-sm" />
        </label>
        <Input placeholder="Rental registration number (if applicable)" />
        <Button
          className="w-full"
          onClick={() => {
            setLandlordVerification('complete');
            setLocation('/listings');
          }}
        >
          Submit verification
        </Button>
      </Card>
    </div>
  );
}
