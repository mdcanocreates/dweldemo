import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[16px] border border-dwel-line bg-dwel-surface ${className}`}
    >
      {children}
    </div>
  );
}
