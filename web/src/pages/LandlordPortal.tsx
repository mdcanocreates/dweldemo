import { useEffect, useState, type ReactNode } from 'react';
import {
  Link,
  Navigate,
  Outlet,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { PortalShell } from '../components/PortalShell';
import { EmptyState, ErrorState, Shell } from '../components/Shell';
import { formatBedsBaths, moneyFromCents } from '../format';
import { ConnectPaymentsPage } from './BrokerPortal';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const LANDLORD_NAV = [
  { to: '/landlord', label: 'Overview', end: true },
  { to: '/landlord/listings', label: 'My listings' },
  { to: '/landlord/listings/new', label: 'New listing' },
  { to: '/landlord/settings', label: 'Settings' },
  { to: '/landlord/settings/payments', label: 'Payments' },
  { to: '/landlord/settings/self-execution', label: 'Self-execution' },
  { to: '/calculator', label: 'NOI calculator' },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function LandlordFrame({ children }: { children: ReactNode }) {
  return (
    <PortalShell
      navLabel="Workspace"
      topEyebrow="Owner workspace"
      topTitle="Landlord portal"
      footTitle="dwel.20 for owners"
      footBody="Fill your next vacancy with a better signal."
      links={LANDLORD_NAV}
    >
      {children}
    </PortalShell>
  );
}

export function LandlordGuard() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <Shell>
        <p>Checking sign-in…</p>
      </Shell>
    );
  }
  if (!user) return <Navigate to="/sign-in?role=landlord" replace />;
  if (!user.landlordOrgId) {
    return (
      <Shell>
        <EmptyState title="Landlord organization not linked">
          You’re signed in, but this account has no landlord organization role yet. Ask an admin to
          grant a landlord role on your org, then refresh.
        </EmptyState>
      </Shell>
    );
  }
  return (
    <LandlordFrame>
      <Outlet />
    </LandlordFrame>
  );
}

