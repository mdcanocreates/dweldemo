import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { savePrequal } from '../../lib/user-flow-store';
import type { EmploymentStatus, IncomeBand, PrequalProfile } from '../../types';

const STEPS = 4;

const MUST_HAVES = [
  { id: 'in_unit_laundry', label: 'In-unit laundry' },
  { id: 'parking', label: 'Parking' },
  { id: 'pet_friendly', label: 'Pet-friendly' },
  { id: 'ac', label: 'A/C' },
  { id: 'dishwasher', label: 'Dishwasher' },
  { id: 'balcony', label: 'Balcony/patio' },
  { id: 'furnished', label: 'Furnished' },
] as const;

const INCOME_BANDS: Array<{ id: IncomeBand; label: string }> = [
  { id: 'under_2k', label: 'Under $2k' },
  { id: '2k_3k', label: '$2k–$3k' },
  { id: '3k_4k', label: '$3k–$4k' },
  { id: '4k_5k', label: '$4k–$5k' },
  { id: '5k_7_5k', label: '$5k–$7.5k' },
  { id: '7_5k_10k', label: '$7.5k–$10k' },
  { id: '10k_plus', label: '$10k+' },
];

/**
 * Pre-qual profile builder — userFlow.md §Renter Onboarding.
 * Self-reported data. NOT an FCRA consumer report.
 */
