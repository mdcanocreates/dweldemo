import type { ReactNode } from 'react';
import { Link } from 'wouter';

export function MetricCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
}) {
  const inner = (
    <>
      <p className="text-[13px] text-dwel-muted">{label}</p>
      <p className="mt-2 text-[28px] font-extrabold tracking-tight text-dwel-ink">{value}</p>
      {hint ? <p className="mt-2 text-xs text-dwel-muted">{hint}</p> : null}
    </>
  );

  const className =
    'block rounded-[18px] border border-dwel-line bg-dwel-surface p-[18px] shadow-[0_1px_1px_rgba(0,0,0,0.02)] transition hover:shadow-[0_10px_28px_rgba(0,0,0,0.08)]';

  if (href) {
    return (
      <Link href={href} className={`${className} cursor-pointer`}>
        {inner}
      </Link>
    );
  }
  return <div className={className}>{inner}</div>;
}
