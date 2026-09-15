import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { PortalShell } from '../components/PortalShell';
import { EmptyState, ErrorState, Shell } from '../components/Shell';
import { moneyFromCents } from '../format';

const BROKER_NAV = [
  { to: '/broker', label: 'Overview', end: true },
  { to: '/broker/dashboard', label: 'Dashboard' },
  { to: '/broker/leads', label: 'Leads' },
  { to: '/broker/settings/payments', label: 'Payments' },
  { to: '/broker/listings', label: 'Listings' },
];

function BrokerFrame({ children }: { children: ReactNode }) {
  return (
    <PortalShell
      navLabel="Broker desk"
      topEyebrow="Broker workspace"
      topTitle="Broker portal"
      footTitle="dwel.20 for brokers"
      footBody="Track leads, performance, and Connect payouts."
      links={BROKER_NAV}
    >
      {children}
    </PortalShell>
  );
}

export function BrokerGuard() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <Shell>
        <p>Checking sign-in…</p>
      </Shell>
    );
  }
  if (!user) return <Navigate to="/sign-in?role=broker" replace />;
  if (!user.brokerOrgId) {
    return (
      <Shell>
        <EmptyState title="Broker organization not linked">
          You’re signed in, but this account has no broker organization role yet.
        </EmptyState>
      </Shell>
    );
  }
  return (
    <BrokerFrame>
      <Outlet />
    </BrokerFrame>
  );
}

export function BrokerOverviewPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.brokerOverview>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const overview = await api.brokerOverview();
        if (!cancelled) setData(overview);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load broker overview.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="stack">
      <h1>Broker overview</h1>
      {error && <ErrorState title="Overview unavailable">{error}</ErrorState>}
      {data && (
        <div className="panel stack">
          <p>
            Prepaid balance: <strong>{moneyFromCents(data.balance_cents)}</strong>
          </p>
          <p className="muted">
            Connect: {data.connect.status}
            {data.connect.account_id ? ` · ${data.connect.account_id}` : ''}
          </p>
          {!data.broker_payouts_enabled && (
            <div className="callout warn">
              <strong>Payouts available once licensing is finalized.</strong>
              You can still complete Stripe Connect onboarding before payouts are turned on for this
              org.
            </div>
          )}
          <div className="callout">
            <strong>Funding & lead purchase</strong>
            Real-money funding and lead purchase remain gated on BOR / licensing (
            {data.funding.reason}).
          </div>
          <p>
            <Link to="/broker/dashboard">Open performance dashboard →</Link>
            {' · '}
            <Link to="/broker/settings/payments">Payment settings →</Link>
          </p>
        </div>
      )}
    </div>
  );
}

