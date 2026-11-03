import { formatMoney, type SavingsEstimate } from '../../lib/applicationSavings';

type Status = 'loading' | 'unavailable' | 'error' | 'ready';

export function ApplicationSavingsCard({
  estimate,
  status,
  onDismiss,
  savedCount = 0,
}: {
  estimate: SavingsEstimate | null;
  status: Status;
  onDismiss?: () => void;
  savedCount?: number;
}) {
  const ready = status === 'ready' && estimate?.completeEstimate === true;
  return (
    <aside className="dwel-savings-card" aria-label="Application fee savings estimate" data-testid="application-savings">
      <div className="dwel-savings-card__header">
        <p className="dwel-savings-card__eyebrow">Application savings</p>
        {onDismiss ? (
          <button
            type="button"
            className="dwel-savings-card__dismiss"
            aria-label="Dismiss savings estimate"
            onClick={onDismiss}
          >
            Close
          </button>
        ) : null}
      </div>
      {status === 'loading' && <p className="dwel-savings-card__empty">Checking participating homes…</p>}
      {status === 'error' && (
        <p className="dwel-savings-card__empty" role="alert">
          Savings could not be calculated.
        </p>
      )}
      {status === 'unavailable' && (
        <>
          <p className="dwel-savings-card__empty">Saved — estimate not ready</p>
          <p className="dwel-savings-card__description">
            {savedCount === 1 ? '1 home saved.' : `${savedCount} homes saved.`} A dollar amount appears only when
            verified reusable-screening fees are on file. This is not money already saved.
          </p>
        </>
      )}
      {ready && estimate && (
        <>
          <p className="dwel-savings-card__value">{formatMoney(estimate.estimatedSavingsCents)}</p>
          <p className="dwel-savings-card__description">
            Estimated across {estimate.eligibleHomes} eligible {estimate.eligibleHomes === 1 ? 'home' : 'homes'}
          </p>
        </>
      )}
      <p className="dwel-savings-card__disclaimer">
        Estimates compare disclosed application fees with applicable Dwel charges. Actual savings depend on
        participating properties, screening requirements, and fees. This is not money already saved.
      </p>
      <details className="dwel-savings-card__details">
        <summary>How this estimate works</summary>
        <p>
          A dollar amount appears only when each home has a disclosed application fee and is eligible to reuse one
          Dwel application. Cashback and rent are not part of the comparison. A separate consent can still be
          required at each property.
        </p>
      </details>
    </aside>
  );
}
