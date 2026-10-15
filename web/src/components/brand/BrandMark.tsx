import { Link } from 'wouter';

/**
 * Sibling-product brand mark (Lumis pattern): small RBIT favicon + Dwel wordmark.
 * Uses public/faviconrbit.png — the only RBIT mark asset present in this repo.
 */
export function BrandMark({
  href = '/',
  className = '',
  tone = 'dark',
}: {
  href?: string;
  className?: string;
  tone?: 'dark' | 'light';
}) {
  const text = tone === 'light' ? 'text-dwel-white' : 'text-dwel-black';
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 tracking-tight ${text} ${className}`}
      aria-label="Dwel home"
    >
      <img
        src="/faviconrbit.png"
        alt=""
        width={22}
        height={22}
        className="h-[22px] w-[22px] shrink-0 object-contain"
      />
      <span className="text-xl font-bold">Dwel</span>
    </Link>
  );
}
