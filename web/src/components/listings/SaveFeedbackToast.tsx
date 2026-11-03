import type { SavingsEstimate } from '../../lib/applicationSavings';
import { formatMoney } from '../../lib/applicationSavings';

export type SaveFeedbackKind = 'directory' | 'unclaimed' | 'participating' | 'estimate';

export type SaveFeedback = {
  kind: SaveFeedbackKind;
  savedCount: number;
  estimate: SavingsEstimate | null;
  dwelFeeCents: number;
};

/**
 * Compact heart-triggered feedback. Hidden until a save occurs; dismissible.
 * Never implies money is already saved. Never shows provider listing fees.
 */
export function SaveFeedbackToast({
  feedback,
  onDismiss,
}: {
  feedback: SaveFeedback;
  onDismiss: () => void;
}) {
  const homes = `${feedback.savedCount} home${feedback.savedCount === 1 ? '' : 's'} saved`;
  let line2 = 'One $49 Dwel application · Reusable at participating homes';
  if (feedback.kind === 'directory') {
    line2 = 'Saved. Directory entries are not Dwel screening destinations.';
  } else if (feedback.kind === 'unclaimed') {
    line2 = 'Saved. Provider has not yet accepted Dwel applications.';
  } else if (feedback.kind === 'estimate' && feedback.estimate?.completeEstimate) {
    line2 = `Est. ${formatMoney(feedback.estimate.estimatedSavingsCents)} vs separate apps · one ${formatMoney(feedback.dwelFeeCents)} Dwel fee`;
  }

  return (
    <aside className="dwel-save-toast" role="status" data-testid="save-feedback-toast">
      <div className="dwel-save-toast__body">
        <p className="dwel-save-toast__title">{homes}</p>
        <p className="dwel-save-toast__line">{line2}</p>
      </div>
      <button type="button" className="dwel-save-toast__dismiss" aria-label="Dismiss" onClick={onDismiss}>
        Close
      </button>
    </aside>
  );
}
