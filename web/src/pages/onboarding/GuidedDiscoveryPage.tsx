import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '../../components/ui/Button';
import {
  discoveryToSearchUrl,
  loadDiscovery,
  saveDiscovery,
  type DiscoveryState,
} from '../../lib/discovery';
import { locationSuggestions } from '../../lib/search-state';
import { BrandMark } from '../../components/brand/BrandMark';

const STEPS = 5;
const BED_OPTS = [
  { id: 'studio', label: 'Studio', mark: 'S' },
  { id: '1', label: '1 bed', mark: '1' },
  { id: '2', label: '2 beds', mark: '2' },
  { id: '3+', label: '3+ beds', mark: '3+' },
] as const;

const MUST = [
  'Pet friendly',
  'Parking',
  'In-unit laundry',
  'A/C',
  'Dishwasher',
  'Balcony / patio',
  'Furnished',
] as const;

/**
 * Guided discovery — optional, anonymous, no income, no account wall (design3.md).
 * Completes → /search with filters populated.
 */
export function GuidedDiscoveryPage() {
  const [, setLocation] = useLocation();
  const prev = loadDiscovery();
  const [step, setStep] = useState(1);
  const [bedrooms, setBedrooms] = useState<string[]>(prev?.bedrooms ?? []);
  const [locInput, setLocInput] = useState('');
  const [locations, setLocations] = useState<string[]>(prev?.locations ?? []);
  const [budgetMax, setBudgetMax] = useState(prev?.budget_max ?? 2500);
  const [budgetMin, setBudgetMin] = useState<number | undefined>(prev?.budget_min);
  const [showMin, setShowMin] = useState(prev?.budget_min != null);
  const [moveTiming, setMoveTiming] = useState<DiscoveryState['move_timing']>(
    prev?.move_timing ?? '30_days',
  );
  const [moveDate, setMoveDate] = useState(prev?.move_in_date ?? '');
  const [mustHaves, setMustHaves] = useState<string[]>(prev?.must_haves ?? []);

  const progress = useMemo(() => (step / STEPS) * 100, [step]);

  const suggestions = locationSuggestions(locInput, 8)
    .map((s) => s.label)
    .filter((c) => !locations.includes(c));

  function toggleBed(id: string) {
    setBedrooms((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function addLocation(value: string) {
    const v = value.trim();
    if (!v || locations.includes(v)) return;
    setLocations((prev) => [...prev, v]);
    setLocInput('');
  }

  function finish() {
    const state: DiscoveryState = {
      bedrooms,
      locations,
      budget_max: budgetMax,
      budget_min: showMin ? budgetMin : undefined,
      move_timing: moveTiming,
      move_in_date: moveTiming === 'pick_date' ? moveDate : undefined,
      must_haves: mustHaves,
    };
    saveDiscovery(state);
    setLocation(discoveryToSearchUrl(state));
  }

  return (
    <div className="min-h-screen bg-[#F7F6F3]">
      <header className="mx-auto flex max-w-xl items-center justify-between px-4 py-4">
        <BrandMark href="/" />
        <button
          type="button"
          className="text-sm font-semibold text-dwel-gray-500"
          onClick={() => setLocation('/search')}
        >
          Skip
        </button>
      </header>

      <div className="mx-auto max-w-xl px-4 pb-16">
        <div className="mb-8 h-1 overflow-hidden rounded-full bg-dwel-gray-200">
          <div className="h-full bg-dwel-mint transition-all" style={{ width: `${progress}%` }} />
        </div>

        {step > 1 && (
          <button
            type="button"
            className="mb-4 text-sm font-semibold"
            onClick={() => setStep((s) => s - 1)}
          >
            ← Back
          </button>
        )}

        {step === 1 && (
          <>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              What kind of place works for you?
            </h1>
            <p className="mt-2 text-dwel-gray-500">Choose all that fit.</p>
            <div className="mt-8 grid grid-cols-2 gap-3">
              {BED_OPTS.map((opt) => {
                const on = bedrooms.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleBed(opt.id)}
                    className={`rounded-[16px] border px-4 py-8 text-left transition ${
                      on
                        ? 'border-dwel-black bg-dwel-mint/40'
                        : 'border-dwel-gray-200 bg-dwel-white hover:border-dwel-gray-400'
                    }`}
                  >
                    <p className="text-3xl font-semibold">{opt.mark}</p>
                    <p className="mt-2 text-sm font-medium">{opt.label}</p>
                  </button>
                );
              })}
            </div>
            <Button
              className="mt-10 w-full"
              disabled={bedrooms.length === 0}
              onClick={() => setStep(2)}
            >
              Next
            </Button>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Where do you want to live?
            </h1>
            <p className="mt-2 text-dwel-gray-500">City, neighborhood, or ZIP</p>
            <input
              className="mt-8 h-14 w-full rounded-[14px] border border-dwel-gray-200 bg-dwel-white px-4 text-base outline-none focus:ring-2 focus:ring-dwel-black"
              placeholder="City, neighborhood, or ZIP"
              value={locInput}
              onChange={(e) => setLocInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLocation(locInput);
                }
              }}
            />
            {suggestions.length > 0 && (
              <ul className="mt-2 overflow-hidden rounded-[14px] border border-dwel-gray-200 bg-dwel-white">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      className="w-full px-4 py-3 text-left text-sm hover:bg-dwel-gray-50"
                      onClick={() => addLocation(s)}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {locations.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {locations.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    className="rounded-full bg-dwel-mint/50 px-3 py-1.5 text-sm font-medium"
                    onClick={() => setLocations((prev) => prev.filter((x) => x !== loc))}
                  >
                    {loc} ×
                  </button>
                ))}
              </div>
            )}
            <Button
              className="mt-10 w-full"
              disabled={locations.length === 0 && !locInput.trim()}
              onClick={() => {
                if (locInput.trim()) addLocation(locInput);
                setStep(3);
              }}
            >
              Next
            </Button>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              What feels comfortable each month?
            </h1>
            <p className="mt-2 text-dwel-gray-500">
              Include the total rent for you and any roommates.
            </p>
            <p className="mt-10 text-4xl font-semibold">
              Up to ${budgetMax.toLocaleString()}/mo
            </p>
            <input
              type="range"
              min={500}
              max={15000}
              step={50}
              value={budgetMax}
              onChange={(e) => setBudgetMax(Number(e.target.value))}
              className="mt-6 w-full accent-dwel-black"
            />
            <button
              type="button"
              className="mt-4 text-sm font-semibold underline underline-offset-2"
              onClick={() => setShowMin((v) => !v)}
            >
              {showMin ? 'Hide minimum budget' : 'Add minimum budget'}
            </button>
            {showMin && (
              <>
                <p className="mt-4 text-lg font-medium">
                  Min ${((budgetMin ?? 1000)).toLocaleString()}/mo
                </p>
                <input
                  type="range"
                  min={500}
                  max={budgetMax}
                  step={50}
                  value={budgetMin ?? 1000}
                  onChange={(e) => setBudgetMin(Number(e.target.value))}
                  className="mt-2 w-full accent-dwel-black"
                />
              </>
            )}
            <Button className="mt-10 w-full" onClick={() => setStep(4)}>
              Next
            </Button>
          </>
        )}

        {step === 4 && (
          <>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              When would you like to move?
            </h1>
            <div className="mt-8 flex flex-wrap gap-2">
              {(
                [
                  ['asap', 'ASAP'],
                  ['30_days', 'Within 30 days'],
                  ['1_3_months', '1–3 months'],
                  ['pick_date', 'Pick a date'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMoveTiming(id)}
                  className={`rounded-full px-4 py-2.5 text-sm font-medium ${
                    moveTiming === id
                      ? 'bg-dwel-mint text-dwel-black'
                      : 'bg-dwel-white border border-dwel-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {moveTiming === 'pick_date' && (
              <input
                type="date"
                className="mt-6 h-14 w-full rounded-[14px] border border-dwel-gray-200 bg-dwel-white px-4"
                value={moveDate}
                onChange={(e) => setMoveDate(e.target.value)}
              />
            )}
            <Button
              className="mt-10 w-full"
              disabled={moveTiming === 'pick_date' && !moveDate}
              onClick={() => setStep(5)}
            >
              Next
            </Button>
          </>
        )}

        {step === 5 && (
          <>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Anything you definitely need?
            </h1>
            <div className="mt-8 flex flex-wrap gap-2">
              {MUST.map((m) => {
                const on = mustHaves.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      setMustHaves((prev) =>
                        on ? prev.filter((x) => x !== m) : [...prev, m],
                      )
                    }
                    className={`rounded-full px-4 py-2.5 text-sm font-medium ${
                      on
                        ? 'bg-dwel-mint text-dwel-black'
                        : 'border border-dwel-gray-200 bg-dwel-white'
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
            <Button className="mt-10 w-full" onClick={finish}>
              Show me homes
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