export function BrokerDashboardPage() {
  const [windowDays, setWindowDays] = useState<30 | 60 | 90>(90);
  const [perf, setPerf] = useState<Awaited<ReturnType<typeof api.brokerPerformance>> | null>(null);
  const [subs, setSubs] = useState<Awaited<ReturnType<typeof api.brokerSubmarkets>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, s] = await Promise.all([
          api.brokerPerformance(windowDays),
          api.brokerSubmarkets(windowDays),
        ]);
        if (!cancelled) {
          setPerf(p);
          setSubs(s);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load performance.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [windowDays]);

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <p className="section-eyebrow">Performance</p>
          <h1>Broker dashboard</h1>
        </div>
        <label className="field" style={{ marginBottom: 0, minWidth: '8rem' }}>
          <span>Window</span>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value) as 30 | 60 | 90)}
          >
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>
      {error && <ErrorState title="Dashboard error">{error}</ErrorState>}
      {perf && (
        <div className="stat-grid">
          <div className="stat">
            <p className="ll-stat-label">Leads offered</p>
            <p className="ll-stat-num">{perf.leads_offered}</p>
          </div>
          <div className="stat">
            <p className="ll-stat-label">Accepted</p>
            <p className="ll-stat-num">{perf.leads_accepted}</p>
          </div>
          <div className="stat">
            <p className="ll-stat-label">Placements closed</p>
            <p className="ll-stat-num">{perf.placements_closed}</p>
          </div>
          <div className="stat">
            <p className="ll-stat-label">Median response</p>
            <p className="ll-stat-num">
              {perf.median_response_seconds != null
                ? `${Math.round(perf.median_response_seconds / 60)}m`
                : '—'}
            </p>
          </div>
          <div className="stat">
            <p className="ll-stat-label">EV / lead</p>
            <p className="ll-stat-num">{moneyFromCents(Math.round(perf.ev_per_lead))}</p>
          </div>
          <div className="stat">
            <p className="ll-stat-label">Leakage</p>
            <p className="ll-stat-num">{(perf.leakage_rate * 100).toFixed(1)}%</p>
          </div>
        </div>
      )}
      {subs && (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <h2>Submarket breakdown</h2>
          {subs.submarkets.length === 0 ? (
            <EmptyState title="No submarket rows yet">
              Metrics appear after coverage and lead activity land in broker_performance_submarket.
            </EmptyState>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Submarket</th>
                  <th>Offered</th>
                  <th>Accepted</th>
                  <th>Closed</th>
                  <th>Close rate</th>
                </tr>
              </thead>
              <tbody>
                {subs.submarkets.map((s) => (
                  <tr key={s.submarket_id}>
                    <td>{s.name}</td>
                    <td>{s.leads_offered}</td>
                    <td>{s.leads_accepted}</td>
                    <td>{s.placements_closed}</td>
                    <td>{s.close_rate != null ? `${(Number(s.close_rate) * 100).toFixed(0)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export function BrokerLeadsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.brokerLeads>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await api.brokerLeads({
          page,
          status: status || undefined,
          from: from || undefined,
          to: to || undefined,
        });
        if (!cancelled) {
          setData(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load leads.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, status, from, to]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="stack">
      <h1>Lead history</h1>
      <p className="muted">Server-paginated from live lead_offer records (25 / page).</p>
      <div className="filter-bar">
        <div className="field">
          <label htmlFor="lead-status">Status</label>
          <input
            id="lead-status"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
            placeholder="e.g. offered"
          />
        </div>
        <div className="field">
          <label htmlFor="lead-from">From</label>
          <input
            id="lead-from"
            type="date"
            value={from}
            onChange={(e) => {
              setPage(1);
              setFrom(e.target.value);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="lead-to">To</label>
          <input
            id="lead-to"
            type="date"
            value={to}
            onChange={(e) => {
              setPage(1);
              setTo(e.target.value);
            }}
          />
        </div>
      </div>
      {error && <ErrorState title="Leads error">{error}</ErrorState>}
      {data && data.items.length === 0 && (
        <EmptyState title="No leads in this window">
          Offered leads for your brokerage will appear here from real lead_offer rows.
        </EmptyState>
      )}
      {data && data.items.length > 0 && (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>RS tier</th>
                <th>Fee</th>
                <th>Offered</th>
                <th>Status</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.lead_id}>
                  <td className="font-mono">{row.lead_id.slice(0, 8)}…</td>
                  <td>{row.rs_tier}</td>
                  <td>{moneyFromCents(row.fee_amount_cents)}</td>
                  <td>{new Date(row.offered_at).toLocaleDateString()}</td>
                  <td>{row.status}</td>
                  <td>{row.resolution}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row-between" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="muted">
              Page {page} / {pages} · {data.total} total
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ConnectPaymentsPage({ audience }: { audience: 'broker' | 'landlord' }) {
  const [search] = useSearchParams();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.connectAccount>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setStatus(await api.connectAccount());
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.connectAccount();
        if (!cancelled) setStatus(s);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load Connect status.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search.get('connect')]);

  async function startOnboarding() {
    setBusy(true);
    setError(null);
    try {
      const link = await api.connectOnboardingLink();
      window.location.assign(link.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start onboarding.');
      setBusy(false);
    }
  }

  async function openDashboard() {
    setBusy(true);
    setError(null);
    try {
      const link = await api.connectDashboardLink();
      window.location.assign(link.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open Stripe dashboard.');
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: '36rem' }}>
      <p className="section-eyebrow">Stripe Connect</p>
      <h1>Payment settings</h1>
      <p className="muted">
        {audience === 'broker'
          ? 'Connect Express for your brokerage. Onboarding is allowed even when payouts are disabled.'
          : 'Connect Express for your landlord organization.'}
      </p>
      {search.get('connect') === 'return' && (
        <div className="callout">Returned from Stripe — status refreshed below.</div>
      )}
      {status && (
        <div className="panel stack">
          <p>
            Status: <strong>{status.status}</strong>
          </p>
          {status.account_id && <p className="hint">Account {status.account_id}</p>}
          <p className="hint">
            Charges {status.charges_enabled ? 'on' : 'off'} · Payouts capability{' '}
            {status.payouts_enabled ? 'on' : 'off'} · Details{' '}
            {status.details_submitted ? 'submitted' : 'incomplete'}
          </p>
          {audience === 'broker' && !status.broker_payouts_enabled && (
            <div className="callout warn">
              <strong>Payouts available once licensing is finalized.</strong>
              Money-movement UI stays hidden until this org flag is enabled (per-org, not global).
            </div>
          )}
          {status.status === 'none' || status.status === 'pending' || status.status === 'restricted' ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void startOnboarding()}>
              {busy ? 'Redirecting…' : status.account_id ? 'Continue Stripe onboarding' : 'Connect your bank account'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void openDashboard()}>
              {busy ? 'Opening…' : 'Open Stripe Express dashboard'}
            </button>
          )}
          <button type="button" className="btn btn-soft" onClick={() => void reload()}>
            Refresh status
          </button>
        </div>
      )}
      {error && <ErrorState title="Payments error">{error}</ErrorState>}
    </div>
  );
}

export function BrokerPaymentsPage() {
  return <ConnectPaymentsPage audience="broker" />;
}

export function BrokerListingsPage() {
  return (
    <div className="stack">
      <h1>Listings</h1>
      <EmptyState title="Coverage listings not wired as a live feed yet">
        Browse the public marketplace for active inventory. Broker-specific coverage feeds will
        attach when assignment APIs are exposed over HTTP.
      </EmptyState>
    </div>
  );
}

export function BrokerClientsPage() {
  return <Navigate to="/broker/dashboard" replace />;
}

export function BrokerActivityPage() {
  return <Navigate to="/broker/dashboard" replace />;
}
