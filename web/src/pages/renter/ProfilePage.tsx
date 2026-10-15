import { useEffect, useState } from 'react';
import { RenterShell } from '../../components/layout/RenterShell';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { LoadingState } from '../../components/ui/LoadingState';
import { api, ApiError, getSessionToken } from '../../api/client';
import { friendlyApiError } from '../../lib/application-status';

type Urgency = 'immediate' | 'within_30_days' | 'within_60_days' | 'within_90_days' | 'flexible';

export function RenterProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [annualIncome, setAnnualIncome] = useState('');
  const [form, setForm] = useState({
    given_name: '',
    family_name: '',
    email: '',
    phone: '',
    move_in_urgency: 'within_30_days' as Urgency,
    household_size: '1',
    rent_max: '',
    bedrooms_min: '1',
    has_pets: 'false',
    state: '',
  });

  useEffect(() => {
    if (!getSessionToken()) {
      setLoading(false);
      setError('Sign in to edit your profile.');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.getRenterProfile();
        if (cancelled) return;
        const p = res.profile;
        if (p) {
          setForm({
            given_name: p.given_name ?? '',
            family_name: p.family_name ?? '',
            email: p.email ?? '',
            phone: p.phone_e164 ?? '',
            move_in_urgency: (p.move_in_urgency as Urgency) || 'within_30_days',
            household_size: String(p.household_size ?? 1),
            rent_max: p.rent_max_cents != null ? String(Math.round(p.rent_max_cents / 100)) : '',
            bedrooms_min: String(p.bedrooms_min ?? 1),
            has_pets: p.has_pets ? 'true' : 'false',
            state: p.preferred_state ?? '',
          });
          if (p.annual_income_cents != null) {
            setAnnualIncome(String(Math.round(p.annual_income_cents / 100)));
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(friendlyApiError(err instanceof ApiError ? err.message : 'Could not load profile.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const rentDollars = Number(form.rent_max);
      const incomeDollars = Number(annualIncome);
      if (!form.given_name.trim() || !form.family_name.trim()) {
        throw new ApiError('Enter your first and last name.', 400);
      }
      if (!form.phone.trim() || !form.email.trim()) {
        throw new ApiError('Email and phone are required.', 400);
      }
      if (!form.state.trim() || form.state.trim().length !== 2) {
        throw new ApiError('Preferred state must be a 2-letter code (e.g. TX).', 400);
      }
      if (!Number.isFinite(rentDollars) || rentDollars <= 0) {
        throw new ApiError('Enter a valid max rent.', 400);
      }
      if (!Number.isFinite(incomeDollars) || incomeDollars < 0) {
        throw new ApiError('Enter annual income (0 is ok).', 400);
      }
      await api.upsertRenterProfile({
        given_name: form.given_name.trim(),
        family_name: form.family_name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        annual_income_cents: Math.round(incomeDollars * 100),
        move_in_urgency: form.move_in_urgency,
        bedrooms_min: Number(form.bedrooms_min) || 0,
        rent_max_cents: Math.round(rentDollars * 100),
        state: form.state.trim().toUpperCase(),
        has_pets: form.has_pets === 'true',
        household_size: Number(form.household_size) || 1,
      });
      setOk('Profile saved.');
    } catch (err) {
      setError(friendlyApiError(err instanceof ApiError ? err.message : 'Could not save profile.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RenterShell workspace>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-semibold tracking-tight">Renter profile</h1>
          <p className="mt-1 text-sm text-dwel-muted">Complete once, reuse across applications.</p>
        </div>
        <Badge tone="mint">Server-backed</Badge>
      </div>

      {loading ? <div className="mt-6"><LoadingState /></div> : null}
      {error ? <div className="mt-6"><ErrorState message={error} /></div> : null}
      {ok ? (
        <p className="mt-4 rounded-[12px] bg-dwel-mint-soft px-3 py-2 text-sm text-dwel-success" role="status">
          {ok}
        </p>
      ) : null}

      {!loading ? (
        <>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card className="p-[18px]">
              <h2 className="text-xl font-semibold">About you</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">First name</span>
                  <input
                    className="min-h-11 rounded-[10px] border border-dwel-line px-3"
                    value={form.given_name}
                    onChange={(e) => setForm((f) => ({ ...f, given_name: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Last name</span>
                  <input
                    className="min-h-11 rounded-[10px] border border-dwel-line px-3"
                    value={form.family_name}
                    onChange={(e) => setForm((f) => ({ ...f, family_name: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Email</span>
                  <input
                    type="email"
                    className="min-h-11 rounded-[10px] border border-dwel-line px-3"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Phone</span>
                  <input
                    className="min-h-11 rounded-[10px] border border-dwel-line px-3"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Move-in</span>
                  <select
                    className="min-h-11 rounded-[10px] border border-dwel-line px-3"
                    value={form.move_in_urgency}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, move_in_urgency: e.target.value as Urgency }))
                    }
                  >
                    <option value="immediate">ASAP</option>
                    <option value="within_30_days">Within 30 days</option>
                    <option value="within_60_days">Within 60 days</option>
                    <option value="within_90_days">Within 90 days</option>
                    <option value="flexible">Flexible</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Household size</span>
                  <input
                    type="number"
                    min={1}
                    className="min-h-11 rounded-[10px] border border-dwel-line px-3"
                    value={form.household_size}
                    onChange={(e) => setForm((f) => ({ ...f, household_size: e.target.value }))}
                  />
                </label>
              </div>
            </Card>
            <Card className="p-[18px]">
              <h2 className="text-xl font-semibold">Housing preferences</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Max rent ($/mo)</span>
                  <input
                    type="number"
                    min={1}
                    className="min-h-11 rounded-[10px] border border-dwel-line px-3"
                    value={form.rent_max}
                    onChange={(e) => setForm((f) => ({ ...f, rent_max: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Bedrooms (min)</span>
                  <input
                    type="number"
                    min={0}
                    className="min-h-11 rounded-[10px] border border-dwel-line px-3"
                    value={form.bedrooms_min}
                    onChange={(e) => setForm((f) => ({ ...f, bedrooms_min: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Pets</span>
                  <select
                    className="min-h-11 rounded-[10px] border border-dwel-line px-3"
                    value={form.has_pets}
                    onChange={(e) => setForm((f) => ({ ...f, has_pets: e.target.value }))}
                  >
                    <option value="false">No pets</option>
                    <option value="true">Has pets</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Preferred state</span>
                  <input
                    maxLength={2}
                    placeholder="TX"
                    className="min-h-11 rounded-[10px] border border-dwel-line px-3 uppercase"
                    value={form.state}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1.5 text-sm sm:col-span-2">
                  <span className="font-medium">Annual income ($)</span>
                  <input
                    type="number"
                    min={0}
                    className="min-h-11 rounded-[10px] border border-dwel-line px-3"
                    value={annualIncome}
                    onChange={(e) => setAnnualIncome(e.target.value)}
                  />
                  <span className="text-xs text-dwel-muted">
                    Used for prequalification matching — not a consumer report.
                  </span>
                </label>
              </div>
            </Card>
          </div>
          <div className="mt-4">
            <Button className="min-h-11" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </>
      ) : null}
    </RenterShell>
  );
}
