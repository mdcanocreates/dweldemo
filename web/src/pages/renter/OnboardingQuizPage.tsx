import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { api, ApiError } from '../../api/client';
import { RenterShell } from '../../components/layout/RenterShell';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { isLaunchState } from '../../lib/money';

const STEPS = 5;

const BED_OPTS = ['Studio', '1 Bed', '2 Beds', '3+ Beds'] as const;

/**
 * Progressive onboarding quiz — rebuild.md §3.1.
 * Income is intentionally NOT collected here.
 */
export function OnboardingQuizPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const [beds, setBeds] = useState<string[]>([]);
  const [locationText, setLocationText] = useState('');
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [outOfMarket, setOutOfMarket] = useState(false);
  const [budget, setBudget] = useState(2100);
  const [moveIn, setMoveIn] = useState('');
  const [profile, setProfile] = useState({
    given_name: '',
    family_name: '',
    email: '',
    phone: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const progress = useMemo(() => (step / STEPS) * 100, [step]);

  function toggleBed(label: string) {
    setBeds((prev) =>
      prev.includes(label) ? prev.filter((b) => b !== label) : [...prev, label],
    );
  }

  function onLocationNext() {
    const upper = locationText.toUpperCase();
    const stateMatch = upper.match(/\b([A-Z]{2})\b/);
    const state = stateMatch?.[1] ?? '';
    if (state && !isLaunchState(state)) {
      setOutOfMarket(true);
      return;
    }
    setOutOfMarket(false);
    setStep(3);
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(
        'dwel.onboarding.v1',
        JSON.stringify({ beds, locationText, budget, moveIn, profile }),
      );
    } catch {
      /* ignore */
    }
    try {
      await api.magicLink(profile.email.trim(), 'sign_in');
      setLocation(`/sign-in?email=${encodeURIComponent(profile.email.trim())}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create account. Try again.');
      setBusy(false);
    }
  }

  return (
    <RenterShell>
      <div className="mx-auto max-w-xl">
        <div className="mb-6 h-1 overflow-hidden rounded-full bg-dwel-gray-200">
          <div className="h-full bg-dwel-mint transition-all" style={{ width: `${progress}%` }} />
        </div>

        {step > 1 && (
          <button
            type="button"
            className="mb-4 text-sm font-semibold text-dwel-gray-600"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            ← Back
          </button>
        )}

        <Card className="p-6 sm:p-8">
          {step === 1 && (
            <>
              <h1 className="text-2xl font-semibold">A few quick questions to find your fit</h1>
              <p className="mt-2 text-sm text-dwel-gray-500">
                How many bedrooms do you need? Pick all that work.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {BED_OPTS.map((opt) => {
                  const on = beds.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggleBed(opt)}
                      className={`rounded-[10px] border px-4 py-4 text-left font-medium ${
                        on
                          ? 'border-dwel-black bg-dwel-mint/30'
                          : 'border-dwel-gray-200 bg-dwel-white hover:bg-dwel-gray-50'
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              <Button className="mt-8 w-full" disabled={beds.length === 0} onClick={() => setStep(2)}>
                Next
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-2xl font-semibold">Where are you looking?</h1>
              <p className="mt-2 text-sm text-dwel-gray-500">Enter a city or neighborhood</p>
              <Input
                className="mt-6"
                placeholder="e.g., Austin, TX"
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
              />
              {outOfMarket && (
                <div className="mt-4 rounded-[10px] border border-dwel-amber bg-amber-50 p-4 text-sm">
                  <p>
                    Dwel isn&apos;t available in that state yet. We&apos;ll notify you when we
                    launch there.
                  </p>
                  <Input
                    className="mt-3"
                    type="email"
                    placeholder="Email for launch updates"
                    value={waitlistEmail}
                    onChange={(e) => setWaitlistEmail(e.target.value)}
                  />
                  <Button className="mt-3" variant="secondary" onClick={() => setStep(3)}>
                    Continue anyway
                  </Button>
                </div>
              )}
              <Button
                className="mt-8 w-full"
                disabled={!locationText.trim()}
                onClick={onLocationNext}
              >
                Next
              </Button>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-2xl font-semibold">What&apos;s your budget?</h1>
              <p className="mt-2 text-sm text-dwel-gray-500">
                Total monthly rent, including any roommates
              </p>
              <p className="mt-6 text-3xl font-semibold">
                ${budget.toLocaleString()} per month
              </p>
              <input
                type="range"
                min={500}
                max={15000}
                step={50}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="mt-4 w-full accent-dwel-black"
              />
              <Button className="mt-8 w-full" onClick={() => setStep(4)}>
                Next
              </Button>
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="text-2xl font-semibold">When do you want to move in?</h1>
              <p className="mt-2 text-sm text-dwel-gray-500">
                We&apos;ll filter for units available around that date
              </p>
              <Input
                className="mt-6"
                type="date"
                value={moveIn}
                onChange={(e) => setMoveIn(e.target.value)}
              />
              <Button className="mt-8 w-full" disabled={!moveIn} onClick={() => setStep(5)}>
                See listings
              </Button>
            </>
          )}

          {step === 5 && (
            <>
              <h1 className="text-2xl font-semibold">Create a free account to see your results</h1>
              <p className="mt-2 text-sm text-dwel-gray-500">
                No income required to browse. Screening details come later, only if a landlord
                requests them.
              </p>
              <div className="mt-6 space-y-3">
                <Input
                  placeholder="First name"
                  value={profile.given_name}
                  onChange={(e) => setProfile((p) => ({ ...p, given_name: e.target.value }))}
                />
                <Input
                  placeholder="Last name"
                  value={profile.family_name}
                  onChange={(e) => setProfile((p) => ({ ...p, family_name: e.target.value }))}
                />
                <Input
                  type="email"
                  placeholder="Email"
                  value={profile.email}
                  onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                />
                <Input
                  type="tel"
                  placeholder="Phone (optional)"
                  value={profile.phone}
                  onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                />
              </div>
              {error && (
                <div className="mt-4 rounded-[10px] border border-red-200 bg-red-50 p-3 text-sm text-dwel-red">
                  {error}
                </div>
              )}
              <Button
                className="mt-8 w-full"
                disabled={
                  busy ||
                  !profile.given_name.trim() ||
                  !profile.family_name.trim() ||
                  !profile.email.trim()
                }
                onClick={() => void finish()}
              >
                {busy ? 'Sending link…' : 'Create account'}
              </Button>
              <p className="mt-3 text-center text-sm text-dwel-gray-500">
                Already have an account?{' '}
                <Link href="/sign-in" className="font-semibold underline underline-offset-2">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </Card>
      </div>
    </RenterShell>
  );
}
