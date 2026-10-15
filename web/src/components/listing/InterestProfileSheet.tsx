import { useState } from 'react';
import { Button } from '../ui/Button';
import { loadDiscovery } from '../../lib/discovery';
import { loadPrequal, savePrequal } from '../../lib/user-flow-store';
import type { PrequalProfile } from '../../types';

type Props = {
  open: boolean;
  listingName: string;
  onComplete: (profile: PrequalProfile) => void;
  onClose: () => void;
};

/**
 * Level 2 — lightweight interest profile before first send (design3.md §10).
 * Occupants, pets, optional bio. No financial screening data.
 */
export function InterestProfileSheet({ open, listingName, onComplete, onClose }: Props) {
  const existing = loadPrequal();
  const discovery = loadDiscovery();
  const pending = (() => {
    try {
      const raw = localStorage.getItem('dwel.pending_profile.v1');
      return raw
        ? (JSON.parse(raw) as {
            given_name: string;
            family_name: string;
            email: string;
            phone: string;
          })
        : null;
    } catch {
      return null;
    }
  })();

  const [occupants, setOccupants] = useState(existing?.occupant_count ?? 1);
  const [petMode, setPetMode] = useState<'none' | 'dog' | 'cat' | 'other'>(
    existing?.has_pets ? 'dog' : 'none',
  );
  const [bio, setBio] = useState(existing?.bio ?? '');

  if (!open) return null;

  function send() {
    const fullName =
      existing?.full_name ||
      [pending?.given_name, pending?.family_name].filter(Boolean).join(' ') ||
      'Renter';

    const profile: PrequalProfile = {
      id: existing?.id ?? `pq_${Date.now()}`,
      full_name: fullName,
      phone: existing?.phone || pending?.phone || '',
      current_city: existing?.current_city || discovery?.locations[0] || '',
      target_move_in_date:
        existing?.target_move_in_date ||
        discovery?.move_in_date ||
        new Date().toISOString().slice(0, 10),
      occupant_count: occupants,
      has_pets: petMode !== 'none',
      pet_details:
        petMode === 'none' ? null : [{ type: petMode, breed: '', weight: '' }],
      budget_min_cents:
        existing?.budget_min_cents ??
        (discovery?.budget_min != null ? discovery.budget_min * 100 : 0),
      budget_max_cents:
        existing?.budget_max_cents ?? (discovery?.budget_max ?? 2500) * 100,
      bedrooms: existing?.bedrooms?.length
        ? existing.bedrooms
        : discovery?.bedrooms ?? ['1'],
      bathrooms: existing?.bathrooms ?? '1',
      property_type_prefs: existing?.property_type_prefs ?? ['apartment'],
      must_haves: existing?.must_haves?.length
        ? existing.must_haves
        : discovery?.must_haves ?? [],
      preferred_areas: existing?.preferred_areas ?? discovery?.locations ?? null,
      employment_status: existing?.employment_status ?? 'employed_full_time',
      income_band: existing?.income_band ?? '3k_4k',
      has_eviction_history: existing?.has_eviction_history ?? false,
      has_bankruptcy_history: existing?.has_bankruptcy_history ?? false,
      bio: bio.trim() || null,
      move_reason: existing?.move_reason ?? null,
      status: 'complete',
    };
    savePrequal(profile);
    onComplete(profile);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-dwel-black/40"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal
        className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[20px] border border-dwel-gray-200 bg-dwel-white p-6 shadow-lg sm:rounded-[10px]"
      >
        <h2 className="text-xl font-semibold">Almost done</h2>
        <p className="mt-1 text-sm text-dwel-gray-500">
          Help the property understand your needs for <strong>{listingName}</strong>.
        </p>

        <p className="mt-6 text-sm font-medium">Who&apos;s moving?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setOccupants(n)}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                occupants === n
                  ? 'bg-dwel-mint text-dwel-black'
                  : 'border border-dwel-gray-200 bg-dwel-white'
              }`}
            >
              {n === 5 ? '5+' : n}
            </button>
          ))}
        </div>

        <p className="mt-6 text-sm font-medium">Any pets?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              ['none', 'No pets'],
              ['dog', 'Dog'],
              ['cat', 'Cat'],
              ['other', 'Other'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPetMode(id)}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                petMode === id
                  ? 'bg-dwel-mint text-dwel-black'
                  : 'border border-dwel-gray-200 bg-dwel-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="mt-6 text-sm font-medium">
          Anything you&apos;d like the property to know?{' '}
          <span className="font-normal text-dwel-gray-400">(optional)</span>
        </p>
        <textarea
          className="mt-2 h-28 w-full rounded-[10px] border border-dwel-gray-200 p-3 text-sm"
          maxLength={500}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Short move-in statement"
        />
        <p className="text-xs text-dwel-gray-400">{bio.length}/500</p>

        <Button className="mt-6 w-full" onClick={send}>
          Send my interest
        </Button>
        <button
          type="button"
          className="mt-3 w-full text-sm font-semibold underline"
          onClick={onClose}
        >
          Keep browsing
        </button>
      </div>
    </div>
  );
}
