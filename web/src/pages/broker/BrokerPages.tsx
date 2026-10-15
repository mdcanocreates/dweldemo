import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { RoleEntryPage } from '../../components/layout/RoleEntryPage';
import {
  getBrokerVerification,
  setBrokerVerification,
} from '../../lib/user-flow-store';

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH',
  'OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

/** userFlow.md — /onboarding/broker/verify */
export function BrokerVerifyPage() {
  const [, setLocation] = useLocation();
  const [license, setLicense] = useState('');
  const [state, setState] = useState('TX');
  const [licenseType, setLicenseType] = useState<'broker' | 'salesperson'>('broker');
  const [supervisorName, setSupervisorName] = useState('');
  const [supervisorLicense, setSupervisorLicense] = useState('');

  function submit() {
    setBrokerVerification('pending');
    setLocation('/onboarding/broker/pending');
  }

  return (
    <div className="min-h-screen bg-dwel-gray-100 px-4 py-10">
      <Card className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Broker verification</h1>
        <p className="text-sm text-dwel-gray-500">
          License verification is required before you can manage Home Providers. Target turnaround 24–48
          hours (manual Phase 1).
        </p>
        <Input
          placeholder="State license number"
          value={license}
          onChange={(e) => setLicense(e.target.value)}
        />
        <label className="block text-sm">
          Issuing state
          <select
            className="mt-1 h-12 w-full rounded-lg border border-dwel-gray-300 px-4"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          License type
          <select
            className="mt-1 h-12 w-full rounded-lg border border-dwel-gray-300 px-4"
            value={licenseType}
            onChange={(e) => setLicenseType(e.target.value as 'broker' | 'salesperson')}
          >
            <option value="broker">Broker</option>
            <option value="salesperson">Salesperson / Agent</option>
          </select>
        </label>
        {licenseType === 'salesperson' && (
          <>
            <Input
              placeholder="Supervising broker-of-record name"
              value={supervisorName}
              onChange={(e) => setSupervisorName(e.target.value)}
            />
            <Input
              placeholder="Supervising broker license number"
              value={supervisorLicense}
              onChange={(e) => setSupervisorLicense(e.target.value)}
            />
          </>
        )}
        <label className="block text-sm">
          Government ID
          <input type="file" className="mt-1 block w-full text-sm" />
        </label>
        <Button className="w-full" disabled={!license} onClick={submit}>
          Submit for verification
        </Button>
      </Card>
    </div>
  );
}

export function BrokerPendingPage() {
  const status = getBrokerVerification();
  return (
    <div className="flex min-h-screen items-center justify-center bg-dwel-gray-100 px-4">
      <Card className="max-w-md space-y-4 p-6 text-center">
        <h1 className="text-xl font-semibold">Verification in progress</h1>
        <p className="text-sm text-dwel-gray-500">
          Status: <strong>{status}</strong>. Estimated turnaround 24–48 hours.
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            setBrokerVerification('verified');
            window.location.hash = '#/broker/dashboard';
          }}
        >
          Simulate approval (dev)
        </Button>
        <Link href="/" className="block text-sm font-semibold underline">
          Home
        </Link>
      </Card>
    </div>
  );
}

export function BrokersMarketingPage() {
  return (
    <RoleEntryPage
      role="broker"
      title="Dwel for brokers"
      body="Invite Home Providers, manage listings as a delegate, and review pre-qualified renter interest across your portfolio."
      bullets={[
        'Invite Home Providers with a pre-set provider role',
        'Manage listings and applicants as a delegate',
        'No broker placement fee in Phase 1',
      ]}
    />
  );
}
