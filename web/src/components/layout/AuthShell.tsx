import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { BrandMark } from '../brand/BrandMark';
import { PublicFooter } from './PublicFooter';

type Props = {
  title?: string;
  subtitle?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  children: ReactNode;
};

/** One shared Dwel auth surface for renter / landlord / broker. */
export function AuthShell({
  title = 'Sign in',
  subtitle = "Enter your email and we'll send you a secure sign-in link.",
  secondaryHref = '/',
  secondaryLabel = 'Back to Dwel',
  children,
}: Props) {
  return (
    <div className="flex min-h-screen flex-col bg-[#F7F6F3]">
      <header className="border-b border-dwel-gray-200/80 bg-dwel-white/95">
        <div className="mx-auto flex max-w-[1098px] items-center px-4 py-3 sm:px-6 lg:px-12">
          <BrandMark href="/" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <div className="rounded-[16px] border border-dwel-gray-200 bg-dwel-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-dwel-gray-500">{subtitle}</p>
          <div className="mt-6">{children}</div>
          <p className="mt-6 text-sm text-dwel-gray-500">
            <Link href={secondaryHref} className="font-semibold underline underline-offset-2">
              {secondaryLabel}
            </Link>
          </p>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
