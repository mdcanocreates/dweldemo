import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { LandlordShell } from '../../components/layout/LandlordShell';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { api, ApiError, getSessionToken } from '../../api/client';
import { formatCents } from '../../lib/money';
import { isUiPreviewActive } from '../../lib/ui-preview';
import { getUiPreviewUniverse, previewCreateListing } from '../../lib/ui-preview-data';
import {
  ListingMediaManager,
  type MediaItem,
} from '../../components/listing/ListingMediaManager';

const STEPS = [
  'Address',
  'Pricing',
  'Details',
  'Description',
  'Photos',
  'Criteria',
  'Review',
] as const;
const MAX_PHOTOS = 15;

type FormState = {
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  property_type: string;
  rent_amount_cents: string;
  deposit_cents: string;
  available_on: string;
  lease_months: string;
  bedrooms: string;
  bathrooms: string;
  sqft: string;
  pets_allowed: boolean;
  parking: string;
  utilities: string;
  amenities: string;
  headline: string;
  description: string;
  restrictions: string;
  status: 'draft' | 'active' | 'paused';
  criteria_min_income_ratio: string;
  criteria_move_in_days: string;
  criteria_pets_allowed: boolean;
  criteria_max_occupants: string;
  criteria_lease_term: string;
  criteria_require_complete_profile: boolean;
};

const empty: FormState = {
  street: '',
  unit: '',
  city: '',
  state: '',
  zip: '',
  property_type: 'apartment',
  rent_amount_cents: '',
  deposit_cents: '',
  available_on: '',
  lease_months: '12',
  bedrooms: '1',
  bathrooms: '1',
  sqft: '',
  pets_allowed: false,
  parking: '',
  utilities: '',
  amenities: '',
  headline: '',
  description: '',
  restrictions: '',
  status: 'draft',
  criteria_min_income_ratio: '3',
  criteria_move_in_days: '60',
  criteria_pets_allowed: false,
  criteria_max_occupants: '4',
  criteria_lease_term: '12',
  criteria_require_complete_profile: true,
};

function buildAddressRaw(f: FormState): string {
  const line = [f.street, f.unit].filter(Boolean).join(' ');
  return [line, f.city, `${f.state} ${f.zip}`.trim()].filter(Boolean).join(', ');
}

function buildDescription(f: FormState): string {
  const parts: string[] = [];
  if (f.headline.trim()) parts.push(f.headline.trim());
  if (f.description.trim()) parts.push(f.description.trim());
  if (f.restrictions.trim()) parts.push(`Terms: ${f.restrictions.trim()}`);
  if (f.parking.trim()) parts.push(`Parking: ${f.parking.trim()}`);
  if (f.utilities.trim()) parts.push(`Utilities: ${f.utilities.trim()}`);
  return parts.join('\n\n');
}

