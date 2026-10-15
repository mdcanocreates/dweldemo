import { useLocation } from 'wouter';
import { Card } from '../../components/ui/Card';
import { setPartyRole } from '../../lib/user-flow-store';
import type { PartyRole } from '../../types';

const OPTIONS: Array<{ role: PartyRole; title: string; body: string; href: string }> = [
  {
    role: 'renter',
    title: "I'm looking for a place",
    body: 'Build a pre-qualification profile and browse listings.',
    href: '/onboarding/renter/profile',
  },
  {
    role: 'landlord',
    title: 'I own rental property',
    body: 'List units and review renter interest.',
    href: '/onboarding/landlord/setup',
  },
  {
    role: 'broker',
    title: "I'm a licensed agent or broker",
    body: 'Verify your license and manage landlord portfolios.',
    href: '/onboarding/broker/verify',
  },
];

/** userFlow.md — /onboarding/role — new users only; permanent once confirmed */
export function RoleSelectionPage() {
  const [, setLocation] = useLocation();

  function choose(role: PartyRole, href: string) {
    setPartyRole(role);
    setLocation(href);
  }

  return (
    <div className="min-h-screen bg-dwel-gray-100 px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold">How will you use Dwel?</h1>
        <p className="mt-2 text-sm text-dwel-gray-500">
          Choose one. You can&apos;t change this yourself later — contact support if you need a
          second role.
        </p>
        <div className="mt-8 grid gap-4">
          {OPTIONS.map((opt) => (
            <button
              key={opt.role}
              type="button"
              onClick={() => choose(opt.role, opt.href)}
              className="text-left"
            >
              <Card className="p-5 transition hover:border-dwel-black">
                <p className="text-lg font-semibold">{opt.title}</p>
                <p className="mt-1 text-sm text-dwel-gray-500">{opt.body}</p>
              </Card>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
