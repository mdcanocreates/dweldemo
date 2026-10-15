import { useState } from 'react';
import { DemoShell, DemoPanel, DemoKpi } from '../../components/demo/DemoShell';
import { BrokerAckGate } from '../../components/broker/BrokerAckModal';
import { Badge } from '../../components/ui/Badge';
import {
  DemoDataProvider,
  PIPELINE_LABEL,
  type DemoPipelineStage,
} from '../../lib/demo-data';
import {
  getPublicDemoBrokerAck,
  setPublicDemoBrokerAck,
} from '../../lib/demo-store';

const STAGES: DemoPipelineStage[] = [
  'interested',
  'screening_requested',
  'in_progress',
  'ready_to_review',
  'approved',
];

/**
 * Public #/demo/broker — offline portfolio oversight + glass ack.
 * No /v1, Certn, Stripe, or SES.
 */
export function DemoBrokerPage() {
  const [acked, setAcked] = useState(() => getPublicDemoBrokerAck());
  const d = DemoDataProvider.getBrokerDashboard();

  const byStage = Object.fromEntries(
    STAGES.map((s) => [s, d.applicants.filter((a) => a.stage === s)]),
  ) as Record<DemoPipelineStage, typeof d.applicants>;

  return (
    <BrokerAckGate
      needsAck={!acked}
      demo
      onAccepted={() => {
        setPublicDemoBrokerAck();
        setAcked(true);
      }}
      onSignOut={() => {
        window.location.hash = '#/';
      }}
    >
      <DemoShell role="broker" orgSubtitle={d.orgName}>
        <div className="mb-6">
          <p className="text-sm text-dwel-gray-500">{d.orgName}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Portfolio overview</h1>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <DemoKpi label="Properties" value={d.kpis.properties} />
          <DemoKpi label="Home providers" value={d.kpis.homeProviders} />
          <DemoKpi label="Renter interests" value={d.kpis.interests} />
          <DemoKpi label="Screenings" value={d.kpis.screenings} />
          <DemoKpi label="Awaiting owner decision" value={d.kpis.awaitingOwnerDecision} />
        </div>

        <DemoPanel className="mb-5">
          <h2 className="text-lg font-semibold">Needs attention</h2>
          <ul className="mt-3 space-y-2 text-sm text-dwel-gray-700">
            {d.actionCenter.map((item) => (
              <li
                key={item}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-medium text-amber-900"
              >
                {item}
              </li>
            ))}
          </ul>
        </DemoPanel>

        <DemoPanel className="mb-5">
          <h2 className="text-lg font-semibold">Managed providers</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-dwel-gray-200 text-xs uppercase tracking-wide text-dwel-gray-500">
                  <th className="py-2 pr-3 font-semibold">Provider</th>
                  <th className="py-2 pr-3 font-semibold">Listings</th>
                  <th className="py-2 pr-3 font-semibold">Views</th>
                  <th className="py-2 pr-3 font-semibold">Interests</th>
                  <th className="py-2 pr-3 font-semibold">Screenings</th>
                  <th className="py-2 font-semibold">Needs attention</th>
                </tr>
              </thead>
              <tbody>
                {d.providers.map((p) => (
                  <tr key={p.id} className="border-b border-dwel-gray-100">
                    <td className="py-2.5 pr-3 font-medium">{p.name}</td>
                    <td className="py-2.5 pr-3">{p.listings}</td>
                    <td className="py-2.5 pr-3">{p.views.toLocaleString()}</td>
                    <td className="py-2.5 pr-3">{p.interests}</td>
                    <td className="py-2.5 pr-3">{p.screenings}</td>
                    <td className="py-2.5">
                      {p.needs_attention > 0 ? (
                        <Badge tone="amber">{p.needs_attention}</Badge>
                      ) : (
                        <span className="text-dwel-gray-400">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DemoPanel>

        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          <DemoPanel>
            <h2 className="text-lg font-semibold">Portfolio funnel</h2>
            <ol className="mt-4 space-y-0 text-sm">
              {(
                [
                  ['Impressions', d.funnel.impressions],
                  ['Listing views', d.funnel.views],
                  ['Renter interests', d.funnel.interests],
                  ['Screenings', d.funnel.screenings],
                  ['Awaiting decision', d.funnel.awaitingDecision],
                ] as const
              ).map(([label, value], i, arr) => (
                <li key={label} className="flex flex-col items-start">
                  <div className="flex w-full items-center justify-between rounded-lg border border-dwel-gray-200 bg-dwel-gray-50 px-3 py-2">
                    <span className="text-dwel-gray-600">{label}</span>
                    <span className="font-semibold">{value.toLocaleString()}</span>
                  </div>
                  {i < arr.length - 1 && (
                    <span className="my-1 pl-4 text-dwel-gray-400" aria-hidden>
                      ↓
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </DemoPanel>

          <DemoPanel>
            <h2 className="text-lg font-semibold">Recent activity</h2>
            <ul className="mt-4 space-y-3 text-sm">
              {d.activity.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 border-b border-dwel-gray-100 pb-2">
                  <span>{a.text}</span>
                  <span className="shrink-0 text-dwel-gray-400">{a.when}</span>
                </li>
              ))}
            </ul>
          </DemoPanel>
        </div>

        <DemoPanel className="mb-5">
          <h2 className="text-lg font-semibold">Applicant activity</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-5">
            {STAGES.map((stage) => (
              <div key={stage} className="rounded-xl bg-dwel-gray-50 p-3">
                <div className="mb-2 flex justify-between text-xs font-semibold uppercase tracking-wide text-dwel-gray-500">
                  <span>{PIPELINE_LABEL[stage]}</span>
                  <span>{byStage[stage].length}</span>
                </div>
                <div className="space-y-2">
                  {byStage[stage].slice(0, 3).map((a) => (
                    <div
                      key={a.id}
                      className="rounded-lg border border-dwel-gray-200 bg-white p-2 text-xs"
                    >
                      <p className="font-semibold">{a.renter_label}</p>
                      <p className="text-dwel-gray-500">{a.listing_name}</p>
                      <p className="text-dwel-gray-400">{a.provider_name}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DemoPanel>

        <DemoPanel className="mb-5">
          <h2 className="text-lg font-semibold">Listing performance</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-dwel-gray-200 text-xs uppercase tracking-wide text-dwel-gray-500">
                  <th className="py-2 pr-3 font-semibold">Listing</th>
                  <th className="py-2 pr-3 font-semibold">Provider</th>
                  <th className="py-2 pr-3 font-semibold">Views</th>
                  <th className="py-2 pr-3 font-semibold">Interests</th>
                  <th className="py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.listings.slice(0, 8).map((l) => (
                  <tr key={l.id} className="border-b border-dwel-gray-100">
                    <td className="py-2.5 pr-3 font-medium">{l.name}</td>
                    <td className="py-2.5 pr-3 text-dwel-gray-600">{l.provider_name}</td>
                    <td className="py-2.5 pr-3">{l.views.toLocaleString()}</td>
                    <td className="py-2.5 pr-3">{l.interests}</td>
                    <td className="py-2.5">
                      <Badge tone={l.status === 'LIVE' ? 'mint' : 'amber'}>{l.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DemoPanel>

        <div className="grid gap-5 lg:grid-cols-2">
          <DemoPanel>
            <h2 className="text-lg font-semibold">Pending provider invitations</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {d.invitations.pending.map((inv) => (
                <li
                  key={inv.id}
                  className="flex justify-between rounded-lg border border-dwel-gray-200 px-3 py-2"
                >
                  <span className="font-medium">{inv.name}</span>
                  <span className="text-dwel-gray-400">Sent {inv.sent}</span>
                </li>
              ))}
            </ul>
          </DemoPanel>
          <DemoPanel>
            <h2 className="text-lg font-semibold">Active provider relationships</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {d.invitations.active.map((name) => (
                <li key={name} className="rounded-lg border border-dwel-gray-200 px-3 py-2 font-medium">
                  {name}
                </li>
              ))}
            </ul>
          </DemoPanel>
        </div>
      </DemoShell>
    </BrokerAckGate>
  );
}
