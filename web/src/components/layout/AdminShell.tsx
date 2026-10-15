import { Link, useLocation } from 'wouter';
import type { ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../ui/Button';

const NAV = [
  { href: '/admin', label: 'Dashboard', end: true },
  { href: '/admin/rs-tiers', label: 'RS tiers' },
  { href: '/admin/landlords', label: 'Landlords' },
  { href: '/admin/state-rules', label: 'State rules' },
  { href: '/admin/credits', label: 'Credits' },
  { href: '/admin/flags', label: 'Feature flags' },
  { href: '/admin/screening', label: 'Screening providers' },
  { href: '/admin/match-reasons', label: 'Match reasons' },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { logout } = useAuth();

  return (
    <div className="min-h-screen bg-dwel-gray-100 lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="hidden bg-dwel-black text-dwel-white lg:flex lg:flex-col lg:px-4 lg:py-6">
        <Link href="/admin" className="mb-8 px-3 text-xl font-bold">
          Dwel admin
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => {
            const active = item.end ? loc === item.href : loc.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-[10px] px-3 py-2.5 text-sm font-medium ${
                  active ? 'bg-dwel-mint text-dwel-black' : 'text-dwel-gray-200 hover:bg-white/10'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Button
          variant="ghost"
          className="mt-auto px-3 text-left text-dwel-gray-200"
          onClick={() => void logout()}
        >
          Sign out
        </Button>
      </aside>
      <main className="mx-auto w-full max-w-[1098px] px-4 py-6 sm:px-6 lg:px-12">{children}</main>
    </div>
  );
}
