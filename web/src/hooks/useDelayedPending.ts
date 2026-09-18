import { useEffect, useState } from 'react';

/** M-4 — no loading UI until pending ≥ delayMs (default 400). */
export function useDelayedPending(pending: boolean, delayMs = 400): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!pending) {
      setShow(false);
      return;
    }
    const t = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(t);
  }, [pending, delayMs]);
  return show;
}