export function LandlordOverviewPage() {
  const [listings, setListings] = useState<
    Awaited<ReturnType<typeof api.landlordListings>>['listings'] | null
  >(null);
  const [latest, setLatest] = useState<
    Array<{
      application_id: string;
      listing_id: string;
      listing_label: string;
      status: string;
      created_at: string;
      match_score_value: number | null;
      match_score_version: string | null;
      approved: boolean;
      name: string | null;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.landlordListings();
        if (cancelled) return;
        setListings(data.listings);
        const withApps = data.listings
          .filter((l) => l.applicant_count > 0)
          .slice(0, 6);
        const bundles = await Promise.all(
          withApps.map(async (l) => {
            try {
              const apps = await api.landlordApplicants(l.id);
              return apps.applicants.map((a) => ({
                application_id: a.application_id,
                listing_id: l.id,
                listing_label: [l.line1, l.city].filter(Boolean).join(', ') || l.id.slice(0, 8),
                status: a.status,
                created_at: a.created_at,
                match_score_value: a.match_score_value ?? null,
                match_score_version: a.match_score_version ?? null,
                approved: a.status === 'approved' && Boolean(a.contact),
                name: a.contact
                  ? `${a.contact.given_name ?? ''} ${a.contact.family_name ?? ''}`.trim() || null
                  : null,
              }));
            } catch {
              return [];
            }
          }),
        );
        if (cancelled) return;
        const flat = bundles.flat().sort((a, b) => b.created_at.localeCompare(a.created_at));
        setLatest(flat.slice(0, 8));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load overview.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const active = listings?.filter((l) => l.status === 'active').length ?? 0;
  const totalApps = listings?.reduce((n, l) => n + l.applicant_count, 0) ?? 0;
  const needsAttention =
    listings?.filter((l) => l.status === 'active' && l.applicant_count > 0).length ?? 0;

  return (
    <div className="stack">
      <p className="section-eyebrow">Overview</p>
      <h1>Portfolio pulse</h1>
      <p className="muted">Live vacancy and applicant signal — no fabricated stats.</p>
      {error && <ErrorState title="Overview unavailable">{error}</ErrorState>}
      {!listings && !error && <p>Loading…</p>}
      {listings && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <p className="ll-stat-label">Listings</p>
              <p className="ll-stat-num">{listings.length}</p>
            </div>
            <div className="stat">
              <p className="ll-stat-label">Active</p>
              <p className="ll-stat-num">{active}</p>
            </div>
            <div className="stat">
              <p className="ll-stat-label">Applicants</p>
              <p className="ll-stat-num">{totalApps}</p>
            </div>
            <div className="stat">
              <p className="ll-stat-label">Need attention</p>
              <p className="ll-stat-num">{needsAttention}</p>
            </div>
          </div>
          {needsAttention > 0 && (
            <div className="callout warn">
              <strong>
                {needsAttention === 1
                  ? 'One listing needs attention'
                  : `${needsAttention} listings need attention`}
              </strong>
              Active units with applicants waiting for review.
            </div>
          )}
          <div className="panel stack">
            <div className="row-between">
              <h2>Latest applicants</h2>
              <Link to="/landlord/listings">All listings →</Link>
            </div>
            {latest.length === 0 ? (
              <p className="muted">No applicants yet.</p>
            ) : (
              <ul className="overview-applicant-list">
                {latest.map((a) => (
                  <li key={a.application_id}>
                    <Link to={`/landlord/listings/${a.listing_id}/applicants`}>
                      <span className="overview-app-id">
                        {a.approved && a.name
                          ? a.name
                          : `Applicant · ${a.application_id.slice(0, 8)}`}
                      </span>
                      <span className="muted">{a.listing_label}</span>
                      {a.match_score_value != null && (
                        <span
                          className={`match-score-badge ${
                            a.match_score_value >= 80
                              ? 'match-high'
                              : a.match_score_value >= 50
                                ? 'match-mid'
                                : 'match-low'
                          }`}
                          title={a.match_score_version ?? 'rules_based_v1'}
                        >
                          {a.match_score_value}
                          <span className="match-score-tag">rules_based_v1</span>
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel stack">
            <h2>Quick links</h2>
            <p>
              <Link to="/landlord/listings">Your listings</Link>
              {' · '}
              <Link to="/landlord/listings/new">Publish a unit</Link>
              {' · '}
              <Link to="/landlord/settings">Screening mode</Link>
              {' · '}
              <Link to="/calculator">NOI calculator</Link>
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export function LandlordListingsPage() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.landlordListings>>['listings'] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const data = await api.landlordListings();
    setRows(data.listings);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.landlordListings();
        if (!cancelled) setRows(data.listings);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load listings.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function setStatus(id: string, status: 'active' | 'paused' | 'rented') {
    try {
      await api.landlordSetStatus(id, status);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Status update failed.');
    }
  }

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <p className="section-eyebrow">Portfolio</p>
          <h1>My listings</h1>
          <p className="muted">Photo, status, vacancy days, and applicant count per unit.</p>
        </div>
        <Link className="btn btn-primary" to="/landlord/listings/new">
          Add listing
        </Link>
      </div>
      {error && <ErrorState title="Listings error">{error}</ErrorState>}
      {rows === null && !error && <p>Loading…</p>}
      {rows && rows.length === 0 && (
        <EmptyState title="No listings yet">
          Create a listing to publish a unit to the marketplace.
        </EmptyState>
      )}
      {rows && rows.length > 0 && (
        <div className="ll-grid">
          {rows.map((r) => {
            const title = [r.line1, r.city, r.state].filter(Boolean).join(', ') || r.id;
            return (
              <article key={r.id} className="ll-card">
                <div className="ll-card-media">
                  {r.photo_url ? (
                    <img src={r.photo_url} alt="" />
                  ) : (
                    <div className="ll-card-placeholder">No photo</div>
                  )}
                  <span className={`status-pill status-${r.status}`}>{r.status}</span>
                  <span className="ll-rent">{moneyFromCents(r.rent_amount_cents)} / mo</span>
                </div>
                <div className="ll-card-body">
                  <h2>{title}</h2>
                  <p className="muted">{formatBedsBaths(r.bedrooms, r.bathrooms)}</p>
                  <div className="ll-stats">
                    <div>
                      <p className="ll-stat-num">{r.days_vacant}</p>
                      <p className="ll-stat-label">days vacant</p>
                    </div>
                    <div>
                      <p className="ll-stat-num">{r.applicant_count}</p>
                      <p className="ll-stat-label">applicants</p>
                    </div>
                  </div>
                  <div className="ll-actions">
                    <Link className="btn btn-secondary" to={`/landlord/listings/${r.id}/edit`}>
                      Edit
                    </Link>
                    <Link className="btn btn-secondary" to={`/landlord/listings/${r.id}/applicants`}>
                      Applicants
                    </Link>
                    {r.status !== 'active' && r.status !== 'rented' && (
                      <button type="button" className="btn btn-soft" onClick={() => void setStatus(r.id, 'active')}>
                        Publish
                      </button>
                    )}
                    {r.status === 'active' && (
                      <button type="button" className="btn btn-soft" onClick={() => void setStatus(r.id, 'paused')}>
                        Pause
                      </button>
                    )}
                    {r.status !== 'rented' && (
                      <button type="button" className="btn btn-soft" onClick={() => void setStatus(r.id, 'rented')}>
                        Mark rented
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ListingFormFields(props: {
  address: string;
  setAddress: (v: string) => void;
  addressLocked?: boolean;
  rent: string;
  setRent: (v: string) => void;
  beds: string;
  setBeds: (v: string) => void;
  baths: string;
  setBaths: (v: string) => void;
  sqft: string;
  setSqft: (v: string) => void;
  availableOn: string;
  setAvailableOn: (v: string) => void;
  pets: boolean;
  setPets: (v: boolean) => void;
  amenities: string;
  setAmenities: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  status: 'draft' | 'active' | 'paused';
  setStatus: (v: 'draft' | 'active' | 'paused') => void;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor="ll-address">Address</label>
        <input
          id="ll-address"
          required
          disabled={props.addressLocked}
          value={props.address}
          onChange={(e) => props.setAddress(e.target.value)}
        />
      </div>
      <div className="form-grid two">
        <div className="field">
          <label htmlFor="ll-rent">Monthly rent ($)</label>
          <input
            id="ll-rent"
            required
            type="number"
            min={1}
            value={props.rent}
            onChange={(e) => props.setRent(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ll-sqft">Sq ft</label>
          <input
            id="ll-sqft"
            type="number"
            min={1}
            value={props.sqft}
            onChange={(e) => props.setSqft(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ll-beds">Bedrooms</label>
          <input
            id="ll-beds"
            type="number"
            min={0}
            step={0.5}
            value={props.beds}
            onChange={(e) => props.setBeds(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ll-baths">Bathrooms</label>
          <input
            id="ll-baths"
            type="number"
            min={0}
            step={0.5}
            value={props.baths}
            onChange={(e) => props.setBaths(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ll-avail">Available on</label>
          <input
            id="ll-avail"
            type="date"
            value={props.availableOn}
            onChange={(e) => props.setAvailableOn(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ll-status">Status</label>
          <select
            id="ll-status"
            value={props.status}
            onChange={(e) => props.setStatus(e.target.value as 'draft' | 'active' | 'paused')}
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={props.pets}
            onChange={(e) => props.setPets(e.target.checked)}
          />{' '}
          Pets allowed
        </label>
      </div>
      <div className="field">
        <label htmlFor="ll-amenities">Amenities (comma-separated)</label>
        <input
          id="ll-amenities"
          value={props.amenities}
          onChange={(e) => props.setAmenities(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="ll-desc">Description</label>
        <textarea
          id="ll-desc"
          rows={4}
          value={props.description}
          onChange={(e) => props.setDescription(e.target.value)}
        />
      </div>
    </>
  );
}

export function LandlordNewListingPage() {
  const navigate = useNavigate();
  const [address, setAddress] = useState('');
  const [rent, setRent] = useState('1800');
  const [beds, setBeds] = useState('2');
  const [baths, setBaths] = useState('1');
  const [sqft, setSqft] = useState('');
  const [availableOn, setAvailableOn] = useState('');
  const [pets, setPets] = useState(false);
  const [amenities, setAmenities] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'draft' | 'active' | 'paused'>('draft');
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.landlordCreateListing({
        address_raw: address,
        rent_amount_cents: Math.round(Number(rent) * 100),
        bedrooms: Number(beds),
        bathrooms: Number(baths),
        sqft: sqft ? Number(sqft) : undefined,
        pets_allowed: pets,
        amenities: amenities
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        description: description || undefined,
        available_on: availableOn || undefined,
        status,
      });
      if (photo) {
        const file_base64 = await fileToBase64(photo);
        await api.landlordUploadPhoto(created.listing_id, {
          content_type: photo.type || 'image/jpeg',
          filename: photo.name,
          file_base64,
        });
      }
      navigate('/landlord/listings');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create listing.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: '40rem' }}>
      <p className="section-eyebrow">Supply</p>
      <h1>New listing</h1>
      <p className="muted">Creates a unit through the supply ingest path. Photos upload to S3.</p>
      <form className="panel stack" onSubmit={(e) => void onSubmit(e)}>
        <ListingFormFields
          address={address}
          setAddress={setAddress}
          rent={rent}
          setRent={setRent}
          beds={beds}
          setBeds={setBeds}
          baths={baths}
          setBaths={setBaths}
          sqft={sqft}
          setSqft={setSqft}
          availableOn={availableOn}
          setAvailableOn={setAvailableOn}
          pets={pets}
          setPets={setPets}
          amenities={amenities}
          setAmenities={setAmenities}
          description={description}
          setDescription={setDescription}
          status={status}
          setStatus={setStatus}
        />
        <div className="field">
          <label htmlFor="ll-photo">Photo (required for marketplace galleries)</label>
          <input
            id="ll-photo"
            type="file"
            accept="image/*"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          <span className="hint">Uploaded via S3 after create. Prefer JPEG/PNG under 5MB.</span>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create listing'}
        </button>
      </form>
      {error && <ErrorState title="Create failed">{error}</ErrorState>}
    </div>
  );
}

export function LandlordEditListingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [address, setAddress] = useState('');
  const [rent, setRent] = useState('');
  const [beds, setBeds] = useState('');
  const [baths, setBaths] = useState('');
  const [sqft, setSqft] = useState('');
  const [availableOn, setAvailableOn] = useState('');
  const [pets, setPets] = useState(false);
  const [amenities, setAmenities] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'draft' | 'active' | 'paused'>('draft');
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.landlordListings();
        const row = data.listings.find((l) => l.id === id);
        if (!row) throw new Error('Listing not found');
        if (cancelled) return;
        setAddress([row.line1, row.city, row.state].filter(Boolean).join(', '));
        setRent(String(row.rent_amount_cents / 100));
        setBeds(String(row.bedrooms ?? ''));
        setBaths(String(row.bathrooms ?? ''));
        setSqft(row.sqft != null ? String(row.sqft) : '');
        setAvailableOn(row.available_on ?? '');
        setPets(Boolean(row.pets_allowed));
        setAmenities((row.amenities ?? []).join(', '));
        setStatus(row.status === 'active' || row.status === 'paused' ? row.status : 'draft');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.landlordUpdateListing(id, {
        rent_amount_cents: Math.round(Number(rent) * 100),
        bedrooms: beds === '' ? undefined : Number(beds),
        bathrooms: baths === '' ? undefined : Number(baths),
        sqft: sqft ? Number(sqft) : null,
        pets_allowed: pets,
        amenities: amenities
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        description: description || null,
        available_on: availableOn || null,
        status,
      });
      if (photo) {
        const file_base64 = await fileToBase64(photo);
        await api.landlordUploadPhoto(id, {
          content_type: photo.type || 'image/jpeg',
          filename: photo.name,
          file_base64,
        });
      }
      navigate('/landlord/listings');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p>Loading…</p>;

  return (
    <div className="stack" style={{ maxWidth: '40rem' }}>
      <p className="section-eyebrow">Edit</p>
      <h1>Edit listing</h1>
      <form className="panel stack" onSubmit={(e) => void onSubmit(e)}>
        <ListingFormFields
          address={address}
          setAddress={setAddress}
          addressLocked
          rent={rent}
          setRent={setRent}
          beds={beds}
          setBeds={setBeds}
          baths={baths}
          setBaths={setBaths}
          sqft={sqft}
          setSqft={setSqft}
          availableOn={availableOn}
          setAvailableOn={setAvailableOn}
          pets={pets}
          setPets={setPets}
          amenities={amenities}
          setAmenities={setAmenities}
          description={description}
          setDescription={setDescription}
          status={status}
          setStatus={setStatus}
        />
        <div className="field">
          <label htmlFor="ll-photo-edit">Add photo</label>
          <input
            id="ll-photo-edit"
            type="file"
            accept="image/*"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>
      {error && <ErrorState title="Edit failed">{error}</ErrorState>}
    </div>
  );
}

export function LandlordApplicantsPage() {
  const { id } = useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.landlordApplicants>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [moreInfo, setMoreInfo] = useState<Record<string, string>>({});

  async function reload() {
    if (!id) return;
    const next = await api.landlordApplicants(id);
    setData(next);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      try {
        const next = await api.landlordApplicants(id);
        if (!cancelled) setData(next);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load applicants.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function decide(
    applicationId: string,
    decision: 'approve' | 'decline' | 'request_screening' | 'pass' | 'request_more_info',
  ) {
    if (!id) return;
    setBusyId(applicationId);
    setError(null);
    try {
      await api.landlordDecide(id, applicationId, {
        decision,
        note: decision === 'request_more_info' ? moreInfo[applicationId] : undefined,
      });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Decision failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="stack">
      <p className="section-eyebrow">Qualified pipeline</p>
      <h1>Applicants</h1>
      <p className="muted">
        Contact details stay masked until you approve. Screening mode:{' '}
        <strong>{data?.screening_mode ?? '…'}</strong>
      </p>
      {error && <ErrorState title="Applicants error">{error}</ErrorState>}
      {!data && !error && <p>Loading…</p>}
      {data && data.applicants.length === 0 && (
        <EmptyState title="No applicants yet">Applications for this listing will appear here.</EmptyState>
      )}
      {data && data.applicants.length > 0 && (
        <div className="applicant-grid">
          {data.applicants.map((a) => {
            const manual =
              data.screening_mode === 'manual_review' &&
              a.status === 'awaiting_landlord_interest';
            const postScreen = a.status === 'screening_complete' || a.status === 'awaiting_consent';
            const approved = a.status === 'approved' && a.contact;
            return (
              <article key={a.application_id} className="panel stack applicant-card">
                <div className="row-between">
                  <div>
                    <p className="section-eyebrow">{a.status}</p>
                    <h2>{approved ? `${a.contact!.given_name ?? ''} ${a.contact!.family_name ?? ''}`.trim() || 'Applicant' : 'Applicant'}</h2>
                    <p className="muted">Applied {new Date(a.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="applicant-score-col">
                    {a.match_score_value != null && (
                      <span
                        className={`match-score-badge ${
                          a.match_score_value >= 80
                            ? 'match-high'
                            : a.match_score_value >= 50
                              ? 'match-mid'
                              : 'match-low'
                        }`}
                        title="Transparent weighted formula — not a trained model"
                      >
                        {a.match_score_value}
                        <span className="match-score-tag">
                          {a.match_score_version ?? 'rules_based_v1'}
                        </span>
                      </span>
                    )}
                    <span className="score-band">{a.score_band}</span>
                  </div>
                </div>
                <div className="stat-grid">
                  <div className="stat">
                    <p className="ll-stat-label">Income band</p>
                    <p>{a.income_band}</p>
                  </div>
                  <div className="stat">
                    <p className="ll-stat-label">Move-in</p>
                    <p>{a.move_in_urgency ?? '—'}</p>
                  </div>
                  <div className="stat">
                    <p className="ll-stat-label">Household</p>
                    <p>{a.household_size ?? '—'}</p>
                  </div>
                  <div className="stat">
                    <p className="ll-stat-label">Pets</p>
                    <p>{a.has_pets == null ? '—' : a.has_pets ? 'Yes' : 'No'}</p>
                  </div>
                </div>
                <div className="stat-grid">
                  {(['credit', 'criminal', 'eviction', 'identity'] as const).map((k) => (
                    <div key={k} className="stat">
                      <p className="ll-stat-label">{k}</p>
                      <p>{a.screening_summary[k]}</p>
                    </div>
                  ))}
                </div>
                {approved && a.contact && (
                  <div className="callout">
                    <p>
                      {a.contact.email} · {a.contact.phone_e164}
                    </p>
                    <p className="hint">
                      Contact revealed on {new Date(a.contact.revealed_at).toLocaleString()}
                    </p>
                    <p className="hint">
                      Next steps: coordinate lease execution with your broker or directly if you hold
                      a license in this state.
                    </p>
                  </div>
                )}
                <div className="ll-actions">
                  {manual && (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busyId === a.application_id}
                        onClick={() => void decide(a.application_id, 'request_screening')}
                      >
                        Request screening
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busyId === a.application_id}
                        onClick={() => void decide(a.application_id, 'pass')}
                      >
                        Pass
                      </button>
                    </>
                  )}
                  {(postScreen || a.status === 'screening_complete') && !approved && a.status !== 'declined' && (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busyId === a.application_id}
                        onClick={() => void decide(a.application_id, 'approve')}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busyId === a.application_id}
                        onClick={() => void decide(a.application_id, 'decline')}
                      >
                        Decline
                      </button>
                    </>
                  )}
                </div>
                {(postScreen || a.status === 'screening_complete') && a.status !== 'declined' && a.status !== 'approved' && (
                  <div className="field">
                    <label htmlFor={`more-${a.application_id}`}>Request more info (interim_v1)</label>
                    <textarea
                      id={`more-${a.application_id}`}
                      rows={2}
                      value={moreInfo[a.application_id] ?? ''}
                      onChange={(e) =>
                        setMoreInfo((prev) => ({ ...prev, [a.application_id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-soft"
                      disabled={busyId === a.application_id || !(moreInfo[a.application_id] ?? '').trim()}
                      onClick={() => void decide(a.application_id, 'request_more_info')}
                    >
                      Send question
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function LandlordSettingsPage() {
  const [mode, setMode] = useState<'auto_screen' | 'manual_review' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.landlordSettings();
        if (!cancelled) setMode(s.screening_mode);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load settings.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const s = await api.landlordUpdateSettings(mode);
      setMode(s.screening_mode);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: '36rem' }}>
      <p className="section-eyebrow">Org settings</p>
      <h1>Screening mode</h1>
      <p className="muted">
        Auto: mutual interest triggers screening. Manual: you review before requesting consent.
      </p>
      <div className="panel stack">
        <div className="field">
          <label htmlFor="screening-mode">Mode</label>
          <select
            id="screening-mode"
            value={mode ?? ''}
            disabled={mode == null}
            onChange={(e) => setMode(e.target.value as 'auto_screen' | 'manual_review')}
          >
            <option value="auto_screen">Auto screen (default)</option>
            <option value="manual_review">Manual review</option>
          </select>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy || !mode} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved && <p className="hint">Saved. Persists for this organization.</p>}
      </div>
      <p>
        <Link to="/landlord/settings/payments">Payment settings (Stripe Connect) →</Link>
      </p>
      <p>
        <Link to="/landlord/settings/self-execution">Self-execution evidence →</Link>
      </p>
      {error && <ErrorState title="Settings error">{error}</ErrorState>}
    </div>
  );
}

export function LandlordPaymentsPage() {
  return <ConnectPaymentsPage audience="landlord" />;
}

export function LandlordSelfExecutionPage() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.landlordSelfExecution>> | null>(
    null,
  );
  const [licenseState, setLicenseState] = useState('TX');
  const [licenseType, setLicenseType] = useState<
    'licensed_broker' | 'licensed_pm' | 'owner_occupant'
  >('licensed_broker');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [entity, setEntity] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setStatus(await api.landlordSelfExecution());
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.landlordSelfExecution();
        if (!cancelled) setStatus(s);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load self-execution status.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pending = status?.submission?.status === 'pending';
  const canSubmit = !pending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        license_state: licenseState,
        license_type: licenseType,
        license_number: licenseType === 'owner_occupant' ? undefined : licenseNumber,
        business_entity_name: entity || undefined,
      };
      if (file) {
        body.file_base64 = await fileToBase64(file);
        body.content_type = file.type || 'application/octet-stream';
        body.original_filename = file.name;
      }
      await api.landlordSubmitSelfExecution(body);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submit failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: '40rem' }}>
      <p className="section-eyebrow">interim_v1</p>
      <h1>Self-execution evidence</h1>
      <p className="muted">
        Manual verification only. Pending blocks re-submission; rejected allows another attempt.
      </p>
      {status?.admin_banner && (
        <div className="callout warn">
          <strong>⚠ {status.admin_banner}</strong>
        </div>
      )}
      {status?.submission && (
        <div className="panel stack">
          <p>
            Latest status: <strong>{status.submission.status}</strong> ·{' '}
            {status.submission.license_type} · {status.submission.license_state}
          </p>
          <p className="hint">Tag: {status.submission.compliance_tag}</p>
          {status.submission.reviewer_notes && <p>{status.submission.reviewer_notes}</p>}
        </div>
      )}
      {canSubmit ? (
        <form className="panel stack" onSubmit={(e) => void onSubmit(e)}>
          <div className="field">
            <label htmlFor="se-state">State of licensure</label>
            <select id="se-state" value={licenseState} onChange={(e) => setLicenseState(e.target.value)}>
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="se-type">License type</label>
            <select
              id="se-type"
              value={licenseType}
              onChange={(e) =>
                setLicenseType(e.target.value as 'licensed_broker' | 'licensed_pm' | 'owner_occupant')
              }
            >
              <option value="licensed_broker">Licensed broker</option>
              <option value="licensed_pm">Licensed PM</option>
              <option value="owner_occupant">Owner occupant</option>
            </select>
          </div>
          {licenseType !== 'owner_occupant' && (
            <div className="field">
              <label htmlFor="se-num">License number</label>
              <input
                id="se-num"
                required
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="se-entity">Business entity name (optional)</label>
            <input id="se-entity" value={entity} onChange={(e) => setEntity(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="se-file">Supporting documentation</label>
            <input
              id="se-file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit evidence'}
          </button>
        </form>
      ) : (
        <EmptyState title="Pending review">
          A submission is already pending. You can resubmit if it is rejected.
        </EmptyState>
      )}
      {error && <ErrorState title="Self-execution error">{error}</ErrorState>}
    </div>
  );
}

/** @deprecated Concept A/B removed — redirect to listings */
export function LandlordApplicationsConceptsPage() {
  return <Navigate to="/landlord/listings" replace />;
}

export function LandlordPortfolioPage() {
  return <Navigate to="/landlord/listings" replace />;
}

export function LandlordCalculatorPage() {
  return <Navigate to="/calculator" replace />;
}
