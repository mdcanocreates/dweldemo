import type { ReactNode } from 'react';
import { LEGAL_APPROVED } from '../config/legalStatus';

type Gate = keyof typeof LEGAL_APPROVED;

export function DraftLegalBanner({ gate }: { gate?: Gate }) {
  if (gate && LEGAL_APPROVED[gate]) return null;
  return (
    <div className="draft-banner" role="status">
      DRAFT — Pending Legal Review by RBIT Counsel. Not yet approved for reliance.
    </div>
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

/** Visible counsel placeholder — keep in rendered copy until Jacob resolves. */
export function NeedsJacob({ children }: { children: ReactNode }) {
  return <strong className="legal-needs-jacob">[NEEDS JACOB — {children}]</strong>;
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
