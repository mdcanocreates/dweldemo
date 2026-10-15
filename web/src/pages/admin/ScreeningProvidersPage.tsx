import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '../../components/layout/AdminShell';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { api, ApiError, getSessionToken } from '../../api/client';

type ProviderRow = {
  provider: string;
  infrastructureReady: boolean;
  reason: string | null;
  mode: string | null;
  selectable: boolean;
};

type ComparisonPayload = {
  scenarios: Array<{ key: string; provider: string; label: string }>;
  infrastructure: Record<string, { infrastructureReady: boolean; reason: string | null }>;
  runs: Array<{
    id: string;
    scenario_key: string;
    provider: string;
    screening_status: string | null;
    request_latency_ms: number | null;
    webhook_received: boolean;
    report_available: boolean;
    error_code: string | null;
    created_at: string;
  }>;
  report: {
    by_provider: Record<
      string,
      {
        runs: number;
        errors: number;
        avg_latency_ms: number | null;
        webhooks: number;
        reports: number;
      }
    >;
  };
};

/**
 * Internal admin: select default screening provider + comparison dashboard.
 * Production remains disabled until explicitly approved (selected_provider=disabled by default).
 */
export function AdminScreeningProvidersPage() {
  const [selected, setSelected] = useState<string>('disabled');
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [history, setHistory] = useState<
    Array<{ previous_value: string; new_value: string; created_at: string; actor_party_id: string }>
  >([]);
  const [comparison, setComparison] = useState<ComparisonPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!getSessionToken()) return;
    setError(null);
    try {
      const [cfg, hist, cmp] = await Promise.all([
        api.adminScreeningProviders(),
        api.adminScreeningProviderHistory(),
        api.adminScreeningComparison(),
      ]);
      setSelected(cfg.selected);
      setProviders(cfg.providers);
      setHistory(hist.changes);
      setComparison(cmp);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load screening providers.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function selectProvider(provider: 'certn' | 'checkr_tenant' | 'disabled') {
    setBusy(true);
    setError(null);
    try {
      await api.adminSetScreeningProvider(provider);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update provider.');
    } finally {
      setBusy(false);
    }
  }

  async function probe(provider: 'certn' | 'checkr_tenant') {
    setBusy(true);
    setError(null);
    try {
      await api.adminProbeScreeningProvider(provider);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Probe failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <h1 className="text-2xl font-semibold">Screening providers</h1>
      <p className="mt-1 text-sm text-dwel-gray-500">
        Server-side default for new screenings. Existing orders stay bound to their original
        provider. Infrastructure enablement is env-gated; only ready providers are selectable.
        Production stays <strong>disabled</strong> until explicitly approved.
      </p>

      {error ? (
        <Card className="mt-4 border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</Card>
      ) : null}

      <Card className="mt-6 p-6">
        <h2 className="text-lg font-semibold">Default provider</h2>
        <p className="mt-1 text-sm text-dwel-gray-500">
          Current selection: <Badge>{selected}</Badge>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(['disabled', 'certn', 'checkr_tenant'] as const).map((p) => {
            const row = providers.find((x) => x.provider === p);
            const disabled =
              busy || (p !== 'disabled' && row != null && !row.selectable);
            return (
              <Button
                key={p}
                variant={selected === p ? 'primary' : 'secondary'}
                disabled={disabled}
                onClick={() => void selectProvider(p)}
              >
                {p === 'checkr_tenant' ? 'Checkr Tenant' : p === 'certn' ? 'Certn' : 'Disabled'}
              </Button>
            );
          })}
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          {providers.map((p) => (
            <li key={p.provider} className="flex flex-wrap items-center gap-2">
              <strong>{p.provider}</strong>
              <Badge>{p.infrastructureReady ? 'infra ready' : 'not ready'}</Badge>
              {p.mode ? <span className="text-dwel-gray-500">mode: {p.mode}</span> : null}
              {p.reason ? <span className="text-dwel-gray-500">{p.reason}</span> : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Comparison dashboard</h2>
            <p className="mt-1 text-sm text-dwel-gray-500">
              Synthetic / sandbox probes only — no real applicant data.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void probe('certn')}>
              Probe Certn
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void probe('checkr_tenant')}
            >
              Probe Checkr
            </Button>
          </div>
        </div>

        {comparison ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {Object.entries(comparison.report.by_provider).map(([provider, stats]) => (
                <div
                  key={provider}
                  className="rounded-[10px] border border-dwel-gray-200 bg-dwel-gray-50 px-4 py-3 text-sm"
                >
                  <div className="font-semibold">{provider}</div>
                  <div className="mt-1 text-dwel-gray-500">
                    runs {stats.runs} · errors {stats.errors} · avg latency{' '}
                    {stats.avg_latency_ms ?? '—'}ms · webhooks {stats.webhooks} · reports{' '}
                    {stats.reports}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-dwel-gray-200 text-dwel-gray-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Provider</th>
                    <th className="py-2 pr-3 font-medium">Scenario</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Latency</th>
                    <th className="py-2 pr-3 font-medium">Webhook</th>
                    <th className="py-2 pr-3 font-medium">Report</th>
                    <th className="py-2 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.runs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-4 text-dwel-gray-500">
                        No comparison runs yet. Use Probe to record infrastructure readiness.
                      </td>
                    </tr>
                  ) : (
                    comparison.runs.slice(0, 40).map((run) => (
                      <tr key={run.id} className="border-b border-dwel-gray-100">
                        <td className="py-2 pr-3">{run.provider}</td>
                        <td className="py-2 pr-3">{run.scenario_key}</td>
                        <td className="py-2 pr-3">{run.screening_status ?? '—'}</td>
                        <td className="py-2 pr-3">
                          {run.request_latency_ms != null ? `${run.request_latency_ms}ms` : '—'}
                        </td>
                        <td className="py-2 pr-3">{run.webhook_received ? 'yes' : 'no'}</td>
                        <td className="py-2 pr-3">{run.report_available ? 'yes' : 'no'}</td>
                        <td className="py-2">{run.error_code ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs text-dwel-gray-500">
              Scenarios catalog: {comparison.scenarios.map((s) => s.label).join(' · ')}
            </p>
          </>
        ) : null}
      </Card>

      <Card className="mt-6 p-6">
        <h2 className="text-lg font-semibold">Selection audit</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {history.length === 0 ? (
            <li className="text-dwel-gray-500">No changes recorded yet.</li>
          ) : (
            history.slice(0, 20).map((h, i) => (
              <li key={`${h.created_at}-${i}`}>
                {h.previous_value} → <strong>{h.new_value}</strong>
                <span className="ml-2 text-dwel-gray-500">
                  {new Date(h.created_at).toLocaleString()}
                </span>
              </li>
            ))
          )}
        </ul>
      </Card>
    </AdminShell>
  );
}
