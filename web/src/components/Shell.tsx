import type { ReactNode } from 'react';
import { ProductFrame } from './ProductChrome';

export function Shell({ children }: { children: ReactNode; footer?: ReactNode; lockViewport?: boolean }) {
  return <ProductFrame>{children}</ProductFrame>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="callout" role="status">
      <strong className="callout-title">{title}</strong>
      <div className="callout-body">{children}</div>
    </div>
  );
}

export function ErrorState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="callout-attention" role="alert">
      <strong className="callout-title">{title}</strong>
      <div className="callout-body">{children}</div>
    </div>
  );
}
