import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, type RenterProfile } from '../api';
import { rememberAccessToken } from '../accessToken';
import { useAuth } from '../auth';
import { ErrorState, Shell } from '../components/Shell';
import { moneyFromCents } from '../format';

type Occupant = { name: string; relationship: string; age_band: string };
type Pet = { species: string; breed: string; weight_lbs: string };

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const DRAFT_KEY = (listingId: string) => `dwel20.intake.draft.${listingId}`;

type Draft = Record<string, unknown>;

function loadDraft(listingId: string): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(listingId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function saveDraft(listingId: string, draft: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY(listingId), JSON.stringify(draft));
  } catch {
    // ignore quota
  }
}

/**
 * L-1 — fully fillable with no session. Auth only at submit (inline email).
 */
export function ApplyPage() {
  const { listingId = '' } = useParams();
  const [search] = useSearchParams();
  const editOnly = search.get('edit') === '1';
  const { user, loading: authLoading, setSession, refresh } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<RenterProfile | null>(null);
  void profile;
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hopping, setHopping] = useState(false);
  const [mode, setMode] = useState<'form' | 'review'>('form');
  const [needEmail, setNeedEmail] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postal, setPostal] = useState('');
  const [moveIn, setMoveIn] = useState('');
  const [employer, setEmployer] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [employerPhone, setEmployerPhone] = useState('');
  const [empMonths, setEmpMonths] = useState('');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [occupants, setOccupants] = useState<Occupant[]>([
    { name: '', relationship: '', age_band: '' },
  ]);
  const [pets, setPets] = useState<Pet[]>([{ species: '', breed: '', weight_lbs: '' }]);
  const [ecName, setEcName] = useState('');
  const [ecRel, setEcRel] = useState('');
  const [ecPhone, setEcPhone] = useState('');
  const [vehMake, setVehMake] = useState('');
  const [vehModel, setVehModel] = useState('');
  const [vehPlate, setVehPlate] = useState('');

  function applyIntake(i: Record<string, unknown>, p: RenterProfile | null) {
    setLine1(String(i.current_address_line1 ?? ''));
    setCity(String(i.current_address_city ?? ''));
    setState(String(i.current_address_state ?? p?.preferred_state ?? ''));
    setPostal(String(i.current_address_postal ?? ''));
    setMoveIn(i.current_address_move_in ? String(i.current_address_move_in).slice(0, 10) : '');
    setEmployer(String(i.employer_name ?? ''));
    setJobTitle(String(i.job_title ?? ''));
    setEmployerPhone(String(i.employer_phone ?? ''));
    setEmpMonths(i.employment_length_months != null ? String(i.employment_length_months) : '');
    const monthly =
      i.monthly_gross_income_cents != null
        ? Number(i.monthly_gross_income_cents)
        : p?.annual_income_cents
          ? Math.round(p.annual_income_cents / 12)
          : null;
    setMonthlyIncome(monthly != null ? String(monthly / 100) : '');
    const occ = Array.isArray(i.occupants) ? (i.occupants as Occupant[]) : [];
    setOccupants(occ.length ? occ : [{ name: '', relationship: '', age_band: '' }]);
    const petRows = Array.isArray(i.pets) ? (i.pets as Pet[]) : [];
    if (petRows.length) setPets(petRows);
    else if (p?.has_pets) setPets([{ species: '', breed: '', weight_lbs: '' }]);
    else setPets([]);
    const ec = (i.emergency_contact ?? null) as Record<string, string> | null;
    if (ec) {
      setEcName(ec.name ?? '');
      setEcRel(ec.relationship ?? '');
      setEcPhone(ec.phone ?? '');
    }
    const veh = (i.vehicle ?? null) as Record<string, string> | null;
    if (veh) {
      setVehMake(veh.make ?? '');
      setVehModel(veh.model ?? '');
      setVehPlate(veh.plate ?? '');
    }
    if (p) {
      setGivenName(p.given_name ?? '');
      setFamilyName(p.family_name ?? '');
      setPhone(p.phone_e164 ?? '');
      setEmail(p.email ?? '');
    }
  }

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    (async () => {
      if (!user) {
        const draft = loadDraft(listingId);
        if (draft && !cancelled) {
          applyIntake(draft, null);
          if (typeof draft.given_name === 'string') setGivenName(draft.given_name);
          if (typeof draft.family_name === 'string') setFamilyName(draft.family_name);
          if (typeof draft.phone === 'string') setPhone(draft.phone);
          if (typeof draft.email === 'string') setEmail(draft.email);
        }
        return;
      }
      try {
        const data = await api.getRenterIntake();
        if (cancelled) return;
        setProfile(data.profile);
        setComplete(data.complete);
        if (data.complete && !editOnly) setMode('review');
        applyIntake((data.intake as Record<string, unknown>) ?? {}, data.profile);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load intake.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, listingId, editOnly]);

  function buildPayload(markComplete: boolean) {
    const dollars = Number(monthlyIncome);
    return {
      current_address_line1: line1 || undefined,
      current_address_city: city || undefined,
      current_address_state: state || undefined,
      current_address_postal: postal || undefined,
      current_address_move_in: moveIn || undefined,
      employer_name: employer || undefined,
      job_title: jobTitle || undefined,
      employer_phone: employerPhone || undefined,
      employment_length_months: empMonths ? Number(empMonths) : undefined,
      monthly_gross_income_cents: Number.isFinite(dollars)
        ? Math.round(dollars * 100)
        : undefined,
      occupants: occupants.filter((o) => o.name.trim()),
      pets: pets.filter((p) => p.species.trim()),
      emergency_contact:
        ecName.trim() || ecPhone.trim()
          ? { name: ecName, relationship: ecRel, phone: ecPhone }
          : null,
      vehicle:
        vehMake.trim() || vehModel.trim() || vehPlate.trim()
          ? { make: vehMake, model: vehModel, plate: vehPlate }
          : null,
      mark_complete: markComplete,
      given_name: givenName,
      family_name: familyName,
      phone,
      email,
    };
  }

  async function ensureSession(): Promise<boolean> {
    if (user) return true;
    const targetEmail = (authEmail || email).trim();
    if (!targetEmail) {
      setNeedEmail(true);
      setError('Enter your email to get a private application link and finish submit.');
      return false;
    }
    const link = await api.magicLink(targetEmail, 'sign_in');
    if (!link.redeem_token) {
      setNeedEmail(true);
      setError(
        'Check your email for a private link, then return here to finish. In DEV a redeem_token is expected.',
      );
      return false;
    }
    const redeemed = await api.redeem(link.redeem_token, 'sign_in');
    await setSession(redeemed.session_id);
    await refresh();
    return true;
  }

  async function persistAndInterest() {
    const dollars = Number(monthlyIncome);
    const annual = Number.isFinite(dollars) ? Math.round(dollars * 100 * 12) : 0;
    await api.upsertRenterProfile({
      given_name: givenName || 'Applicant',
      family_name: familyName || 'Pending',
      phone: phone || '+10000000000',
      email: (authEmail || email).trim() || 'applicant@example.com',
      annual_income_cents: annual || 1,
      move_in_urgency: 'within_30_days',
      bedrooms_min: 1,
      rent_max_cents: Math.max(annual || 100000, 100000),
      state: state || 'OH',
      has_pets: pets.some((p) => p.species.trim()),
      household_size: Math.max(1, occupants.filter((o) => o.name.trim()).length + 1),
    });
    await api.upsertRenterIntake(buildPayload(true));
    setComplete(true);
    if (editOnly) {
      navigate('/applications');
      return;
    }
    const result = await api.expressInterest(listingId);
    rememberAccessToken(result.application_id, result.access_token);
    try {
      localStorage.removeItem(DRAFT_KEY(listingId));
    } catch {
      /* ignore */
    }
    setSubmittedId(result.application_id);
  }

  async function submitAndInterest() {
    setBusy(true);
    setError(null);
    const draft = buildPayload(true);
    saveDraft(listingId, draft);
    try {
      if (!user) {
        setNeedEmail(true);
        const ok = await ensureSession();
        if (!ok) return;
      }
      setHopping(true);
      await persistAndInterest();
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === 'ny_report_required' || err.code === 'ny_report_expired')
      ) {
        navigate('/screening-choice');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not submit application.');
    } finally {
      setBusy(false);
      setHopping(false);
    }
  }

  if (submittedId) {
    return (
      <Shell>
        <p className="section-eyebrow">Submitted</p>
        <h1 className="section-title">Interest sent</h1>
        <p className="muted">Your application dossier was frozen for this listing review.</p>
        <div className="row-between" style={{ marginTop: '1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link className="btn btn-primary" to={`/applications/${submittedId}/details`}>
            View my application
          </Link>
          <Link className="btn btn-secondary" to="/applications">
            Pipeline tracker
          </Link>
        </div>
      </Shell>
    );
  }

  if (hopping) {
    return (
      <Shell>
        <div className="branded-loading">
          <div className="branded-loading-orb" aria-hidden />
          <p className="section-eyebrow">dwel.20</p>
          <h1>Hopping to the next home</h1>
          <p className="muted">Saving your application and notifying the landlord…</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Link to={`/listings/${listingId}`} style={{ fontWeight: 700 }}>
        ← Back to listing
      </Link>
      <p className="section-eyebrow" style={{ marginTop: '1rem' }}>
        Rental application
      </p>
      <h1 className="section-title">
        {editOnly
          ? 'Edit application dossier'
          : complete && mode === 'review'
            ? 'Review before you apply'
            : 'Tell us about your household'}
      </h1>
      <p className="muted" style={{ maxWidth: '40rem' }}>
        {user
          ? 'Fill once — we reuse this dossier across listings. You can edit before each submission.'
          : 'No account needed to fill this out. We’ll email you a private link only when you submit.'}
      </p>
      {error && <ErrorState title="Application error">{error}</ErrorState>}

      {mode === 'review' && complete && !editOnly ? (
        <div className="panel stack" style={{ marginTop: '1.25rem' }}>
          <p>
            Contact: {givenName} {familyName} · {email} · {phone}
          </p>
          <p>Address: {[line1, city, state, postal].filter(Boolean).join(', ') || '—'}</p>
          <p>
            Employer: {employer || '—'} · {jobTitle || '—'} · income{' '}
            {monthlyIncome ? moneyFromCents(Math.round(Number(monthlyIncome) * 100)) : '—'}/mo
          </p>
          <div className="row-between" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setMode('form')}>
              Edit details
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void submitAndInterest()}
            >
              {busy ? 'Submitting…' : 'Submit interest with this application'}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="stack"
          style={{ marginTop: '1.25rem', maxWidth: '40rem' }}
          onSubmit={(e) => {
            e.preventDefault();
            void submitAndInterest();
          }}
        >
          <h2>Contact</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="gn">First name</label>
              <input id="gn" required value={givenName} onChange={(e) => setGivenName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="fn">Last name</label>
              <input id="fn" required value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="em">Email</label>
              <input
                id="em"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ph">Phone</label>
              <input id="ph" required value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          <h2>Current address</h2>
          <div className="field">
            <label htmlFor="line1">Street</label>
            <input id="line1" required value={line1} onChange={(e) => setLine1(e.target.value)} />
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="city">City</label>
              <input id="city" required value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="st">State</label>
              <select id="st" required value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">Select</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="zip">Postal</label>
              <input id="zip" value={postal} onChange={(e) => setPostal(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="moved">Moved in</label>
              <input
                id="moved"
                type="date"
                required
                value={moveIn}
                onChange={(e) => setMoveIn(e.target.value)}
              />
            </div>
          </div>

          <h2>Employment</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="emp">Employer</label>
              <input id="emp" required value={employer} onChange={(e) => setEmployer(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="title">Job title</label>
              <input id="title" required value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ephone">Employer phone</label>
              <input
                id="ephone"
                required
                value={employerPhone}
                onChange={(e) => setEmployerPhone(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="emonths">Months employed</label>
              <input
                id="emonths"
                type="number"
                min={0}
                required
                value={empMonths}
                onChange={(e) => setEmpMonths(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="inc">Monthly gross income ($)</label>
              <input
                id="inc"
                type="number"
                min={0}
                step="1"
                required
                value={monthlyIncome}
                onChange={(e) => setMonthlyIncome(e.target.value)}
              />
            </div>
          </div>

          <h2>Additional occupants</h2>
          {occupants.map((o, idx) => (
            <div key={idx} className="form-grid">
              <div className="field">
                <label>Name</label>
                <input
                  value={o.name}
                  onChange={(e) => {
                    const next = [...occupants];
                    next[idx] = { ...o, name: e.target.value };
                    setOccupants(next);
                  }}
                />
              </div>
              <div className="field">
                <label>Relationship</label>
                <input
                  value={o.relationship}
                  onChange={(e) => {
                    const next = [...occupants];
                    next[idx] = { ...o, relationship: e.target.value };
                    setOccupants(next);
                  }}
                />
              </div>
              <div className="field">
                <label>Age band</label>
                <select
                  value={o.age_band}
                  onChange={(e) => {
                    const next = [...occupants];
                    next[idx] = { ...o, age_band: e.target.value };
                    setOccupants(next);
                  }}
                >
                  <option value="">Select</option>
                  <option value="0-17">0–17</option>
                  <option value="18-24">18–24</option>
                  <option value="25-64">25–64</option>
                  <option value="65+">65+</option>
                </select>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-soft"
            onClick={() => setOccupants([...occupants, { name: '', relationship: '', age_band: '' }])}
          >
            Add occupant
          </button>

          <h2>Pets</h2>
          {pets.map((p, idx) => (
            <div key={idx} className="form-grid">
              <div className="field">
                <label>Species</label>
                <input
                  value={p.species}
                  onChange={(e) => {
                    const next = [...pets];
                    next[idx] = { ...p, species: e.target.value };
                    setPets(next);
                  }}
                />
              </div>
              <div className="field">
                <label>Breed</label>
                <input
                  value={p.breed}
                  onChange={(e) => {
                    const next = [...pets];
                    next[idx] = { ...p, breed: e.target.value };
                    setPets(next);
                  }}
                />
              </div>
              <div className="field">
                <label>Weight (lbs)</label>
                <input
                  value={p.weight_lbs}
                  onChange={(e) => {
                    const next = [...pets];
                    next[idx] = { ...p, weight_lbs: e.target.value };
                    setPets(next);
                  }}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-soft"
            onClick={() => setPets([...pets, { species: '', breed: '', weight_lbs: '' }])}
          >
            Add pet
          </button>

          <h2>Emergency contact</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="ecn">Name</label>
              <input id="ecn" required value={ecName} onChange={(e) => setEcName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ecr">Relationship</label>
              <input id="ecr" required value={ecRel} onChange={(e) => setEcRel(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ecp">Phone</label>
              <input id="ecp" required value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} />
            </div>
          </div>

          <h2>Vehicle (optional)</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="vm">Make</label>
              <input id="vm" value={vehMake} onChange={(e) => setVehMake(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="vd">Model</label>
              <input id="vd" value={vehModel} onChange={(e) => setVehModel(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="vp">Plate</label>
              <input id="vp" value={vehPlate} onChange={(e) => setVehPlate(e.target.value)} />
            </div>
          </div>

          {(needEmail || !user) && (
            <div className="panel stack">
              <h2>Private link (only at submit)</h2>
              <p className="muted">
                We’ll create your private application link with this email when you submit — not
                before.
              </p>
              <div className="field">
                <label htmlFor="auth-em">Email for private link</label>
                <input
                  id="auth-em"
                  type="email"
                  value={authEmail || email}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  required={!user}
                />
              </div>
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy
              ? 'Submitting…'
              : editOnly
                ? 'Save dossier for future applications'
                : 'Save & express interest'}
          </button>
        </form>
      )}
    </Shell>
  );
}