function parseAmenities(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const base64 = result.includes(',') ? result.split(',')[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/** Create / edit listing wizard — POST/PUT /v1/landlord/listings (or preview adapter). */
export function LandlordListingFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const params = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(empty);
  const [photos, setPhotos] = useState<MediaItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(mode === 'edit');
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'edit' || !params.id) return;
    let cancelled = false;
    void (async () => {
      try {
        if (isUiPreviewActive()) {
          const row = getUiPreviewUniverse().listings.find((l) => l.id === params.id);
          if (!row) throw new Error('Listing not found in preview data');
          if (cancelled) return;
          const crit = getUiPreviewUniverse().criteria?.[params.id!];
          setForm({
            ...empty,
            street: row.line1 ?? '',
            city: row.city ?? '',
            state: row.state ?? '',
            rent_amount_cents: String(row.rent_amount_cents / 100),
            deposit_cents: String((row.deposit_cents ?? 0) / 100),
            bedrooms: String(row.bedrooms ?? 1),
            bathrooms: String(row.bathrooms ?? 1),
            description: row.description ?? '',
            status: (['draft', 'active', 'paused'].includes(row.status)
              ? row.status
              : 'draft') as FormState['status'],
            criteria_min_income_ratio: String(crit?.rules.min_income_to_rent_ratio ?? 3),
            criteria_move_in_days: String(crit?.rules.move_in_window_days ?? 60),
            criteria_pets_allowed: crit?.rules.pets_allowed ?? false,
            criteria_max_occupants: String(crit?.rules.max_occupants ?? 4),
            criteria_lease_term: String(
              Array.isArray(crit?.rules.lease_term_months)
                ? crit?.rules.lease_term_months[0]
                : crit?.rules.lease_term_months ?? 12,
            ),
            criteria_require_complete_profile: crit?.rules.require_complete_profile ?? true,
          });
        } else {
          if (!getSessionToken()) throw new Error('Sign in required');
          const res = await api.landlordListings();
          const row = res.listings.find((l) => l.id === params.id);
          if (!row) throw new Error('Listing not found');
          if (cancelled) return;
          let criteriaPatch: Partial<FormState> = {};
          try {
            const critRes = await api.getListingCriteria(params.id!);
            const rules = critRes.criteria?.rules;
            if (rules) {
              criteriaPatch = {
                criteria_min_income_ratio:
                  rules.min_income_to_rent_ratio != null
                    ? String(rules.min_income_to_rent_ratio)
                    : empty.criteria_min_income_ratio,
                criteria_move_in_days:
                  rules.move_in_window_days != null
                    ? String(rules.move_in_window_days)
                    : empty.criteria_move_in_days,
                criteria_pets_allowed: rules.pets_allowed ?? false,
                criteria_max_occupants:
                  rules.max_occupants != null
                    ? String(rules.max_occupants)
                    : empty.criteria_max_occupants,
                criteria_lease_term: String(
                  Array.isArray(rules.lease_term_months)
                    ? rules.lease_term_months[0] ?? 12
                    : rules.lease_term_months ?? 12,
                ),
                criteria_require_complete_profile: rules.require_complete_profile ?? true,
              };
            }
          } catch {
            /* criteria optional on load */
          }
          setForm({
            ...empty,
            street: row.line1 ?? '',
            city: row.city ?? '',
            state: row.state ?? '',
            rent_amount_cents: String(row.rent_amount_cents / 100),
            deposit_cents: '',
            bedrooms: String(row.bedrooms ?? 1),
            bathrooms: String(row.bathrooms ?? 1),
            status: (['draft', 'active', 'paused'].includes(row.status)
              ? row.status
              : 'draft') as FormState['status'],
            ...criteriaPatch,
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load listing');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, params.id]);

  function validateStep(index: number): string | null {
    if (index === 0) {
      if (!form.street.trim()) return 'Street address is required';
      if (!form.city.trim()) return 'City is required';
      if (!form.state.trim()) return 'State is required';
      if (!form.zip.trim()) return 'ZIP code is required';
    }
    if (index === 1) {
      const rent = Number(form.rent_amount_cents);
      if (!Number.isFinite(rent) || rent <= 0) return 'Enter a valid monthly rent';
    }
    return null;
  }

  function nextStep() {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function uploadPhotos(listingId: string) {
    const withFiles = photos.filter((p) => p.file);
    if (withFiles.length === 0) return;
    for (let i = 0; i < withFiles.length; i++) {
      const p = withFiles[i]!;
      const file = p.file!;
      setUploadProgress(`Uploading photo ${i + 1} of ${withFiles.length}…`);
      setPhotos((prev) =>
        prev.map((item) =>
          item.id === p.id ? { ...item, status: 'uploading' as const, progress: 10 } : item,
        ),
      );
      try {
        await api.uploadListingPhoto(listingId, {
          content_type: file.type,
          filename: file.name,
          file_base64: await fileToBase64(file),
        });
        setPhotos((prev) =>
          prev.map((item) =>
            item.id === p.id ? { ...item, status: 'ready' as const, progress: 100 } : item,
          ),
        );
      } catch (err) {
        setPhotos((prev) =>
          prev.map((item) =>
            item.id === p.id
              ? {
                  ...item,
                  status: 'error' as const,
                  error: err instanceof Error ? err.message : 'Upload failed',
                }
              : item,
          ),
        );
        throw err;
      }
    }
    setUploadProgress(null);
  }

  function buildCriteriaBody() {
    const ratio = Number(form.criteria_min_income_ratio);
    const moveIn = Number(form.criteria_move_in_days);
    const maxOcc = Number(form.criteria_max_occupants);
    const leaseTerm = Number(form.criteria_lease_term);
    return {
      jurisdiction: form.state.trim().slice(0, 2) || null,
      rules: {
        ...(Number.isFinite(ratio) && ratio > 0 ? { min_income_to_rent_ratio: ratio } : {}),
        ...(Number.isFinite(moveIn) && moveIn >= 0 ? { move_in_window_days: Math.trunc(moveIn) } : {}),
        pets_allowed: form.criteria_pets_allowed,
        ...(Number.isFinite(maxOcc) && maxOcc > 0 ? { max_occupants: Math.trunc(maxOcc) } : {}),
        ...(Number.isFinite(leaseTerm) && leaseTerm > 0
          ? { lease_term_months: Math.trunc(leaseTerm) }
          : {}),
        require_complete_profile: form.criteria_require_complete_profile,
      },
    };
  }

  async function saveCriteria(listingId: string) {
    await api.putListingCriteria(listingId, buildCriteriaBody());
  }

  async function submit(publish: boolean) {
    for (let i = 0; i <= 1; i++) {
      const err = validateStep(i);
      if (err) {
        setError(err);
        setStep(i);
        return;
      }
    }
    setSaving(true);
    setError(null);
    const rent = Math.round(Number(form.rent_amount_cents) * 100);
    const deposit = form.deposit_cents ? Math.round(Number(form.deposit_cents) * 100) : undefined;
    const status = publish ? 'active' : 'draft';
    const payload = {
      address_raw: buildAddressRaw(form),
      rent_amount_cents: rent,
      deposit_cents: deposit,
      bedrooms: Number(form.bedrooms),
      bathrooms: Number(form.bathrooms),
      sqft: form.sqft ? Number(form.sqft) : undefined,
      description: buildDescription(form) || undefined,
      pets_allowed: form.pets_allowed,
      amenities: parseAmenities(form.amenities),
      available_on: form.available_on || undefined,
      status: status as 'draft' | 'active',
    };
    try {
      if (mode === 'create') {
        let listingId: string;
        if (isUiPreviewActive()) {
          const created = previewCreateListing({ ...payload, status });
          listingId = created.id;
        } else {
          const created = await api.createLandlordListing(payload);
          listingId = created.listing_id ?? created.listing?.id ?? created.id ?? '';
          if (!listingId) throw new Error('Create succeeded but no listing id returned');
        }
        await saveCriteria(listingId);
        await uploadPhotos(listingId);
        setLocation(`/landlord/listings/${listingId}`);
      } else if (params.id) {
        if (isUiPreviewActive()) {
          await api.updateLandlordListing(params.id, {
            ...payload,
            status,
          });
        } else {
          await api.updateLandlordListing(params.id, {
            rent_amount_cents: rent,
            deposit_cents: deposit ?? null,
            bedrooms: Number(form.bedrooms),
            bathrooms: Number(form.bathrooms),
            sqft: form.sqft ? Number(form.sqft) : null,
            description: buildDescription(form) || null,
            pets_allowed: form.pets_allowed,
            amenities: parseAmenities(form.amenities),
            available_on: form.available_on || null,
            status,
          });
        }
        await saveCriteria(params.id);
        await uploadPhotos(params.id);
        setLocation(`/landlord/listings/${params.id}`);
      }
    } catch (err) {
      setUploadProgress(null);
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'mt-1 w-full rounded-[10px] border border-dwel-line px-3 py-2 text-sm';

  return (
    <LandlordShell>
      <div className="mb-4">
        <Link href="/listings" className="text-sm text-dwel-muted underline">
          ← Listings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {mode === 'create' ? 'Create listing' : 'Edit listing'}
        </h1>
        <p className="mt-1 text-sm text-dwel-muted">
          {isUiPreviewActive()
            ? 'Preview adapter — changes stay in memory only.'
            : 'Saves through the Home Provider listings API.'}
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => i <= step && setStep(i)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              i === step
                ? 'bg-dwel-blue text-white'
                : i < step
                  ? 'bg-[#eaf0ff] text-dwel-blue'
                  : 'bg-dwel-surface2 text-dwel-muted'
            }`}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-dwel-muted">Loading…</p>
      ) : (
        <Card className="p-5">
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Address</h2>
              <label className="block text-sm">
                <span className="font-medium">Street</span>
                <input
                  required
                  className={inputClass}
                  value={form.street}
                  onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Unit (optional)</span>
                <input
                  className={inputClass}
                  value={form.unit}
                  onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="font-medium">City</span>
                  <input
                    required
                    className={inputClass}
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">State</span>
                  <input
                    required
                    maxLength={2}
                    className={inputClass}
                    value={form.state}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">ZIP</span>
                  <input
                    required
                    className={inputClass}
                    value={form.zip}
                    onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))}
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="font-medium">Property type</span>
                <select
                  className={inputClass}
                  value={form.property_type}
                  onChange={(e) => setForm((f) => ({ ...f, property_type: e.target.value }))}
                >
                  <option value="apartment">Apartment</option>
                  <option value="house">House</option>
                  <option value="condo">Condo</option>
                  <option value="townhouse">Townhouse</option>
                </select>
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Pricing and availability</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium">Monthly rent ($)</span>
                  <input
                    required
                    type="number"
                    min="1"
                    className={inputClass}
                    value={form.rent_amount_cents}
                    onChange={(e) => setForm((f) => ({ ...f, rent_amount_cents: e.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Deposit ($)</span>
                  <input
                    type="number"
                    min="0"
                    className={inputClass}
                    value={form.deposit_cents}
                    onChange={(e) => setForm((f) => ({ ...f, deposit_cents: e.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Available date</span>
                  <input
                    type="date"
                    className={inputClass}
                    value={form.available_on}
                    onChange={(e) => setForm((f) => ({ ...f, available_on: e.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Lease duration (months)</span>
                  <input
                    type="number"
                    min="1"
                    className={inputClass}
                    value={form.lease_months}
                    onChange={(e) => setForm((f) => ({ ...f, lease_months: e.target.value }))}
                  />
                </label>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Property details</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="font-medium">Beds</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    className={inputClass}
                    value={form.bedrooms}
                    onChange={(e) => setForm((f) => ({ ...f, bedrooms: e.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Baths</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    className={inputClass}
                    value={form.bathrooms}
                    onChange={(e) => setForm((f) => ({ ...f, bathrooms: e.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Square footage</span>
                  <input
                    type="number"
                    min="1"
                    className={inputClass}
                    value={form.sqft}
                    onChange={(e) => setForm((f) => ({ ...f, sqft: e.target.value }))}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.pets_allowed}
                  onChange={(e) => setForm((f) => ({ ...f, pets_allowed: e.target.checked }))}
                />
                Pets allowed
              </label>
              <label className="block text-sm">
                <span className="font-medium">Parking</span>
                <input
                  className={inputClass}
                  value={form.parking}
                  onChange={(e) => setForm((f) => ({ ...f, parking: e.target.value }))}
                  placeholder="e.g. 1 assigned spot"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Utilities</span>
                <input
                  className={inputClass}
                  value={form.utilities}
                  onChange={(e) => setForm((f) => ({ ...f, utilities: e.target.value }))}
                  placeholder="e.g. Water included"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Amenities (comma-separated)</span>
                <input
                  className={inputClass}
                  value={form.amenities}
                  onChange={(e) => setForm((f) => ({ ...f, amenities: e.target.value }))}
                  placeholder="Pool, gym, in-unit laundry"
                />
              </label>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Description</h2>
              <label className="block text-sm">
                <span className="font-medium">Headline</span>
                <input
                  className={inputClass}
                  value={form.headline}
                  onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
                  placeholder="Bright 1-bedroom near downtown"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Public description</span>
                <textarea
                  className={inputClass}
                  rows={5}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Restrictions / terms</span>
                <textarea
                  className={inputClass}
                  rows={3}
                  value={form.restrictions}
                  onChange={(e) => setForm((f) => ({ ...f, restrictions: e.target.value }))}
                />
              </label>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Photos</h2>
              <ListingMediaManager
                photos={photos}
                onChange={setPhotos}
                maxPhotos={MAX_PHOTOS}
                disabled={saving}
              />
              {uploadProgress ? <p className="text-sm text-dwel-muted">{uploadProgress}</p> : null}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Listing criteria</h2>
              <p className="text-sm text-dwel-muted">
                Objective pre-qual rules shown to your review workspace. Not an auto-reject score.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium">Min income-to-rent ratio</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className={inputClass}
                    value={form.criteria_min_income_ratio}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, criteria_min_income_ratio: e.target.value }))
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Move-in window (days)</span>
                  <input
                    type="number"
                    min="0"
                    className={inputClass}
                    value={form.criteria_move_in_days}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, criteria_move_in_days: e.target.value }))
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Max occupants</span>
                  <input
                    type="number"
                    min="1"
                    className={inputClass}
                    value={form.criteria_max_occupants}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, criteria_max_occupants: e.target.value }))
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Preferred lease term (months)</span>
                  <input
                    type="number"
                    min="1"
                    className={inputClass}
                    value={form.criteria_lease_term}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, criteria_lease_term: e.target.value }))
                    }
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.criteria_pets_allowed}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, criteria_pets_allowed: e.target.checked }))
                  }
                />
                Pets allowed under criteria
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.criteria_require_complete_profile}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      criteria_require_complete_profile: e.target.checked,
                    }))
                  }
                />
                Require complete renter profile
              </label>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Review and publish</h2>
              <div className="rounded-[12px] border border-dwel-line bg-dwel-surface2 p-4 text-sm">
                <p className="font-semibold">{form.headline || form.street || 'New listing'}</p>
                <p className="mt-1 text-dwel-muted">{buildAddressRaw(form)}</p>
                <p className="mt-2">
                  {formatCents(Math.round(Number(form.rent_amount_cents || 0) * 100))}/mo ·{' '}
                  {form.bedrooms} bd · {form.bathrooms} ba
                  {form.sqft ? ` · ${form.sqft} sqft` : ''}
                </p>
                {form.description ? <p className="mt-3 whitespace-pre-wrap">{form.description}</p> : null}
                <p className="mt-3 text-xs text-dwel-muted">
                  Criteria: {form.criteria_min_income_ratio}× income · move-in{' '}
                  {form.criteria_move_in_days}d · max {form.criteria_max_occupants} occupants ·{' '}
                  {form.criteria_lease_term} mo lease
                  {form.criteria_pets_allowed ? ' · pets OK' : ' · no pets'}
                </p>
                <p className="mt-2 text-xs text-dwel-muted">
                  {photos.length} photo{photos.length === 1 ? '' : 's'} selected
                  {photos.length > 0 && photos.length < 3
                    ? ' — consider adding more before publishing'
                    : ''}
                </p>
              </div>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-dwel-red">{error}</p>}

          <div className="mt-6 flex flex-wrap gap-2">
            {step > 0 ? (
              <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            ) : null}
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={nextStep}>
                Continue
              </Button>
            ) : (
              <>
                <Button type="button" disabled={saving} onClick={() => void submit(false)}>
                  {saving ? 'Saving…' : 'Save draft'}
                </Button>
                <Button type="button" disabled={saving} onClick={() => void submit(true)}>
                  {saving ? 'Publishing…' : 'Publish listing'}
                </Button>
              </>
            )}
            <Link href="/listings">
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </Link>
          </div>
        </Card>
      )}
    </LandlordShell>
  );
}
