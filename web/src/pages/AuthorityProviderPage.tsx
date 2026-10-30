import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Shell } from '../components/Shell';

/** Homes a provider was asked about. Assistance and verification fields are not on this response. */
export function AuthorityProviderPage() {
  const [rows, setRows] = useState<Array<{ id: string; statusLabel: string }>>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .authorityProviderLeads()
      .then((data) => {
        if (!controller.signal.aborted) setRows(data.leads);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setMessage(err instanceof ApiError ? err.message : 'Outreach could not be loaded.');
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <Shell>
      <h1>Home provider requests</h1>
      {message && <p role="alert">{message}</p>}
      {rows.length === 0 && !message && <p>No requests are waiting.</p>}
      <ul>
        {rows.map((row) => (
          <li key={row.id}>{row.statusLabel}</li>
        ))}
      </ul>
    </Shell>
  );
}
