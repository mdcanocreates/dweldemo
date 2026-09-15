import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { ErrorState, Shell } from '../components/Shell';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

export function OnboardPage() {
  const { user, setSession, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get('return') || '/listings';

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    given_name: '',
    family_name: '',
    phone: '',
    email: '',
    annual_income: '',
    move_in_urgency: 'within_30_days',
    bedrooms_min: '1',
    rent_max: '',
    state: 'OH',
    has_pets: false,
    household_size: '1',
  });

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        await api.getRenterProfile();
        if (!cancelled) navigate('/sign-in', { replace: true, state: { reason: 'returning' } });
      } catch {
        // no profile yet — stay on onboard
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const incomeDollars = Number(form.annual_income);
      const rentDollars = Number(form.rent_max);
      if (!Number.isFinite(incomeDollars) || incomeDollars < 0) throw new Error('Enter annual income');
      if (!Number.isFinite(rentDollars) || rentDollars <= 0) throw new Error('Enter max rent');

      const magic = await api.magicLink(form.email.trim(), 'sign_in');
      if (!magic.redeem_token) {
        throw new Error('Sign-in link issued — check email (DEV redeem token missing).');
      }
      const redeemed = await api.redeem(magic.redeem_token, 'sign_in');
      await setSession(redeemed.session_id);

      const profile = await api.upsertRenterProfile({
        given_name: form.given_name.trim(),
        family_name: form.family_name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        annual_income_cents: Math.round(incomeDollars * 100),
        move_in_urgency: form.move_in_urgency,
        bedrooms_min: Number(form.bedrooms_min),
        rent_max_cents: Math.round(rentDollars * 100),
        state: form.state,
        has_pets: form.has_pets,
        household_size: Number(form.household_size),
      });

      if (profile.profile.preferred_state === 'NY') {
        navigate('/screening-choice', { replace: true });
      } else {
        navigate(returnTo, { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Onboarding failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="dwel-cube-bg" style={{ borderRadius: '1.25rem', padding: '1.5rem' }}>
        <p className="section-eyebrow">Applicant onboarding</p>
        <h1 className="section-title">Tell us what you need</h1>
        <p style={{ color: 'hsl(var(--muted-foreground))', maxWidth: '36rem' }}>
          One form — no chat. Landlords see an income band, not your exact number.
        </p>

        {error && <ErrorState title="Could not save profile">{error}</ErrorState>}

        <form onSubmit={onSubmit} style={{ maxWidth: '28rem', marginTop: '1.5rem' }}>
          <div className="field">
            <label htmlFor="given_name">Legal first name</label>
            <input
              id="given_name"
              required
              value={form.given_name}
              onChange={(e) => setForm({ ...form, given_name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="family_name">Legal last name</label>
            <input
              id="family_name"
              required
              value={form.family_name}
              onChange={(e) => setForm({ ...form, family_name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone</label>
            <input
              id="phone"
              required
              placeholder="+1…"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <span className="hint">Stored as E.164 on submit.</span>
          </div>
          <div className="field">
            <label htmlFor="annual_income">Annual gross income ($)</label>
            <input
              id="annual_income"
              inputMode="decimal"
              required
              value={form.annual_income}
              onChange={(e) => setForm({ ...form, annual_income: e.target.value })}
            />
            <span className="hint">Before taxes. Landlords see an income band, not your exact number.</span>
          </div>
          <div className="field">
            <label htmlFor="move_in_urgency">Move-in urgency</label>
            <select
              id="move_in_urgency"
              value={form.move_in_urgency}
              onChange={(e) => setForm({ ...form, move_in_urgency: e.target.value })}
            >
              <option value="immediate">Immediate</option>
              <option value="within_30_days">Within 30 days</option>
              <option value="within_60_days">Within 60 days</option>
              <option value="within_90_days">Within 90 days</option>
              <option value="flexible">Flexible</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="bedrooms_min">Desired bedrooms (min)</label>
            <input
              id="bedrooms_min"
              type="number"
              min={0}
              step={0.5}
              required
              value={form.bedrooms_min}
              onChange={(e) => setForm({ ...form, bedrooms_min: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="rent_max">Desired rent max (monthly $)</label>
            <input
              id="rent_max"
              inputMode="decimal"
              required
              value={form.rent_max}
              onChange={(e) => setForm({ ...form, rent_max: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="state">State</label>
            <select
              id="state"
              required
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            >
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="household_size">Household size</label>
            <input
              id="household_size"
              type="number"
              min={1}
              required
              value={form.household_size}
              onChange={(e) => setForm({ ...form, household_size: e.target.value })}
            />
          </div>
          <label className="field" style={{ gridTemplateColumns: 'auto 1fr', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={form.has_pets}
              onChange={(e) => setForm({ ...form, has_pets: e.target.checked })}
            />
            <span>Has pets</span>
          </label>

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
          <p style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
            Already onboarded? <Link to="/sign-in">Sign in</Link>
          </p>
        </form>
      </div>
    </Shell>
  );
}

export function ScreeningChoicePage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [feeCents, setFeeCents] = useState(2000);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [completedAt, setCompletedAt] = useState('');
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/onboard');
      return;
    }
    void api.screeningChoice().then((data) => {
      setFeeCents(data.path2_fee.amount_cents);
      if (data.report?.fresh) navigate('/listings', { replace: true });
    });
  }, [user, loading, navigate]);

  async function uploadPath1(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!completedAt || !fileName) throw new Error('Completion date and file are required');
      await api.uploadNyReport({
        completed_at: new Date(completedAt).toISOString(),
        original_filename: fileName,
        content_type: 'application/pdf',
        storage_key: `dev-upload:${fileName}`,
      });
      navigate('/listings');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <p className="section-eyebrow">New York compliance</p>
      <h1 className="section-title">Choose your screening path</h1>
      <p style={{ color: 'hsl(var(--muted-foreground))', maxWidth: '40rem' }}>
        NY applicants need a valid report (completed within 30 days) before marking interest.
      </p>
      {error && <ErrorState title="Could not continue">{error}</ErrorState>}

      <div style={{ display: 'grid', gap: '1rem', marginTop: '1.5rem', maxWidth: '40rem' }}>
        <section className="card" style={{ padding: '1.25rem' }}>
          <h2 className="font-display" style={{ fontSize: '1.35rem' }}>
            Path 1 — Upload your own report
          </h2>
          <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
            PDF or image. Completion date must be within 30 days of upload.
          </p>
          <form onSubmit={uploadPath1}>
            <div className="field">
              <label htmlFor="completed_at">Completion date</label>
              <input
                id="completed_at"
                type="date"
                required
                value={completedAt}
                onChange={(e) => setCompletedAt(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="report_file">Report file</label>
              <input
                id="report_file"
                type="file"
                accept=".pdf,image/*"
                required
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Upload report
            </button>
          </form>
        </section>

        <section className="card" style={{ padding: '1.25rem' }}>
          <p className="section-eyebrow">interim_v1</p>
          <h2 className="font-display" style={{ fontSize: '1.35rem' }}>
            Path 2 — Purchase through RBIT
          </h2>
          <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
            NY-capped fee ${(feeCents / 100).toFixed(2)}. Path 2 compliance is interpretive, pending
            legal review.
          </p>
          <button
            type="button"
            className="btn btn-dark"
            onClick={() => navigate('/applications/new/consent?ny_path2=1')}
          >
            Continue to payment
          </button>
        </section>
      </div>
    </Shell>
  );
}
