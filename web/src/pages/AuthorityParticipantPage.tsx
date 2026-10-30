import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Shell } from '../components/Shell';

/** Households this signed-in person has accepted. Other agency cases are not listed. */
export function AuthorityParticipantPage() {
  const [rows, setRows] = useState<Array<{ id: string; reference: string; statusLabel: string }>>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .authorityParticipantCases()
      .then((data) => {
        if (!controller.signal.aborted) setRows(data.cases);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setMessage(err instanceof ApiError ? err.message : 'Your housing search could not be loaded.');
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <Shell>
      <h1>My housing search</h1>
      {message && <p role="alert">{message}</p>}
      {rows.length === 0 && !message && <p>No shared housing search is available.</p>}
      {rows.length > 0 && (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              {row.reference}: {row.statusLabel}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
