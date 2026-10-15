import { Link, useLocation } from 'wouter';
import { BrandMark } from '../../components/brand/BrandMark';
import { PublicFooter } from '../../components/layout/PublicFooter';
import { Button } from '../../components/ui/Button';
import { setAuthReturn } from '../../lib/auth-return';
import { setPartyRole } from '../../lib/user-flow-store';

/**
 * Shared supply-side entry — landlord role stays `landlord` internally;
 * public copy uses "Home provider".
 */
export function PartnerPage() {
  const [, setLocation] = useLocation();

  function continueAs(role: 'landlord' | 'broker') {
    setPartyRole(role);
    const returnTo = role === 'landlord' ? '/partner/landlord' : '/partner/broker';
    setAuthReturn({ returnTo });
    setLocation(`/auth/login?returnTo=${encodeURIComponent(returnTo)}&role=${role}`);
  }

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

      <main className="mx-auto w-full max-w-[960px] flex-1 px-4 py-14 sm:px-6 lg:px-12">
        <p className="text-sm font-medium text-dwel-gray-500">Dwel Partner</p>
        <h1 className="mt-2 max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-5xl">
          Put your properties in front of renters who are ready to move.
        </h1>
        <p className="mt-4 max-w-[48ch] text-base text-dwel-gray-600">
          List homes, manage renter interest, and work with Dwel from one place.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          <div className="relative">
            <div
              className="pointer-events-none absolute inset-[12%_8%_-8%] z-0 rounded-full bg-[#4DFA9F]/[0.14] blur-[38px]"
              aria-hidden
            />
            <section className="relative z-10 rounded-[16px] border border-dwel-gray-200 bg-dwel-white p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-dwel-gray-400">
                Home provider
              </p>
              <h2 className="mt-2 text-xl font-semibold">I provide rental homes</h2>
              <p className="mt-3 text-sm leading-relaxed text-dwel-gray-600">
                List properties, review renter interest, request screening, and manage
                applications.
              </p>
              <Button className="mt-6 w-full sm:w-auto" onClick={() => continueAs('landlord')}>
                Continue as a home provider
              </Button>
            </section>
          </div>

          <div className="relative">
            <div
              className="pointer-events-none absolute inset-[12%_8%_-8%] z-0 rounded-full bg-[#4DFA9F]/[0.14] blur-[38px]"
              aria-hidden
            />
            <section className="relative z-10 rounded-[16px] border border-dwel-gray-200 bg-dwel-white p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-dwel-gray-400">
                Broker / agent
              </p>
              <h2 className="mt-2 text-xl font-semibold">I&apos;m a broker or agent</h2>
              <p className="mt-3 text-sm leading-relaxed text-dwel-gray-600">
                Manage listings for clients, invite property owners, and oversee renter activity
                across your portfolio.
              </p>
              <Button className="mt-6 w-full sm:w-auto" onClick={() => continueAs('broker')}>
                Continue as a broker
              </Button>
            </section>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
