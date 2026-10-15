import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import {
  locationSuggestions,
  resolveLocationInput,
  type SearchState,
} from '../../lib/search-state';

type Props = {
  value: SearchState;
  onChange: (next: SearchState) => void;
  variant?: 'hero' | 'full' | 'location';
};

/**
 * Shared search bar — binds to canonical SearchState.
 * Expanded filters (baths/type/pets/parking/incentive) update immediately.
 * Primary row commits on Search submit.
 */
export function SearchBar({ value, onChange, variant = 'full' }: Props) {
  const [locationText, setLocationText] = useState(value.location?.label ?? '');
  const [beds, setBeds] = useState(value.beds?.[0] ?? '');
  const [baths, setBaths] = useState(value.baths?.[0] ?? '');
  const [priceMin, setPriceMin] = useState(value.minRent != null ? String(value.minRent) : '');
  const [priceMax, setPriceMax] = useState(value.maxRent != null ? String(value.maxRent) : '');
  const [moveIn, setMoveIn] = useState(value.moveInDate ?? '');
  const [moreOpen, setMoreOpen] = useState(
    Boolean(value.baths?.length || value.petFriendly || value.parking || value.incentiveAvailable || value.propertyTypes?.length),
  );
  const [petFriendly, setPetFriendly] = useState(Boolean(value.petFriendly));
  const [parking, setParking] = useState(Boolean(value.parking));
  const [incentive, setIncentive] = useState(Boolean(value.incentiveAvailable));
  const [propertyType, setPropertyType] = useState(value.propertyTypes?.[0] ?? '');
  const [suggestOpen, setSuggestOpen] = useState(false);

  useEffect(() => {
    setLocationText(value.location?.label ?? '');
    setBeds(value.beds?.[0] ?? '');
    setBaths(value.baths?.[0] ?? '');
    setPriceMin(value.minRent != null ? String(value.minRent) : '');
    setPriceMax(value.maxRent != null ? String(value.maxRent) : '');
    setMoveIn(value.moveInDate ?? '');
    setPetFriendly(Boolean(value.petFriendly));
    setParking(Boolean(value.parking));
    setIncentive(Boolean(value.incentiveAvailable));
    setPropertyType(value.propertyTypes?.[0] ?? '');
  }, [value]);

  const suggestions = locationSuggestions(locationText, 6);

  function buildState(overrides: Partial<{
    locationText: string;
    beds: string;
    baths: string;
    priceMin: string;
    priceMax: string;
    moveIn: string;
    petFriendly: boolean;
    parking: boolean;
    incentive: boolean;
    propertyType: string;
    location: SearchState['location'];
  }> = {}): SearchState {
    const locText = overrides.locationText ?? locationText;
    const location =
      overrides.location !== undefined
        ? overrides.location
        : locText.trim()
          ? resolveLocationInput(locText.trim())
          : undefined;
    const bedsVal = overrides.beds ?? beds;
    const bathsVal = overrides.baths ?? baths;
    const min = overrides.priceMin ?? priceMin;
    const max = overrides.priceMax ?? priceMax;
    const move = overrides.moveIn ?? moveIn;
    const pets = overrides.petFriendly ?? petFriendly;
    const park = overrides.parking ?? parking;
    const inc = overrides.incentive ?? incentive;
    const type = overrides.propertyType ?? propertyType;

    return {
      location,
      moveInDate: move || undefined,
      minRent: min ? Number(min) : undefined,
      maxRent: max ? Number(max) : undefined,
      beds: bedsVal !== '' ? [bedsVal] : undefined,
      baths: bathsVal !== '' ? [bathsVal] : undefined,
      petFriendly: pets || undefined,
      parking: park || undefined,
      incentiveAvailable: inc || undefined,
      propertyTypes: type ? [type] : undefined,
    };
  }

  function commit(next: SearchState) {
    onChange(next);
    setSuggestOpen(false);
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    commit(buildState());
  }

  /** Immediate filter row — commits into SearchState + URL. */
  function livePatch(patch: {
    baths?: string;
    petFriendly?: boolean;
    parking?: boolean;
    incentive?: boolean;
    propertyType?: string;
  }) {
    if (patch.baths !== undefined) setBaths(patch.baths);
    if (patch.petFriendly !== undefined) setPetFriendly(patch.petFriendly);
    if (patch.parking !== undefined) setParking(patch.parking);
    if (patch.incentive !== undefined) setIncentive(patch.incentive);
    if (patch.propertyType !== undefined) setPropertyType(patch.propertyType);
    commit(buildState(patch));
  }

  if (variant === 'hero' || variant === 'location') {
    return (
      <form onSubmit={submit} className="relative flex w-full flex-col gap-2 sm:flex-row sm:items-stretch">
        <input
          className={
            variant === 'hero'
              ? 'h-12 flex-1 rounded-full border border-[rgba(77,250,159,0.55)] bg-white/90 px-5 text-sm outline-none focus:ring-2 focus:ring-[rgba(77,250,159,0.35)]'
              : 'h-12 flex-1 rounded-full border border-dwel-gray-200 bg-dwel-white px-5 text-sm outline-none focus:ring-2 focus:ring-dwel-black'
          }
          placeholder={
            variant === 'hero'
              ? 'Where do you want to move?  e.g. Austin, TX or 78704'
              : 'Where do you want to live?'
          }
          value={locationText}
          onChange={(e) => {
            setLocationText(e.target.value);
            setSuggestOpen(true);
          }}
          onFocus={() => setSuggestOpen(true)}
          onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
          aria-label="Where do you want to move?"
          autoComplete="off"
        />
        {suggestOpen && suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-12 z-20 overflow-hidden rounded-[10px] border border-dwel-gray-200 bg-dwel-white shadow-lg sm:right-auto sm:w-[min(100%,28rem)]">
            {suggestions.map((s) => (
              <li key={s.label}>
                <button
                  type="button"
                  className="block w-full px-4 py-2.5 text-left text-sm hover:bg-dwel-gray-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setLocationText(s.label);
                    setSuggestOpen(false);
                    commit(buildState({ locationText: s.label, location: s }));
                  }}
                >
                  {s.label}
                  <span className="ml-2 text-xs text-dwel-gray-400">{s.type}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button type="submit" className="sm:px-8">
          Search
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="w-full">
      <div className="rounded-[40px] border border-dwel-gray-200 bg-dwel-white p-2 shadow-sm sm:rounded-[60px] sm:p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <label className="relative flex flex-1 items-center gap-2 px-3">
            <span className="text-dwel-gray-400" aria-hidden>
              ⌕
            </span>
            <input
              className="h-11 w-full bg-transparent text-sm outline-none"
              placeholder="City, county, state, or ZIP"
              value={locationText}
              onChange={(e) => {
                setLocationText(e.target.value);
                setSuggestOpen(true);
              }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
              aria-label="Location"
              autoComplete="off"
            />
            {suggestOpen && suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-11 z-20 overflow-hidden rounded-[10px] border border-dwel-gray-200 bg-dwel-white shadow-lg">
                {suggestions.map((s) => (
                  <li key={s.label}>
                    <button
                      type="button"
                      className="block w-full px-4 py-2.5 text-left text-sm hover:bg-dwel-gray-50"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setLocationText(s.label);
                        setSuggestOpen(false);
                      }}
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>
          <div className="hidden h-8 w-px bg-dwel-gray-200 lg:block" />
          <label className="flex flex-1 items-center gap-2 px-3">
            <input
              type="date"
              className="h-11 w-full bg-transparent text-sm outline-none"
              value={moveIn}
              onChange={(e) => setMoveIn(e.target.value)}
              aria-label="Move-in date"
            />
          </label>
          <div className="hidden h-8 w-px bg-dwel-gray-200 lg:block" />
          <label className="flex flex-1 items-center gap-2 px-3">
            <span className="text-dwel-gray-400">$</span>
            <input
              className="h-11 w-full bg-transparent text-sm outline-none"
              placeholder="Min"
              inputMode="numeric"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value.replace(/[^\d]/g, ''))}
              aria-label="Min rent"
            />
            <span className="text-dwel-gray-300">–</span>
            <input
              className="h-11 w-full bg-transparent text-sm outline-none"
              placeholder="Max"
              inputMode="numeric"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value.replace(/[^\d]/g, ''))}
              aria-label="Max rent"
            />
          </label>
          <div className="hidden h-8 w-px bg-dwel-gray-200 lg:block" />
          <label className="flex items-center gap-2 px-3">
            <select
              className="h-11 bg-transparent text-sm outline-none"
              value={beds}
              onChange={(e) => setBeds(e.target.value)}
              aria-label="Bedrooms"
            >
              <option value="">Beds</option>
              <option value="0">Studio</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3+">3+</option>
            </select>
          </label>
          <button
            type="button"
            className="px-3 text-sm font-medium text-dwel-gray-600 underline-offset-2 hover:underline"
            onClick={() => setMoreOpen((o) => !o)}
          >
            Filters
          </button>
          <Button type="submit" className="w-full lg:w-auto">
            Search
          </Button>
        </div>
      </div>

      {moreOpen && (
        <div className="mt-3 flex flex-wrap gap-4 rounded-[10px] border border-dwel-gray-200 bg-dwel-white px-4 py-3 text-sm">
          <label className="flex items-center gap-2">
            Baths
            <select
              className="rounded-lg border border-dwel-gray-200 px-2 py-1"
              value={baths}
              onChange={(e) => livePatch({ baths: e.target.value })}
              aria-label="Bathrooms (minimum)"
            >
              <option value="">Any</option>
              <option value="1">1+</option>
              <option value="1.5">1.5+</option>
              <option value="2">2+</option>
              <option value="2.5">2.5+</option>
              <option value="3+">3+</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Type
            <select
              className="rounded-lg border border-dwel-gray-200 px-2 py-1"
              value={propertyType}
              onChange={(e) => livePatch({ propertyType: e.target.value })}
            >
              <option value="">Any</option>
              <option value="apartment">Apartment</option>
              <option value="house">House</option>
              <option value="townhome">Townhome</option>
              <option value="condo">Condo</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={petFriendly}
              onChange={(e) => livePatch({ petFriendly: e.target.checked })}
            />
            Pet friendly
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={parking}
              onChange={(e) => livePatch({ parking: e.target.checked })}
            />
            Parking
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={incentive}
              onChange={(e) => livePatch({ incentive: e.target.checked })}
            />
            Move-in incentive
          </label>
          <button
            type="button"
            className="ml-auto text-sm font-semibold text-dwel-gray-600 underline underline-offset-2"
            onClick={() => {
              setLocationText('');
              setBeds('');
              setBaths('');
              setPriceMin('');
              setPriceMax('');
              setMoveIn('');
              setPetFriendly(false);
              setParking(false);
              setIncentive(false);
              setPropertyType('');
              commit({});
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </form>
  );
}
