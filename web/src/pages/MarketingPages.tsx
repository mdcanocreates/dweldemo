import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell';

export function LandlordsMarketingPage() {
  return (
    <Shell>
      <div className="home-split">
        <section className="home-hero-dark">
          <div className="home-hero-glow" aria-hidden />
          <div className="home-hero-inner">
            <p className="section-eyebrow" style={{ color: 'hsl(var(--primary))' }}>
              For landlords
            </p>
            <h1 className="home-hero-title">
              List once.
              <br />
              <span>Attract renters who stay.</span>
            </h1>
            <p className="home-hero-copy">
              Publish units, share transparent incentive economics, and manage applicants from an
              owner workspace built for operators.
            </p>
            <div className="home-hero-actions">
              <Link className="btn btn-primary" to="/sign-in?role=landlord">
                Sign in
              </Link>
              <Link className="btn btn-ghost-on-dark" to="/calculator">
                NOI calculator
              </Link>
            </div>
          </div>
        </section>
        <section className="home-side-panel">
          <p className="section-eyebrow">What you can do today</p>
          <h2 className="font-display" style={{ fontSize: '1.5rem' }}>
            Live landlord tools
          </h2>
          <p>
            Sign in, manage listings you own, and run portfolio NOI math. Applicant review is live:
            masked cards until you approve, with contact shared only after screening and approval.
          </p>
          <Link className="btn btn-secondary" to="/sign-in?role=landlord">
            Open landlord portal
          </Link>
        </section>
      </div>
    </Shell>
  );
}

export function BrokersMarketingPage() {
  return (
    <Shell>
      <div className="home-split">
        <section className="home-hero-dark">
          <div className="home-hero-glow" aria-hidden />
          <div className="home-hero-inner">
            <p className="section-eyebrow" style={{ color: 'hsl(var(--primary))' }}>
              For brokers
            </p>
            <h1 className="home-hero-title">
              Tools that work today —
              <br />
              <span>payouts when licensing clears.</span>
            </h1>
            <p className="home-hero-copy">
              Performance dashboard, lead history, and Stripe Connect onboarding are live. Funding,
              lead purchase, and payouts stay BOR-gated via per-org broker_payouts_enabled.
            </p>
            <div className="home-hero-actions">
              <Link className="btn btn-primary" to="/sign-in?role=broker">
                Sign in
              </Link>
            </div>
          </div>
        </section>
        <section className="home-side-panel">
          <p className="section-eyebrow">Live vs gated</p>
          <h2 className="font-display" style={{ fontSize: '1.5rem' }}>
            What ships now
          </h2>
          <p>Live: overview, performance dashboard, lead history, and Connect onboarding.</p>
          <p style={{ marginBottom: '1.25rem' }}>
            Gated: funding, purchasing leads, and payouts until licensing clears (
            <span className="font-mono" style={{ fontSize: '0.85em' }}>
              broker_payouts_enabled
            </span>{' '}
            per org).
          </p>
          <Link className="btn btn-secondary" to="/sign-in?role=broker">
            Open broker desk
          </Link>
        </section>
      </div>
    </Shell>
  );
}
