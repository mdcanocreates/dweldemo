import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { formatCents } from '../../lib/money';

/**
 * Transparent cashback explanation — estimate, not a guarantee.
 */
export function CashbackExplainLink({
  cashbackCents,
  rentCents,
  children,
}: {
  cashbackCents?: number | null;
  rentCents?: number | null;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (cashbackCents == null || cashbackCents <= 0) return null;

  return (
    <>
      <button
        type="button"
        className="text-left text-xs font-semibold text-dwel-ink underline underline-offset-2"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {children ?? 'How cashback works'}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cashback-explain-title"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[16px] border border-dwel-line bg-dwel-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="cashback-explain-title" className="text-lg font-semibold">
              How this cashback estimate works
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-dwel-muted">
              <li>
                Displayed amount: <strong className="text-dwel-ink">{formatCents(cashbackCents)}</strong>
                {rentCents != null ? (
                  <>
                    {' '}
                    (~20% of listed first-month rent {formatCents(rentCents)})
                  </>
                ) : (
                  <> based on 20% of listed first-month rent</>
                )}
                .
              </li>
              <li>This is an estimate from Dwel&apos;s interim incentive rule — not a guaranteed payout.</li>
              <li>
                Final eligibility depends on a qualifying completed lease and program terms. Amounts can
                change if rent changes before signing; we preserve the offer version when you express
                interest.
              </li>
              <li>Payment timing and method are confirmed after lease qualification — not at interest.</li>
              <li>If a lease falls through, cashback is not owed.</li>
            </ul>
            <p className="mt-4 text-sm">
              <Link href="/cashback-terms" className="font-semibold underline" onClick={() => setOpen(false)}>
                Read cashback terms
              </Link>
            </p>
            <button
              type="button"
              className="mt-5 min-h-11 w-full rounded-[12px] bg-dwel-ink px-4 py-2 text-sm font-semibold text-white"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
