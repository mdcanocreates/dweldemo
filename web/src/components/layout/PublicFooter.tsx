import { Link } from 'wouter';
import { BrandMark } from '../brand/BrandMark';

/** Shared public footer — Dwel / RBIT product family. */
export function PublicFooter() {
  return (
    <footer className="border-t border-dwel-gray-200 bg-dwel-white">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 py-10 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:px-12">
        <div>
          <BrandMark href="/" />
          <p className="mt-2 text-sm text-dwel-gray-500">
            Dwel, a product of RBIT Financial Inc.
          </p>
          <p className="mt-1 text-sm text-dwel-gray-500">© 2026 RBIT Financial Inc.</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/about" className="font-medium text-dwel-gray-600 hover:text-dwel-black">
            About
          </Link>
          <Link href="/cashback-terms" className="font-medium text-dwel-gray-600 hover:text-dwel-black">
            Cashback terms
          </Link>
          <Link href="/fees" className="font-medium text-dwel-gray-600 hover:text-dwel-black">
            Fee &amp; screening details
          </Link>
          <Link href="/terms" className="font-medium text-dwel-gray-600 hover:text-dwel-black">
            Terms
          </Link>
          <Link href="/privacy" className="font-medium text-dwel-gray-600 hover:text-dwel-black">
            Privacy
          </Link>
          <Link href="/contact" className="font-medium text-dwel-gray-600 hover:text-dwel-black">
            Contact
          </Link>
        </nav>
      </div>
    </footer>
  );
}
