import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Shell } from '../components/Shell';

type CaseRow = {
  id: string;
  reference: string;
  statusLabel: string;
  nextAction: string;
};

/** Agency housing queue. The server is the source of truth; this page does not store cases locally. */
export function AuthorityCasesPage() {
  const routeAgencyId = useParams().agencyId ?? null;
  const [agencyId, setAgencyId] = useState<string | null>(routeAgencyId);
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [bedrooms, setBedrooms] = useState('2');

  const loadCases = useCallback(async (id: string, signal?: AbortSignal) => {
    const data = await api.authorityCases(id);
    if (signal?.aborted) return;
    setRows(
      (data.cases ?? []).map((row) => ({
        id: String(row.id),
        reference: String(row.reference),
        statusLabel: String(row.statusLabel),
        nextAction: String(row.nextAction),
      })),
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const id = routeAgencyId ?? (await api.authorityMe()).agencies[0]?.agencyId ?? null;
        if (controller.signal.aborted) return;
        setAgencyId(id);
        if (!id) {
          setState('ready');
          return;
        }
        await loadCases(id, controller.signal);
        if (!controller.signal.aborted) setState('ready');
      } catch (err) {
        if (controller.signal.aborted) return;
        setState('error');
        setMessage(err instanceof ApiError ? err.message : 'Cases could not be loaded. Try again.');
      }
    })();
    return () => controller.abort();
  }, [loadCases, routeAgencyId]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!agencyId) return;
    setMessage(null);
    try {
      await api.authorityCreateCase(agencyId, {
        displayReference: reference,
        searchPreferences: { bedroomsMin: Number(bedrooms) },
        assistanceIndicator: 'unknown',
      });
      setReference('');
      await loadCases(agencyId);
      setState('ready');
    } catch (err) {
      setState('error');
      setMessage(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : 'Cases could not be loaded. Try again.',
      );
    }
  }

  return (
    <Shell>
      <h1>Agency housing searches</h1>
      {state === 'loading' && <p role="status">Loading housing cases…</p>}
      {state === 'error' && (
        <p role="alert">
          {message ?? 'Cases could not be loaded. Try again.'}{' '}
          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      )}
      {state === 'ready' && !agencyId && <p>No agency workspace is available for this account.</p>}
      {state === 'ready' && agencyId && rows.length === 0 && (
        <p>No active cases yet. Create a housing search case to begin.</p>
      )}
      {state === 'ready' && rows.length > 0 && (
        <table>
          <caption>Agency housing searches</caption>
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Status</th>
              <th scope="col">Next action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <Link to={`/authority/cases/${row.id}`}>{row.reference}</Link>
                </th>
                <td>{row.statusLabel}</td>
                <td>{row.nextAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {agencyId && (
        <form onSubmit={(event) => void onCreate(event)}>
          <button type="button" onClick={() => document.getElementById('case-reference')?.focus()}>
            New housing search
          </button>
          <label>
            Case reference
            <input
              id="case-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              required
              minLength={3}
            />
          </label>
          <label>
            Minimum bedrooms
            <input value={bedrooms} onChange={(event) => setBedrooms(event.target.value)} inputMode="numeric" />
          </label>
          <button type="submit">Save case</button>
        </form>
      )}
    </Shell>
  );
}
