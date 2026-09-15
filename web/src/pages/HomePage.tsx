import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell';

export function HomePage() {
  return (
    <Shell>
      <section className="market-hero">
        <div>
          <p className="brand" style={{ fontSize: '2.4rem', marginBottom: '0.4rem' }}>
            dwel<em>.20</em>
          </p>
          <h1>Find a home. Keep more of the rent.</h1>
          <p>
            Browse live listings, apply with a private application link, and move through screening
            without creating an account first.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Link className="btn btn-primary" to="/listings">
              Find a home
            </Link>
            <Link className="btn btn-secondary" to="/landlords">
              For landlords
            </Link>
          </div>
        </div>
        <div className="panel">
          <h2>How it works</h2>
          <p>Apply from a listing. Save your private application link. Complete consent and screening from that link anytime.</p>
          <p style={{ marginBottom: 0 }}>Owners and brokers sign in separately to manage listings and pipeline tools.</p>
        </div>
      </section>
    </Shell>
  );
}
