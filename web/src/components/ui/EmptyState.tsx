import type { ReactNode } from 'react';

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[16px] border border-dwel-line bg-dwel-surface px-6 py-10 text-center">
      <p className="text-base font-semibold text-dwel-ink">{title}</p>
      {body ? <p className="mt-2 text-sm text-dwel-muted">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
