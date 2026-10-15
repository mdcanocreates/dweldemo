import { Link, useLocation } from 'wouter';
import { useState, type ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { BrandMark } from '../brand/BrandMark';
import { Button } from '../ui/Button';
import { PreviewRoleSwitcher } from './PreviewRoleSwitcher';
import { UiPreviewBanner } from './UiPreviewBanner';
import { getPreviewRole } from '../../lib/internal-preview';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', end: true },
  { href: '/listings', label: 'Listings' },
  { href: '/listings/applicants', label: 'Applicants' },
  { href: '/landlord/screenings', label: 'Screenings' },
  { href: '/landlord/leases', label: 'Leases' },
  { href: '/landlord/billing', label: 'Billing' },
  { href: '/landlord/activity', label: 'Activity' },
  { href: '/settings', label: 'Settings' },
];

export function LandlordShell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const initials =
    `${user?.given_name?.[0] ?? ''}${user?.family_name?.[0] ?? ''}`.toUpperCase() || 'HP';
  const orgLabel = 'Home Provider';
  const previewActive = Boolean(getPreviewRole());

  return (
    <div className="min-h-screen bg-dwel-bg">
      <UiPreviewBanner />
      <div className="lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="hidden bg-dwel-nav text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:px-4 lg:py-[22px]">
        <BrandMark href="/dashboard" tone="light" className="mb-2 px-2" />
        <p className="mb-4 px-2 text-xs text-[#a9b5b0]">Dwel Partner · Home Provider</p>
        <div className="mb-4 px-2">
          <PreviewRoleSwitcher tone="dark" />
        </div>
        <nav className="flex flex-1 flex-col gap-[7px]" aria-label="Home Provider">
          {NAV.map((item) => {
            const active = item.end
              ? loc === item.href
              : loc === item.href || loc.startsWith(`${item.href}/`);
            // Avoid /listings matching /listings/applicants incorrectly for Listings
            const isListingsNav = item.href === '/listings';
            const listingsActive =
              isListingsNav &&
              (loc === '/listings' ||
                (loc.startsWith('/listings/') && !loc.startsWith('/listings/applicants')));
            const on = isListingsNav ? listingsActive : active;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-[10px] px-3 py-[11px] text-sm ${
                  on ? 'bg-[#13212b] font-semibold text-white' : 'text-[#d7dedb] hover:bg-[#13212b]'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-[#1d2a33] px-2 pt-4 text-xs text-[#aab5b0]">
          <p className="font-medium text-white">{orgLabel}</p>
          <p className="truncate">{user?.email}</p>
          <Button
            variant="ghost"
            className="mt-3 px-0 text-left text-[#d7dedb]"
            onClick={() => void logout()}
          >
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 flex h-[72px] items-center justify-between border-b border-dwel-line bg-dwel-surface px-4 sm:px-7">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-[10px] border border-dwel-line px-3 py-2 text-sm lg:hidden"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
            >
              Menu
            </button>
            <BrandMark href="/dashboard" className="lg:hidden" />
          </div>
          <div className="flex items-center gap-2">
            {previewActive ? (
              <span className="hidden rounded-md bg-dwel-mint px-2 py-1 text-[11px] font-extrabold text-[#04110a] sm:inline">
                PREVIEW
              </span>
            ) : null}
            <PreviewRoleSwitcher tone="light" />
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-dwel-mint text-sm font-extrabold text-dwel-ink">
              {initials}
            </div>
          </div>
        </header>

        {mobileOpen ? (
          <nav className="border-b border-dwel-line bg-dwel-surface px-4 py-3 lg:hidden">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-[10px] px-3 py-2.5 text-sm font-medium"
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}

        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-7 sm:px-7">{children}</main>
      </div>
      </div>
    </div>
  );
}
