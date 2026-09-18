import { useState } from 'react';

const FROG_SUBTEXTS = [
  'Just a little boing…',
  'Finding your next place…',
  'Almost there…',
  'Checking the pond…',
] as const;

function randomSubtext(): string {
  return FROG_SUBTEXTS[Math.floor(Math.random() * FROG_SUBTEXTS.length)]!;
}

/** Full-screen frog — M-4: only for significant waits (search / submit / payment). */
export function FrogPageLoader({
  title = 'Hopping to the next home',
  copy,
}: {
  title?: string;
  copy?: string;
}) {
  // Random once per appearance (stable across re-renders of this mount).
  const [sub] = useState(() => copy ?? randomSubtext());
  return (
    <div className="dwel-page-loader" role="status" aria-live="polite" data-testid="frog-loader">
      <div className="dwel-page-loader-card">
        <div className="frog-scene" aria-hidden="true">
          <div className="frog-spark spark-one" />
          <div className="frog-spark spark-two" />
          <div className="lily-pad lily-pad-left" />
          <div className="lily-pad lily-pad-right" />
          <div className="frog">
            <span className="frog-eye frog-eye-left">
              <i />
            </span>
            <span className="frog-eye frog-eye-right">
              <i />
            </span>
            <span className="frog-mouth" />
            <span className="frog-leg frog-leg-left" />
            <span className="frog-leg frog-leg-right" />
          </div>
        </div>
        <p className="font-display frog-title">{title}</p>
        <p className="frog-copy">{sub}</p>
      </div>
    </div>
  );
}

/** Small inline spinner for ordinary portal waits (never full-screen). */
export function InlineSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="inline-spinner" role="status" aria-live="polite">
      <span className="inline-spinner-dot" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
