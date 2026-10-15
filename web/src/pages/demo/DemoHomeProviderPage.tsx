import { useReducer } from 'react';
import { DemoShell, DemoPanel, DemoKpi } from '../../components/demo/DemoShell';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  DemoDataProvider,
  PIPELINE_LABEL,
  formatRent,
  type DemoApplicant,
  type DemoPipelineStage,
} from '../../lib/demo-data';

const STAGES: DemoPipelineStage[] = [
  'interested',
  'screening_requested',
  'in_progress',
  'ready_to_review',
  'approved',
];

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

/**
 * Public #/demo/home-provider — offline only, no /v1 calls.
 */
export function DemoHomeProviderPage() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const d = DemoDataProvider.getHomeProviderDashboard();

  function act(a: DemoApplicant, action: 'request' | 'consent' | 'complete') {
    if (action === 'request') DemoDataProvider.requestScreening(a.id);
    if (action === 'consent') DemoDataProvider.approveDemoConsent(a.id);
    if (action === 'complete') DemoDataProvider.completeDemoScreening(a.id);
    bump();
  }

  return (
    <DemoShell role="home-provider" orgSubtitle={d.orgName}>
      <div className="mb-6">
        <p className="text-sm text-dwel-gray-500">{d.orgName}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{d.greeting}</h1>
        <p className="mt-2 text-base text-dwel-gray-700">
          <span className="font-semibold text-dwel-gray-900">
            {d.attentionCount} renters need your attention
          </span>
          {' · '}
          {d.screeningReadyCount} screening ready to review
        </p>
      </div>

      <DemoPanel className="mb-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-dwel-gray-500">
          Exposure this month
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <DemoKpi label="Impressions" value={d.exposure.impressions.toLocaleString()} />
          <DemoKpi label="Listing views" value={d.exposure.views.toLocaleString()} />
          <DemoKpi label="Interests" value={d.exposure.interests} />
          <DemoKpi label="Screenings" value={d.exposure.screenings} />
        </div>
        <p className="mt-3 text-sm text-dwel-gray-600">
          View → interest:{' '}
          <span className="font-semibold text-dwel-gray-900">{d.exposure.viewToInterestPct}%</span>
        </p>
      </DemoPanel>

      <DemoPanel className="mb-5">
        <h2 className="text-lg font-semibold">Needs your attention</h2>
        <div className="mt-4 space-y-3">
          {d.attention.map((item) => (
            <div
              key={item.applicant.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dwel-gray-200 bg-dwel-gray-50 px-4 py-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={item.kind === 'screening_ready' ? 'mint' : 'amber'}>
                    {item.title}
                  </Badge>
                </div>
                <p className="mt-1 font-semibold">{item.applicant.renter_label}</p>
                <p className="text-sm text-dwel-gray-500">
                  {item.applicant.listing_name} · {item.applicant.updated_label}
                </p>
              </div>
              {item.kind === 'screening_ready' ? (
                <Button
                  className="!py-2 text-sm"
                  onClick={() => {
                    const el = document.getElementById(`card-${item.applicant.id}`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                >
                  Review →
                </Button>
              ) : (
                <Button className="!py-2 text-sm" onClick={() => act(item.applicant, 'request')}>
                  Request screening →
                </Button>
              )}
            </div>
          ))}
          {d.attention.length === 0 && (
            <p className="text-sm text-dwel-gray-500">You&apos;re caught up.</p>
          )}
        </div>
      </DemoPanel>

      <DemoPanel className="mb-5">
        <h2 className="text-lg font-semibold">Applicant pipeline</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          {STAGES.map((stage) => {
            const cards = d.pipeline[stage];
            return (
              <div key={stage} className="min-w-0 rounded-xl bg-dwel-gray-50 p-3">
                <div className="mb-2 flex items-baseline justify-between gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-dwel-gray-500">
                    {PIPELINE_LABEL[stage]}
                  </p>
                  <span className="text-sm font-semibold">{cards.length}</span>
                </div>
                <div className="space-y-2">
                  {cards.map((a) => (
                    <div
                      id={`card-${a.id}`}
                      key={a.id}
                      className="rounded-lg border border-dwel-gray-200 bg-white p-3 text-sm shadow-sm"
                    >
                      <p className="font-semibold">{a.renter_label}</p>
                      <p className="text-xs text-dwel-gray-500">{a.listing_name}</p>
                      <p className="mt-1 text-xs text-dwel-gray-400">
                        {a.days_in_stage}d in stage · {a.updated_label}
                      </p>
                      <p className="mt-1 text-xs text-dwel-gray-600">{a.prequal}</p>
                      {DemoDataProvider.getResult(a.id) && (
                        <div className="mt-2 rounded-md border border-dwel-mint/40 bg-dwel-mint/10 p-2 text-xs">
                          <p className="font-semibold">DEMO RESULT</p>
                          <p>No real background check was performed.</p>
                        </div>
                      )}
                      <div className="mt-2 flex flex-col gap-1">
                        {a.stage === 'interested' && (
                          <Button className="!py-1.5 text-xs" onClick={() => act(a, 'request')}>
                            Request screening
                          </Button>
                        )}
                        {a.stage === 'screening_requested' && (
                          <Button className="!py-1.5 text-xs" onClick={() => act(a, 'consent')}>
                            Approve demo consent
                          </Button>
                        )}
                        {a.stage === 'in_progress' && (
                          <Button className="!py-1.5 text-xs" onClick={() => act(a, 'complete')}>
                            Complete demo screening
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </DemoPanel>

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <DemoPanel className="lg:col-span-2">
          <h2 className="text-lg font-semibold">Portfolio performance</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-dwel-gray-200 text-xs uppercase tracking-wide text-dwel-gray-500">
                  <th className="py-2 pr-3 font-semibold">Property</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold">Impressions</th>
                  <th className="py-2 pr-3 font-semibold">Views</th>
                  <th className="py-2 pr-3 font-semibold">Interests</th>
                  <th className="py-2 pr-3 font-semibold">Screenings</th>
                  <th className="py-2 font-semibold">Days live</th>
                </tr>
              </thead>
              <tbody>
                {d.listings.map((l) => (
                  <tr key={l.id} className="border-b border-dwel-gray-100">
                    <td className="py-2.5 pr-3 font-medium">{l.name}</td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={l.status === 'LIVE' ? 'mint' : 'amber'}>{l.status}</Badge>
                    </td>
                    <td className="py-2.5 pr-3">{l.impressions.toLocaleString()}</td>
                    <td className="py-2.5 pr-3">{l.views.toLocaleString()}</td>
                    <td className="py-2.5 pr-3">{l.interests}</td>
                    <td className="py-2.5 pr-3">{l.screenings}</td>
                    <td className="py-2.5">{l.days_live}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DemoPanel>

        <DemoPanel>
          <h2 className="text-lg font-semibold">Current billing period</h2>
          <p className="mt-4 text-3xl font-semibold">{money(d.billing.accrued)}</p>
          <p className="text-sm text-dwel-gray-500">accrued</p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-dwel-gray-500">Next invoice</dt>
              <dd className="font-medium">{d.billing.nextInvoice}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-dwel-gray-500">Cost per renter interest</dt>
              <dd className="font-medium">{money(d.billing.costPerInterest)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-dwel-gray-500">Early adopter rate</dt>
              <dd className="font-medium text-dwel-mint-dark">Locked</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-dwel-gray-400">DEMO data only — no Stripe charges.</p>
        </DemoPanel>
      </div>

      <DemoPanel>
        <h2 className="text-lg font-semibold">Alerts</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-dwel-gray-700">
          {d.alerts.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-dwel-gray-400">
          Example listing rents from {formatRent(d.listings[0]?.rent_cents ?? 0)} — sample only.
        </p>
      </DemoPanel>
    </DemoShell>
  );
}
