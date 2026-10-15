import { useMemo, useState } from 'react';
import { AdminShell } from '../../components/layout/AdminShell';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

const DEFAULT_TIERS = [
  { tier: 'RS-1', min: 800, max: 1199 },
  { tier: 'RS-2', min: 1200, max: 1599 },
  { tier: 'RS-3', min: 1600, max: 1999 },
  { tier: 'RS-4', min: 2000, max: 2499 },
  { tier: 'RS-5', min: 2500, max: 2999 },
  { tier: 'RS-6', min: 3000, max: 3999 },
  { tier: 'RS-7', min: 4000, max: 5999 },
  { tier: 'RS-8', min: 6000, max: 8999 },
  { tier: 'RS-9', min: 9000, max: 14999 },
  { tier: 'RS-10', min: 15000, max: 24999 },
  { tier: 'RS-11', min: 25000, max: 44999 },
  { tier: 'RS-12', min: 45000, max: null as number | null },
];

export function AdminRsTiersPage() {
  const [tiers] = useState(DEFAULT_TIERS);
  return (
    <AdminShell>
      <h1 className="text-2xl font-semibold">RS tiers</h1>
      <p className="mt-1 text-sm text-dwel-gray-500">
        Rent bands drive listing fee schedule. Edits are versioned server-side.
      </p>
      <div className="mt-6 overflow-x-auto rounded-[10px] border border-dwel-gray-200 bg-dwel-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-dwel-gray-200 bg-dwel-gray-50 text-dwel-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Tier</th>
              <th className="px-4 py-3 font-medium">Min rent</th>
              <th className="px-4 py-3 font-medium">Max rent</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.tier} className="border-b border-dwel-gray-100">
                <td className="px-4 py-3 font-medium">{t.tier}</td>
                <td className="px-4 py-3">${t.min.toLocaleString()}</td>
                <td className="px-4 py-3">{t.max == null ? '∞' : `$${t.max.toLocaleString()}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}

export function AdminMatchReasonsPage() {
  const rows = useMemo(() => {
    try {
      // Dev console logs only for now; structure ready for GET /admin/match-reasons
      return [] as Array<{ renter_id: string; listing_id: string; reasons: string }>;
    } catch {
      return [];
    }
  }, []);

  return (
    <AdminShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Match reasons</h1>
          <p className="mt-1 text-sm text-dwel-gray-500">
            Fair-housing audit log — retain ≥ 3 years. Fields limited to renter-stated prefs.
          </p>
        </div>
        <Button variant="secondary">Export CSV</Button>
      </div>
      <Card className="mt-6 p-6 text-sm text-dwel-gray-500">
        {rows.length === 0
          ? 'No server-side match_reason records yet. Client logs appear in browser console during development.'
          : null}
      </Card>
    </AdminShell>
  );
}

export function AdminLandlordsPage() {
  return (
    <AdminShell>
      <h1 className="text-2xl font-semibold">Landlords</h1>
      <p className="mt-1 text-sm text-dwel-gray-500">
        Cohort, account status, and MFA enrollment.
      </p>
      <Card className="mt-6 overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-dwel-gray-200 bg-dwel-gray-50 text-dwel-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Landlord</th>
              <th className="px-4 py-3 font-medium">Cohort</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">MFA</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-4 text-dwel-gray-500" colSpan={4}>
                Connected when GET /admin/landlords is live.
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </AdminShell>
  );
}

export function AdminCreditsPage() {
  const [amount, setAmount] = useState('');
  const [landlordId, setLandlordId] = useState('');
  return (
    <AdminShell>
      <h1 className="text-2xl font-semibold">Credits & refunds</h1>
      <Card className="mt-6 max-w-md space-y-3 p-5">
        <Input
          placeholder="Landlord ID"
          value={landlordId}
          onChange={(e) => setLandlordId(e.target.value)}
        />
        <Input
          type="number"
          placeholder="Credit amount ($)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button disabled={!landlordId || !amount}>Issue goodwill credit</Button>
        <p className="text-xs text-dwel-gray-500">Requires admin MFA session.</p>
      </Card>
    </AdminShell>
  );
}

export function AdminFlagsPage() {
  const [flags, setFlags] = useState([
    { key: 'engagement_buttons', on: false },
    { key: 'compliance_hold_charging', on: false },
    { key: 'stripe_tax', on: false },
  ]);
  return (
    <AdminShell>
      <h1 className="text-2xl font-semibold">Feature flags</h1>
      <div className="mt-6 space-y-3">
        {flags.map((f) => (
          <Card key={f.key} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{f.key}</p>
              <Badge tone={f.on ? 'mint' : 'gray'}>{f.on ? 'On' : 'Off'}</Badge>
            </div>
            <Button
              variant="secondary"
              className="!py-2 text-sm"
              onClick={() =>
                setFlags((prev) =>
                  prev.map((x) => (x.key === f.key ? { ...x, on: !x.on } : x)),
                )
              }
            >
              Toggle
            </Button>
          </Card>
        ))}
      </div>
    </AdminShell>
  );
}

export function AdminStateRulesPage() {
  return (
    <AdminShell>
      <h1 className="text-2xl font-semibold">State rules</h1>
      <p className="mt-1 text-sm text-dwel-gray-500">
        Screening fee caps for TX, CA, FL. Enforce lower of $30 or state cap.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {['TX', 'CA', 'FL'].map((st) => (
          <Card key={st} className="p-4">
            <p className="font-semibold">{st}</p>
            <p className="mt-2 text-sm text-dwel-gray-500">Cap: $30.00 (default)</p>
          </Card>
        ))}
      </div>
    </AdminShell>
  );
}
