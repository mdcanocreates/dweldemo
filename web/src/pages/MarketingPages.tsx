import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell';

export function LandlordsMarketingPage() {
  return (
    <Shell>
      <div className="stack">
        <div className="market-hero">
          <div>
            <h1>List once. Attract renters who stay.</h1>
            <p>
              Publish units, share transparent incentive economics, and manage your portfolio from a
              landlord workspace built for operators.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <Link className="btn btn-primary" to="/sign-in?role=landlord">
                Sign in
              </Link>
              <Link className="btn btn-secondary" to="/calculator">
                NOI Impact Calculator
              </Link>
            </div>
          </div>
          <div className="panel">
            <h2>What you can do today</h2>
            <p>Sign in, manage listings you own, and run portfolio NOI math.</p>
            <p style={{ marginBottom: 0 }}>
              Applicant review is live in the landlord portal: masked pre-approval cards, screening-mode
              control (auto or manual), and contact reveal only after you approve.
            </p>
          </div>
        </div>
      </div>
    </Shell>
  );
}

export function BrokersMarketingPage() {
  return (
    <Shell>
      <div className="stack">
        <div className="market-hero">
          <div>
            <h1>Broker tools that work today — payouts when licensing clears.</h1>
            <p>
              Performance dashboard, lead history, and Stripe Connect onboarding are live. Funding,
              lead purchase, and payouts stay BOR-gated via per-org broker_payouts_enabled — Connect
              onboarding itself is not blocked by that gate.
            </p>
            <Link className="btn btn-primary" to="/sign-in?role=broker">
              Sign in
            </Link>
          </div>
          <div className="panel">
            <h2>Live vs gated</h2>
            <p>Live: overview, performance dashboard, lead history, and Connect onboarding.</p>
            <p style={{ marginBottom: 0 }}>
              Gated: funding, purchasing leads, and payouts until licensing clears (
              broker_payouts_enabled per org).
            </p>
          </div>
        </div>
      </div>
    </Shell>
  );
}
