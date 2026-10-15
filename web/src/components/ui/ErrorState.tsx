import type { ReactNode } from 'react';
import { Button } from './Button';

export function ErrorState({
  message,
  onRetry,
  action,
}: {
  message: string;
  onRetry?: () => void;
  action?: ReactNode;
}) {
  return (
    <div
      className="rounded-[16px] border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800"
      role="alert"
    >
      <p className="font-medium">{message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {onRetry ? (
          <Button variant="secondary" className="!py-2 text-sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {action}
      </div>
    </div>
  );
}
