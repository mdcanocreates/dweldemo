import { formatCents } from '../../lib/money';
import { CashbackExplainLink } from './CashbackExplain';

/**
 * Compact mint cash-back pill for renter-facing listing photos / detail.
 * Renders nothing when amount is missing or non-positive — never invents.
 */
export function CashbackBadge({
  cashbackCents,
  rentCents,
  className = '',
  compact = false,
  explain = false,
}: {
  cashbackCents?: number | null;
  rentCents?: number | null;
  className?: string;
  /** Uppercase short label for detail chips (e.g. "$560 CASH BACK") */
  compact?: boolean;
  /** Show tap-through estimate explanation (detail surfaces). */
  explain?: boolean;
}) {
  if (cashbackCents == null || !Number.isFinite(cashbackCents) || cashbackCents <= 0) {
    return null;
  }
  const amount = formatCents(cashbackCents);
  const label = compact ? `${amount} cash back`.toUpperCase() : `${amount} cash back`;

  return (
    <span
      className={`z-[2] inline-flex flex-col items-start gap-1 ${className}`}
      aria-label={`Dwel cash back estimate ${amount}`}
    >
      <span className="pointer-events-none inline-flex items-center rounded-full bg-dwel-mint px-[9px] py-1.5 text-[12px] font-extrabold leading-none text-dwel-ink shadow-sm">
        {label}
      </span>
      {explain ? (
        <CashbackExplainLink cashbackCents={cashbackCents} rentCents={rentCents}>
          Estimate · how cashback works
        </CashbackExplainLink>
      ) : null}
    </span>
  );
}