export function RenterPrequalPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [moveIn, setMoveIn] = useState('');
  const [occupants, setOccupants] = useState(1);
  const [hasPets, setHasPets] = useState(false);
  const [petType, setPetType] = useState('dog');
  const [petBreed, setPetBreed] = useState('');
  const [petWeight, setPetWeight] = useState('');
  const [budgetMin, setBudgetMin] = useState(1200);
  const [budgetMax, setBudgetMax] = useState(2400);
  const [bedrooms, setBedrooms] = useState<string[]>(['1']);
  const [bathrooms, setBathrooms] = useState('1');
  const [propertyTypes, setPropertyTypes] = useState<string[]>(['apartment']);
  const [mustHaves, setMustHaves] = useState<string[]>([]);
  const [areas, setAreas] = useState('');
  const [employment, setEmployment] = useState<EmploymentStatus>('employed_full_time');
  const [incomeBand, setIncomeBand] = useState<IncomeBand>('3k_4k');
  const [eviction, setEviction] = useState(false);
  const [bankruptcy, setBankruptcy] = useState(false);
  const [bio, setBio] = useState('');
  const [moveReason, setMoveReason] = useState('lease_ending');

  const progress = useMemo(() => (step / STEPS) * 100, [step]);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().slice(0, 10);

  function toggle(list: string[], id: string, set: (v: string[]) => void) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  function finish() {
    const profile: PrequalProfile = {
      id: `pq_${Date.now()}`,
      full_name: `${first.trim()} ${last.trim()}`,
      phone: phone.trim(),
      current_city: city.trim(),
      target_move_in_date: moveIn,
      occupant_count: occupants,
      has_pets: hasPets,
      pet_details: hasPets
        ? [{ type: petType, breed: petBreed, weight: petWeight }]
        : null,
      budget_min_cents: budgetMin * 100,
      budget_max_cents: budgetMax * 100,
      bedrooms,
      bathrooms,
      property_type_prefs: propertyTypes,
      must_haves: mustHaves,
      preferred_areas: areas.trim() ? areas.split(',').map((s) => s.trim()) : null,
      employment_status: employment,
      income_band: incomeBand,
      has_eviction_history: eviction,
      has_bankruptcy_history: bankruptcy,
      bio: bio.trim() || null,
      move_reason: moveReason,
      status: 'complete',
    };
    savePrequal(profile);
    setLocation('/search');
  }

  return (
    <div className="min-h-screen bg-dwel-gray-100 px-4 py-8">
      <div className="mx-auto max-w-xl">
        <p className="text-sm font-medium text-dwel-gray-500">Pre-qualification profile</p>
        <p className="mt-1 text-xs text-dwel-gray-400">
          Self-reported — not a background check. Landlords see this when you express interest.
        </p>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-dwel-gray-200">
          <div className="h-full bg-dwel-mint transition-all" style={{ width: `${progress}%` }} />
        </div>

        {step > 1 && (
          <button
            type="button"
            className="mt-4 text-sm font-semibold"
            onClick={() => setStep((s) => s - 1)}
          >
            ← Back
          </button>
        )}

        <Card className="mt-4 p-6 sm:p-8">
          {step === 1 && (
            <>
              <h1 className="text-2xl font-semibold">Basics</h1>
              <div className="mt-6 space-y-3">
                <Input placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} />
                <Input placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
                <Input placeholder="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <Input placeholder="Current city / metro" value={city} onChange={(e) => setCity(e.target.value)} />
                <Input type="date" min={minDate} value={moveIn} onChange={(e) => setMoveIn(e.target.value)} />
                <label className="block text-sm text-dwel-gray-600">
                  Occupants
                  <select
                    className="mt-1 h-12 w-full rounded-lg border border-dwel-gray-300 px-4"
                    value={occupants}
                    onChange={(e) => setOccupants(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n === 5 ? '5+' : n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={hasPets} onChange={(e) => setHasPets(e.target.checked)} />
                  I have pets
                </label>
                {hasPets && (
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      className="h-12 rounded-lg border border-dwel-gray-300 px-2 text-sm"
                      value={petType}
                      onChange={(e) => setPetType(e.target.value)}
                    >
                      <option value="dog">Dog</option>
                      <option value="cat">Cat</option>
                      <option value="other">Other</option>
                    </select>
                    <Input placeholder="Breed" value={petBreed} onChange={(e) => setPetBreed(e.target.value)} />
                    <Input placeholder="Weight (lbs)" value={petWeight} onChange={(e) => setPetWeight(e.target.value)} />
                  </div>
                )}
              </div>
              <Button
                className="mt-8 w-full"
                disabled={!first || !last || !phone || !city || !moveIn}
                onClick={() => setStep(2)}
              >
                Next
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-2xl font-semibold">Housing preferences</h1>
              <p className="mt-4 text-sm text-dwel-gray-500">
                Budget: ${budgetMin.toLocaleString()} – ${budgetMax.toLocaleString()}/mo
              </p>
              <label className="mt-2 block text-xs text-dwel-gray-500">Min</label>
              <input
                type="range"
                min={500}
                max={15000}
                step={50}
                value={budgetMin}
                onChange={(e) => setBudgetMin(Math.min(Number(e.target.value), budgetMax))}
                className="w-full accent-dwel-black"
              />
              <label className="mt-2 block text-xs text-dwel-gray-500">Max</label>
              <input
                type="range"
                min={500}
                max={15000}
                step={50}
                value={budgetMax}
                onChange={(e) => setBudgetMax(Math.max(Number(e.target.value), budgetMin))}
                className="w-full accent-dwel-black"
              />
              <p className="mt-4 text-sm font-medium">Bedrooms</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {['studio', '1', '2', '3', '4+'].map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => toggle(bedrooms, b, setBedrooms)}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      bedrooms.includes(b) ? 'bg-dwel-mint text-dwel-black' : 'bg-dwel-gray-100'
                    }`}
                  >
                    {b === 'studio' ? 'Studio' : `${b} bed`}
                  </button>
                ))}
              </div>
              <label className="mt-4 block text-sm">
                Bathrooms
                <select
                  className="mt-1 h-12 w-full rounded-lg border border-dwel-gray-300 px-4"
                  value={bathrooms}
                  onChange={(e) => setBathrooms(e.target.value)}
                >
                  {['1', '1.5', '2', '2.5', '3+'].map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-4 text-sm font-medium">Property type</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {['apartment', 'house', 'townhome', 'condo'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggle(propertyTypes, t, setPropertyTypes)}
                    className={`rounded-full px-3 py-1.5 text-sm capitalize ${
                      propertyTypes.includes(t) ? 'bg-dwel-mint text-dwel-black' : 'bg-dwel-gray-100'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <p className="mt-4 text-sm font-medium">Must-haves</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {MUST_HAVES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(mustHaves, m.id, setMustHaves)}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      mustHaves.includes(m.id) ? 'bg-dwel-mint text-dwel-black' : 'bg-dwel-gray-100'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <Input
                className="mt-4"
                placeholder="Preferred neighborhoods or zips (optional)"
                value={areas}
                onChange={(e) => setAreas(e.target.value)}
              />
              <Button className="mt-8 w-full" disabled={bedrooms.length === 0} onClick={() => setStep(3)}>
                Next
              </Button>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-2xl font-semibold">Financial snapshot</h1>
              <p className="mt-2 text-sm text-dwel-gray-500">
                Self-reported ranges — not verified and not a consumer report.
              </p>
              <label className="mt-6 block text-sm">
                Employment status
                <select
                  className="mt-1 h-12 w-full rounded-lg border border-dwel-gray-300 px-4"
                  value={employment}
                  onChange={(e) => setEmployment(e.target.value as EmploymentStatus)}
                >
                  <option value="employed_full_time">Employed full-time</option>
                  <option value="employed_part_time">Employed part-time</option>
                  <option value="self_employed">Self-employed</option>
                  <option value="student">Student</option>
                  <option value="retired">Retired</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <p className="mt-4 text-sm font-medium">Approximate gross monthly income</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {INCOME_BANDS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setIncomeBand(b.id)}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      incomeBand === b.id ? 'bg-dwel-mint text-dwel-black' : 'bg-dwel-gray-100'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
              <label className="mt-6 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={eviction} onChange={(e) => setEviction(e.target.checked)} />
                Evicted in the past 7 years?
              </label>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={bankruptcy}
                  onChange={(e) => setBankruptcy(e.target.checked)}
                />
                Filed for bankruptcy in the past 7 years?
              </label>
              <Button className="mt-8 w-full" onClick={() => setStep(4)}>
                Next
              </Button>
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="text-2xl font-semibold">About you</h1>
              <p className="mt-2 text-sm text-dwel-gray-500">Optional — shown to landlords with your interest.</p>
              <textarea
                className="mt-6 h-32 w-full rounded-lg border border-dwel-gray-300 p-3 text-sm"
                maxLength={500}
                placeholder="Short move-in statement"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
              />
              <p className="text-xs text-dwel-gray-400">{bio.length}/500</p>
              <label className="mt-4 block text-sm">
                Why are you moving?
                <select
                  className="mt-1 h-12 w-full rounded-lg border border-dwel-gray-300 px-4"
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                >
                  <option value="new_job">New job</option>
                  <option value="relocation">Relocation</option>
                  <option value="upsizing">Upsizing</option>
                  <option value="downsizing">Downsizing</option>
                  <option value="first_apartment">First apartment</option>
                  <option value="lease_ending">Lease ending</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <Button className="mt-8 w-full" onClick={finish}>
                See listings
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
