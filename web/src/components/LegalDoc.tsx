import type { ReactNode } from 'react';
import { LEGAL_APPROVED } from '../config/legalStatus';

type Gate = keyof typeof LEGAL_APPROVED;

export function DraftLegalBanner({ gate }: { gate?: Gate }) {
  if (gate && LEGAL_APPROVED[gate]) return null;
  // Quiet status note — not a high-contrast marketing banner. Still accurate: not counsel-approved.
  return (
    <p className="legal-status-note" role="status">
      This page is pending final counsel review and is provided for informational reference only.
    </p>
  );
}

export function LegalDocLayout({
  title,
  gate,
  children,
}: {
  title: string;
  gate?: Gate;
  children: ReactNode;
}) {
  return (
    <article className="legal-doc stack">
      {gate ? <DraftLegalBanner gate={gate} /> : null}
      <h1 className="section-title">{title}</h1>
      <div className="legal-doc-body">{children}</div>
    </article>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="legal-p">{children}</p>;
}

export function H({ children }: { children: ReactNode }) {
  return <h2 className="legal-h">{children}</h2>;
}

export function Ul({ children }: { children: ReactNode }) {
  return <ul className="legal-list">{children}</ul>;
}

/** Internal counsel marker — kept out of consumer-facing emphasis styling. */
export function NeedsJacob({ children }: { children: ReactNode }) {
  return <span className="legal-counsel-note">{children}</span>;
}

/**
 * Asterisked draft sentence for Jacob on-site review.
 * Leading * stays in live text until Jacob/Michael remove it after approval.
 */
export function Star({ children }: { children: ReactNode }) {
  return (
    <p className="legal-p legal-star">
      <span className="legal-asterisk">*</span> {children}
    </p>
  );
}
