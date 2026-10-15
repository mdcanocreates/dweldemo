import { useReducer, useState } from 'react';
import { DemoShell, DemoPanel } from '../../components/demo/DemoShell';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { DemoDataProvider, formatRent, PIPELINE_LABEL } from '../../lib/demo-data';

/**
 * Public #/demo/renter — offline returning-renter dashboard.
 * No /v1, auth, Stripe, Certn, or SES.
 */
export function DemoRenterPage() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [query, setQuery] = useState('');
  const [screeningOpen, setScreeningOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const d = DemoDataProvider.getRenterDashboard();
  const listings = DemoDataProvider.getListings().filter((l) => l.status === 'LIVE');
  const filtered = query.trim()
    ? listings.filter(
        (l) =>
          l.name.toLowerCase().includes(query.toLowerCase()) ||
          l.city.toLowerCase().includes(query.toLowerCase()),
      )
    : listings;

  const actionApp = d.actionRequired
    ? DemoDataProvider.getApplicants().find((a) => a.id === d.actionRequired!.applicantId)
    : null;

  function runConsent() {
    if (!d.actionRequired) return;
    DemoDataProvider.approveDemoConsent(d.actionRequired.applicantId);
    setScreeningOpen(false);
    setConsentChecked(false);
    bump();
  }

  function completeFromRenter() {
    if (!d.actionRequired) return;
    const a = DemoDataProvider.getApplicants().find((x) => x.id === d.actionRequired!.applicantId);
    if (a?.stage === 'screening_requested') {
      DemoDataProvider.approveDemoConsent(a.id);
    }
    const after = DemoDataProvider.getApplicants().find((x) => x.id === d.actionRequired!.applicantId);
    if (after?.stage === 'in_progress') {
      DemoDataProvider.completeDemoScreening(after.id);
    }
    bump();
  }

  return (
    <DemoShell role="renter" orgSubtitle="Jordan M.">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back, {d.name}</h1>
        {d.actionRequired && (
          <p className="mt-2 text-base text-dwel-gray-700">
            <span className="font-semibold">1 application needs your attention</span>
          </p>
        )}
      </div>

      {d.actionRequired && (
        <DemoPanel className="mb-5 border-dwel-mint/40 bg-dwel-mint/10">
          <Badge tone="mint">Action required</Badge>
          <h2 className="mt-2 text-xl font-semibold">{d.actionRequired.title}</h2>
          <p className="text-sm text-dwel-gray-600">{d.actionRequired.listing}</p>
          {actionApp && (
            <p className="mt-1 text-xs text-dwel-gray-500">
              Status: {PIPELINE_LABEL[actionApp.stage]}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                if (actionApp?.stage === 'screening_requested') setScreeningOpen(true);
                else completeFromRenter();
              }}
            >
              {d.actionRequired.cta}
            </Button>
            {actionApp?.stage === 'in_progress' && (
              <Button variant="secondary" onClick={() => completeFromRenter()}>
                Complete demo screening
              </Button>
            )}
          </div>
          {DemoDataProvider.getResult(d.actionRequired.applicantId) && (
            <div className="mt-4 rounded-lg border border-dwel-mint/50 bg-white p-3 text-sm">
              <p className="font-semibold uppercase tracking-wide">DEMO RESULT</p>
              <p className="text-dwel-gray-600">No real background check was performed.</p>
            </div>
          )}
        </DemoPanel>
      )}

      {screeningOpen && (
        <DemoPanel className="mb-5">
          <h2 className="text-lg font-semibold">Approve demo screening</h2>
          <p className="mt-2 text-sm text-dwel-gray-600">
            DEMO CONSENT — provisional walkthrough only. No consumer report will be obtained. No
            Stripe charge.
          </p>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
            />
            <span>
              I approve this demo screening for {d.actionRequired?.listing} (no real background
              check).
            </span>
          </label>
          <div className="mt-4 flex gap-2">
            <Button disabled={!consentChecked} onClick={runConsent}>
              Approve demo screening
            </Button>
            <Button variant="ghost" onClick={() => setScreeningOpen(false)}>
              Cancel
            </Button>
          </div>
        </DemoPanel>
      )}

      <DemoPanel className="mb-5">
        <h2 className="text-lg font-semibold">Continue looking</h2>
        <div className="mt-3 flex gap-2">
          <Input
            placeholder="Search Austin, Dallas, neighborhood…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
          />
          <Button variant="secondary" type="button">
            Search
          </Button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.slice(0, 6).map((l) => (
            <div
              key={l.id}
              className="overflow-hidden rounded-xl border border-dwel-gray-200 bg-white"
            >
              <img src={l.photo} alt="" className="h-28 w-full object-cover" />
              <div className="p-3">
                <p className="font-semibold">{l.name}</p>
                <p className="text-sm text-dwel-gray-500">
                  {l.city}, {l.state} · {formatRent(l.rent_cents)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </DemoPanel>

      <DemoPanel className="mb-5">
        <h2 className="text-lg font-semibold">Saved homes</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {d.saved.map((l) => (
            <div key={l.id} className="rounded-xl border border-dwel-gray-200 bg-white p-3">
              <img src={l.photo} alt="" className="mb-2 h-24 w-full rounded-lg object-cover" />
              <p className="font-semibold">{l.name}</p>
              <p className="text-sm text-dwel-gray-500">{formatRent(l.rent_cents)}</p>
            </div>
          ))}
        </div>
      </DemoPanel>

      <div className="grid gap-5 lg:grid-cols-2">
        <DemoPanel>
          <h2 className="text-lg font-semibold">Your applications</h2>
          <ul className="mt-4 space-y-3">
            {d.applications.map((app) => (
              <li
                key={app.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-dwel-gray-200 px-3 py-3"
              >
                <div>
                  <p className="font-semibold">{app.listing}</p>
                  <p className="text-sm text-dwel-gray-500">{app.status}</p>
                </div>
                <Badge tone={app.stage === 'screening_requested' ? 'amber' : 'neutral'}>
                  {app.status}
                </Badge>
              </li>
            ))}
          </ul>
        </DemoPanel>

        <DemoPanel>
          <h2 className="text-lg font-semibold">Recently viewed</h2>
          <ul className="mt-4 space-y-3">
            {d.recentlyViewed.map((l) => (
              <li key={l.id} className="flex gap-3 rounded-lg border border-dwel-gray-200 p-2">
                <img src={l.photo} alt="" className="h-14 w-20 rounded-md object-cover" />
                <div>
                  <p className="font-semibold">{l.name}</p>
                  <p className="text-sm text-dwel-gray-500">
                    {l.city} · {formatRent(l.rent_cents)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </DemoPanel>
      </div>
    </DemoShell>
  );
}
