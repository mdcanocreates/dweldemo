import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { BrandMark } from '../brand/BrandMark';
import { PublicFooter } from '../layout/PublicFooter';
import { Button } from '../ui/Button';

type Role = 'landlord' | 'broker';

type Props = {
  role: Role;
  title: string;
  body: string;
  bullets?: string[];
  primaryCta?: string;
  primaryHref?: string;
  secondaryCta?: string;
  secondaryHref?: string;
  children?: ReactNode;
};

/**
 * Shared marketing/auth entry shell for landlord + broker.
 * Same typography, width, spacing, header/footer — content differs by role.
 */
export function RoleEntryPage({
  role,
  title,
  body,
  bullets,
  primaryCta = 'Sign in to get started',
  primaryHref,
  secondaryCta = 'Back to Dwel',
  secondaryHref = '/',
  children,
}: Props) {
  const returnTo = role === 'landlord' ? '/dashboard' : '/broker/dashboard';
  const href =
    primaryHref ??
    `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div className="flex min-h-screen flex-col bg-[#F7F6F3]">
      <header className="border-b border-dwel-gray-200/80 bg-dwel-white/95">
        <div className="mx-auto flex max-w-[1098px] items-center justify-between px-4 py-3 sm:px-6 lg:px-12">
          <BrandMark href="/" />
          <Link href="/auth/login" className="text-sm font-semibold text-dwel-gray-600">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <p className="text-sm font-medium text-dwel-gray-500">Dwel</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-4 text-base leading-relaxed text-dwel-gray-600">{body}</p>
        {bullets && bullets.length > 0 && (
          <ul className="mt-6 list-disc space-y-2 pl-5 text-sm text-dwel-gray-600">
            {bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        {children}
        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link href={href}>
            <Button className="w-full sm:w-auto">{primaryCta}</Button>
          </Link>
          <Link href={secondaryHref} className="text-center text-sm font-semibold underline underline-offset-2">
            {secondaryCta}
          </Link>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
