import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, ApiError, type PartnerIntake } from '../api';
import { useAuth } from '../auth';
import { InlineSpinner } from '../components/FrogPageLoader';
import { ErrorState, Shell } from '../components/Shell';
import { useDelayedPending } from '../hooks/useDelayedPending';

export function PartnerChoicePage() {
  return (
    <Shell>
      <p className="landing-hero-eyebrow">Dwel Partner</p>
      <h1 className="landing-how-title" style={{ marginTop: 0 }}>
        Continue as a home provider or a broker.
      </h1>
      <p className="muted" style={{ maxWidth: '40rem' }}>
        New here? Start an intake. Already approved? Sign in and open the dashboard.
      </p>
      <div className="partner-choice">
        <article className="partner-choice-card">
          <h2>Home provider</h2>
          <p>List homes, review applicants, and manage your portfolio.</p>
          <Link className="product-pill" to="/sign-in?role=landlord&next=/landlord">
            Sign in as a home provider
          </Link>
          <Link to="/partner/landlord">Start home provider intake</Link>
        </article>
        <article className="partner-choice-card">
          <h2>Broker</h2>
          <p>Represent clients, share listings, and track placements.</p>
          <Link className="product-pill" to="/sign-in?role=broker&next=/broker">
            Sign in as a broker
          </Link>
          <Link to="/partner/broker">Start broker intake</Link>
        </article>
      </div>
    </Shell>
  );
}

type Role = 'landlord' | 'broker';

const COPY: Record<
  Role,
  { title: string; org: string; market: string; size: string; dashboard: string }
> = {
  landlord: {
    title: 'Home provider intake',
    org: 'Organization or company',
    market: 'Market',
    size: 'Unit count or portfolio size',
    dashboard: '/landlord',
  },
  broker: {
    title: 'Broker intake',
    org: 'Brokerage',
    market: 'Markets served',
    size: 'Team size or production context',
    dashboard: '/broker',
  },
};

export function PartnerIntakePage({ role }: { role: Role }) {
  const { user, loading, refresh } = useAuth();
  const copy = COPY[role];
  const orgId = role === 'landlord' ? user?.landlordOrgId : user?.brokerOrgId;
  const [intake, setIntake] = useState<PartnerIntake | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const showSpinner = useDelayedPending(loading || intake === undefined, 400);

  useEffect(() => {
    if (loading || !user || orgId) return;
    let cancelled = false;
    void api
      .myPartnerIntake(role)
      .then((res) => {
        if (!cancelled) setIntake(res.intake);
      })
      .catch((err) => {
        if (!cancelled) {
          setIntake(null);
          setError(err instanceof ApiError ? err.message : 'Could not load your intake.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loading, user, orgId, role]);

  useEffect(() => {
    if (intake?.status === 'approved' && !orgId) void refresh();
  }, [intake?.status, orgId, refresh]);

  if (loading) {
    return <Shell>{showSpinner ? <InlineSpinner label="Checking sign-in…" /> : null}</Shell>;
  }
  if (!user) {
    return (
      <Navigate
        to={`/sign-in?role=${role}&next=${encodeURIComponent(`/partner/${role}`)}`}
        replace
      />
    );
  }
  if (orgId || intake?.status === 'approved') {
    return (
      <Shell>
        <div className="panel stack" style={{ maxWidth: '36rem' }}>
          <p className="section-eyebrow">Dwel Partner</p>
          <h1 className="section-title">You&apos;re approved</h1>
          <p className="muted">Your organization is linked. Continue to the dashboard.</p>
          <Link className="btn btn-primary" to={copy.dashboard}>
            Continue to dashboard
          </Link>
        </div>
      </Shell>
    );
  }
  if (intake === undefined) {
    return <Shell>{showSpinner ? <InlineSpinner label="Loading your intake…" /> : null}</Shell>;
  }
  if (intake && (intake.status === 'new' || intake.status === 'under_review')) {
    return (
      <Shell>
        <div className="panel stack" style={{ maxWidth: '36rem' }}>
          <p className="section-eyebrow">Dwel Partner</p>
          <h1 className="section-title">Intake submitted</h1>
          <p>
            Thanks, {intake.full_name}. We have your {role === 'landlord' ? 'home provider' : 'broker'}{' '}
            request for {intake.organization_name} and it is pending review.
          </p>
          <p className="muted">
            You&apos;ll be able to open the dashboard from this account after approval. No further
            action is needed right now.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ maxWidth: '36rem' }}>
        <p className="section-eyebrow">Dwel Partner</p>
        <h1 className="section-title">{copy.title}</h1>
        <p className="muted">
          {intake?.status === 'rejected'
            ? 'The last request was not approved. You can send an updated intake.'
            : 'Tell us about your portfolio. We review each request before opening the dashboard.'}
        </p>
        {error && <ErrorState title="Could not submit">{error}</ErrorState>}
        <IntakeForm
          role={role}
          copy={copy}
          busy={busy}
          onSubmit={async (body) => {
            setBusy(true);
            setError(null);
            try {
              const saved = await api.submitPartnerIntake(role, body);
              setIntake(saved.intake);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Could not submit intake.');
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </Shell>
  );
}

function IntakeForm({
  role,
  copy,
  busy,
  onSubmit,
}: {
  role: Role;
  copy: (typeof COPY)[Role];
  busy: boolean;
  onSubmit: (body: {
    full_name: string;
    email: string;
    phone: string;
    organization_name: string;
    market: string;
    portfolio_size: string;
    property_types?: string;
    notes?: string;
  }) => Promise<void>;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [organization, setOrganization] = useState('');
  const [market, setMarket] = useState('');
  const [size, setSize] = useState('');
  const [propertyTypes, setPropertyTypes] = useState('');
  const [notes, setNotes] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSubmit({
      full_name: fullName,
      email,
      phone,
      organization_name: organization,
      market,
      portfolio_size: size,
      property_types: propertyTypes.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <form className="panel form-grid" onSubmit={(event) => void submit(event)}>
      <label>
        Full name
        <input required value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <label>
        Email
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Phone
        <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label>
        {copy.org}
        <input required value={organization} onChange={(e) => setOrganization(e.target.value)} />
      </label>
      <label>
        {copy.market}
        <input required value={market} onChange={(e) => setMarket(e.target.value)} />
      </label>
      <label>
        {copy.size}
        <input required value={size} onChange={(e) => setSize(e.target.value)} />
      </label>
      {role === 'landlord' && (
        <label>
          Property types
          <input
            required
            placeholder="Multifamily, single family, condo"
            value={propertyTypes}
            onChange={(e) => setPropertyTypes(e.target.value)}
          />
        </label>
      )}
      <label>
        Notes and goals
        <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Submitting…' : 'Submit intake'}
      </button>
    </form>
  );
}
