import { Link, useLocation } from 'wouter';
import { useState, type ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { BrandMark } from '../brand/BrandMark';
import { PublicFooter } from './PublicFooter';
import { Button } from '../ui/Button';
import { getPartyRole } from '../../lib/user-flow-store';
import { getPreviewRole } from '../../lib/internal-preview';
import { PreviewRoleSwitcher } from './PreviewRoleSwitcher';
import { UiPreviewBanner } from './UiPreviewBanner';
import { getUiPreviewRole, isUiPreviewActive } from '../../lib/ui-preview';

const WORKSPACE_NAV = [
  { href: '/home', label: 'Home', end: true },
  { href: '/search', label: 'Browse homes' },
  { href: '/saved', label: 'Saved' },
  { href: '/applications', label: 'Applications' },
  { href: '/screening', label: 'Screening' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/support', label: 'Support' },
  { href: '/profile', label: 'Profile' },
  { href: '/renter/settings', label: 'Settings' },
];

function useIsRenterWorkspace(): boolean {
  const { user } = useAuth();
  const partyRole = getPartyRole();
  if (isUiPreviewActive()) return getUiPreviewRole() === 'renter';
  const previewRenter = getPreviewRole() === 'renter';
  return previewRenter || (Boolean(user) && (!partyRole || partyRole === 'renter'));
}

export function RenterHeader() {
  const { user, logout } = useAuth();
  const isRenter = useIsRenterWorkspace();
  const initials =
    `${user?.given_name?.[0] ?? ''}${user?.family_name?.[0] ?? ''}`.toUpperCase() || 'U';

  return (
    <header className="sticky top-0 z-40 border-b border-dwel-line bg-dwel-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-12">
        <BrandMark href={isRenter ? '/home' : '/'} />

        {isRenter ? (
          <nav className="flex items-center gap-3 sm:gap-5">
            <PreviewRoleSwitcher tone="light" />
            <Link href="/search" className="text-sm font-medium text-dwel-muted hover:text-dwel-ink">
              Browse
            </Link>
            <Link href="/saved" className="text-sm font-medium text-dwel-muted hover:text-dwel-ink">
              Saved
            </Link>
            <Link
              href="/applications"
              className="text-sm font-medium text-dwel-muted hover:text-dwel-ink"
            >
              Applications
            </Link>
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full bg-dwel-mint text-sm font-semibold text-dwel-ink"
              aria-label="Account"
            >
              {initials}
            </div>
            <Button variant="ghost" onClick={() => void logout()}>
              Sign out
            </Button>
          </nav>
        ) : (
          <nav className="flex flex-wrap items-center justify-end gap-3 sm:gap-5">
            <PreviewRoleSwitcher tone="light" />
            <Link href="/search" className="text-sm font-medium text-dwel-muted hover:text-dwel-ink">
              Browse homes
            </Link>
            <Link
              href="/partner"
              className="hidden text-sm font-medium text-dwel-muted hover:text-dwel-ink sm:inline"
            >
              Dwel Partner
            </Link>
            <Link href="/saved" className="text-sm font-medium text-dwel-muted hover:text-dwel-ink">
              Saved
            </Link>
            <Link href="/auth/login">
              <Button variant="secondary" className="!px-4 !py-2 text-sm">
                Sign in
              </Button>
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}

/** Authenticated renter workspace — navy sidebar matching HTML reference. */
function RenterWorkspaceShell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const initials =
    `${user?.given_name?.[0] ?? ''}${user?.family_name?.[0] ?? ''}`.toUpperCase() || 'U';
  const displayName =
    [user?.given_name, user?.family_name].filter(Boolean).join(' ') || 'Renter';

  return (
    <div className="min-h-screen bg-dwel-bg">
      <UiPreviewBanner />
      <div className="lg:grid lg:grid-cols-[230px_1fr]">
      <aside className="hidden bg-dwel-nav text-white lg:flex lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:px-4 lg:py-[22px]">
        <BrandMark href="/home" tone="light" className="mb-1 px-2" />
        <p className="mb-4 px-2 text-xs text-[#98a7b5]">Renter workspace</p>
        <div className="mb-4 px-2">
          <PreviewRoleSwitcher tone="dark" />
        </div>
        <nav className="flex flex-1 flex-col gap-[7px]" aria-label="Renter">
          {WORKSPACE_NAV.map((item) => {
            const active = item.end ? loc === item.href : loc.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-[11px] px-3 py-[11px] text-sm ${
                  active ? 'bg-[#152536] font-semibold text-white' : 'text-[#dce4eb] hover:bg-[#152536]'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-[#203243] px-2 pt-4 text-sm text-[#b7c3ce]">
          <p className="font-medium text-white">{displayName}</p>
          <p className="truncate text-xs">{user?.email}</p>
          <button
            type="button"
            className="mt-3 text-left text-xs text-[#dce4eb] underline-offset-2 hover:underline"
            onClick={() => void logout()}
          >
            Sign out
          </button>
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
            <strong className="text-dwel-ink lg:hidden">Dwel</strong>
            <span className="hidden rounded-full border border-dwel-line px-3 py-2 text-xs text-dwel-muted sm:inline">
              Viewing as: Renter
            </span>
          </div>
          <div className="flex items-center gap-2">
            <PreviewRoleSwitcher tone="light" />
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full bg-dwel-mint text-sm font-extrabold text-dwel-ink"
              aria-hidden
            >
              {initials}
            </div>
          </div>
        </header>

        {mobileOpen ? (
          <nav className="border-b border-dwel-line bg-dwel-surface px-4 py-3 lg:hidden" aria-label="Mobile renter">
            <div className="flex flex-col gap-1">
              {WORKSPACE_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-[10px] px-3 py-2.5 text-sm font-medium text-dwel-ink"
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        ) : null}

        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-7 sm:px-7">{children}</main>
      </div>
      </div>
    </div>
  );
}

export function RenterShell({
  children,
  fullBleed = false,
  wide = false,
  workspace,
}: {
  children: ReactNode;
  fullBleed?: boolean;
  wide?: boolean;
  /** Force workspace sidebar; defaults to authed renter. */
  workspace?: boolean;
}) {
  const isRenter = useIsRenterWorkspace();
  const useWorkspace = workspace ?? isRenter;

  if (useWorkspace) {
    return <RenterWorkspaceShell>{children}</RenterWorkspaceShell>;
  }

  const max = wide ? 'max-w-[1280px]' : 'max-w-[1098px]';
  return (
    <div className="flex min-h-screen flex-col bg-dwel-bg">
      <UiPreviewBanner />
      <RenterHeader />
      <main
        className={
          fullBleed ? 'flex-1' : `mx-auto w-full flex-1 ${max} px-4 py-6 sm:px-6 lg:px-12`
        }
      >
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
