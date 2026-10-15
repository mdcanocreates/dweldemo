import { Link, useLocation } from 'wouter';
import type { ReactNode } from 'react';
import { BrandMark } from '../brand/BrandMark';
import type { DemoRole } from '../../lib/demo-data';

const ROLE_LABEL: Record<DemoRole, string> = {
  renter: 'Renter',
  'home-provider': 'Home Provider',
  broker: 'Broker',
};

const ROLE_PATH: Record<DemoRole, string> = {
  renter: '/demo/renter',
  'home-provider': '/demo/home-provider',
  broker: '/demo/broker',
};

export function DemoShell({
  role,
  children,
  orgSubtitle,
}: {
  role: DemoRole;
  children: ReactNode;
  orgSubtitle?: string;
}) {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-[#e8ebe9]">
      <header className="sticky top-0 z-40 border-b border-dwel-gray-200 bg-dwel-black text-dwel-white">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <BrandMark href="/demo/renter" tone="light" />
            <div className="hidden border-l border-white/20 pl-4 sm:block">
              <p className="text-xs font-semibold uppercase tracking-wide text-dwel-mint">
                Dwel Demo
              </p>
              {orgSubtitle && (
                <p className="text-xs text-dwel-gray-400">{orgSubtitle}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-dwel-gray-300">
              <span className="hidden sm:inline">Viewing as</span>
              <select
                className="rounded-md border border-white/20 bg-dwel-black px-2 py-1.5 text-sm text-dwel-white"
                value={role}
                onChange={(e) => setLocation(ROLE_PATH[e.target.value as DemoRole])}
                aria-label="Demo role"
              >
                {(Object.keys(ROLE_LABEL) as DemoRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            <span className="rounded-md bg-dwel-mint/25 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-dwel-mint">
              DEMO
            </span>
          </div>
        </div>
        <p className="mx-auto max-w-[1180px] px-4 pb-2 text-xs text-dwel-gray-400 sm:px-6">
          Sample data — no real applications, payments, or screenings.{' '}
          <Link href="/" className="underline hover:text-white">
            Exit demo
          </Link>
        </p>
      </header>
      <main className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

export function DemoPanel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-white/70 bg-white/90 p-5 shadow-sm sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

export function DemoKpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-dwel-gray-200 bg-dwel-white p-4">
      <p className="text-2xl font-semibold tracking-tight text-dwel-gray-900">{value}</p>
      <p className="mt-1 text-sm text-dwel-gray-500">{label}</p>
      {hint && <p className="mt-1 text-xs text-dwel-gray-400">{hint}</p>}
    </div>
  );
}
