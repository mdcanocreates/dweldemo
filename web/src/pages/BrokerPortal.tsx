import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { track } from '../lib/analytics';
import { useAuth } from '../auth';
import { FrogPageLoader, InlineSpinner } from '../components/FrogPageLoader';
import { PortalShell } from '../components/PortalShell';
import { EmptyState, ErrorState, Shell } from '../components/Shell';
import { moneyFromCents } from '../format';
import { displayName } from '../displayNames';
import { useDelayedPending } from '../hooks/useDelayedPending';

const BROKER_NAV = [
  { to: '/broker', label: 'Overview', end: true },
  { to: '/broker/dashboard', label: 'Dashboard' },
  { to: '/broker/leads', label: 'Leads' },
  { to: '/broker/settings/payments', label: 'Payments' },
  { to: '/calculator', label: 'NOI calculator' },
];

function BrokerFrame({ children }: { children: ReactNode }) {
  return (
    <PortalShell
      navLabel="Broker desk"
      topEyebrow=""
      topTitle="Broker portal"
      footTitle="Broker desk"
      footBody="Track leads, performance, and payouts."
      links={BROKER_NAV}
    >
      {children}
    </PortalShell>
  );
}

export function BrokerGuard() {
  const { user, loading } = useAuth();
  const showInline = useDelayedPending(loading, 400);
  if (loading) {
    return <Shell>{showInline ? <InlineSpinner label="Checking sign-in…" /> : null}</Shell>;
  }
  if (!user) return <Navigate to="/sign-in?role=broker&next=/partner/broker" replace />;
  if (!user.brokerOrgId) return <Navigate to="/partner/broker" replace />;
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

  const connectDone =
    data &&
    (data.connect.status === 'complete' ||
      data.connect.status === 'enabled' ||
      data.connect.status === 'active');
  const connectStarted = Boolean(data?.connect.account_id);
  const payoutsOn = Boolean(data?.broker_payouts_enabled);

  return (
    <div className="stack">
      <h1>Get started</h1>
      <p className="muted">Complete these steps to activate your brokerage on Dwel.</p>
      {error && <ErrorState title="Overview unavailable">{error}</ErrorState>}
      {data && (
        <div className="panel stack onboarding-checklist">
          <div className="checklist-row done">
            <span className="checklist-mark" aria-hidden>
              ✓
            </span>
            <div>
              <strong>Account created</strong>
              <p className="muted">Your broker organization is linked.</p>
            </div>
          </div>

          <div className={`checklist-row ${connectDone ? 'done' : connectStarted ? 'active' : 'todo'}`}>
            <span className="checklist-mark" aria-hidden>
              {connectDone ? '✓' : connectStarted ? '…' : '○'}
            </span>
            <div className="stack" style={{ gap: '0.5rem', flex: 1 }}>
              <div>
                <strong>Payouts onboarding</strong>
                <p className="muted">Connect your bank account so you can receive payouts.</p>
              </div>
              {!connectDone && (
                <Link className="btn btn-primary" to="/broker/settings/payments" style={{ alignSelf: 'start' }}>
                  {connectStarted ? 'Continue payouts setup' : 'Set up payouts'}
                </Link>
              )}
            </div>
          </div>

          <div className={`checklist-row ${payoutsOn ? 'done' : 'todo'}`}>
            <span className="checklist-mark" aria-hidden>
              {payoutsOn ? '✓' : '○'}
            </span>
            <div>
              <strong>License verification</strong>
              <p className="muted">
                {payoutsOn
                  ? 'Licensing is cleared for this brokerage.'
                  : "We're reviewing your license — you'll get an email when payouts are enabled."}
              </p>
            </div>
          </div>

          <div className={`checklist-row ${payoutsOn ? 'done' : 'todo'}`}>
            <span className="checklist-mark" aria-hidden>
              {payoutsOn ? '✓' : '○'}
            </span>
            <div>
              <strong>Payouts activation</strong>
              <p className="muted">
                {payoutsOn
                  ? 'Payouts are enabled.'
                  : 'Turns on automatically once licensing clears — no extra action needed.'}
              </p>
            </div>
          </div>

          <p style={{ marginTop: '0.5rem' }}>
            Prepaid balance: <strong>{moneyFromCents(data.balance_cents)}</strong>
            {' · '}
            <Link to="/broker/dashboard">Dashboard</Link>
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
      {perf &&
        perf.leads_offered === 0 &&
        perf.leads_accepted === 0 &&
        perf.placements_closed === 0 && (
          <EmptyState title="Your dashboard">
            Performance metrics will appear here once your brokerage is active and leads are flowing.{' '}
            <Link to="/broker">Complete onboarding →</Link>
          </EmptyState>
        )}
      {perf &&
        (perf.leads_offered > 0 || perf.leads_accepted > 0 || perf.placements_closed > 0) && (
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
            <EmptyState title="No submarket metrics yet">
              Submarket metrics will appear here once you have active coverage.
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
        <EmptyState title="No leads yet">
          Leads matched to your brokerage will appear here once your coverage areas are active.
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
                  <td>{displayName(row.status)}</td>
                  <td>{displayName(row.resolution)}</td>
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
  const showPaymentFrog = useDelayedPending(busy, 400);

  async function reload() {
    setStatus(await api.connectAccount());
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.connectAccount();
        if (!cancelled) {
          setStatus(s);
          if (s.charges_enabled && s.details_submitted && sessionStorage.getItem('rbit_connect_completed') !== '1') {
            sessionStorage.setItem('rbit_connect_completed', '1');
            track('connect_onboarding_completed', { product: 'dwel', audience });
          }
        }
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
      track('connect_onboarding_started', { product: 'dwel', audience });
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
      {showPaymentFrog && <FrogPageLoader />}
      <p className="section-eyebrow">Payments</p>
      <h1>Payment settings</h1>
      <p className="muted">
        {audience === 'broker'
          ? 'Set up payouts for your brokerage. You can finish bank setup even before licensing clears.'
          : 'Set up payouts for your landlord organization.'}
      </p>
      {search.get('connect') === 'return' && (
        <div className="callout">Returned from Stripe — status refreshed below.</div>
      )}
      {status && (
        <div className="panel stack">
          <div className="status-grid">
            <div className="status-item">
              <span
                className={`status-dot ${status.charges_enabled ? 'on' : 'off'}`}
                aria-hidden
              />
              <div>
                <strong>Charges</strong>
                <p className="muted">{status.charges_enabled ? 'Active' : 'Not active'}</p>
              </div>
            </div>
            <div className="status-item">
              <span
                className={`status-dot ${status.payouts_enabled ? 'on' : 'off'}`}
                aria-hidden
              />
              <div>
                <strong>Payouts</strong>
                <p className="muted">{status.payouts_enabled ? 'Active' : 'Not active'}</p>
              </div>
            </div>
            <div className="status-item">
              <span
                className={`status-dot ${status.details_submitted ? 'on' : 'off'}`}
                aria-hidden
              />
              <div>
                <strong>Account details</strong>
                <p className="muted">{status.details_submitted ? 'Complete' : 'Incomplete'}</p>
              </div>
            </div>
          </div>
          {audience === 'broker' && !status.broker_payouts_enabled && (
            <div className="callout-info">
              <strong className="callout-title">Licensing review in progress</strong>
              <div className="callout-body">
                Payouts unlock for this brokerage after your license is verified. You&apos;ll get an
                email when they&apos;re enabled.
              </div>
            </div>
          )}
          {status.status === 'none' || status.status === 'pending' || status.status === 'restricted' ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void startOnboarding()}>
              {busy ? 'Redirecting…' : status.account_id ? 'Continue Stripe onboarding' : 'Connect your bank account'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void openDashboard()}>
              {busy ? 'Opening…' : 'Open payouts dashboard'}
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
      <EmptyState title="No listings assigned yet">
        Listings in your coverage area will appear here.
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
