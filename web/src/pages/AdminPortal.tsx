import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet } from 'react-router-dom';
import { api, ApiError, getMemorySessionId } from '../api';
import { useAuth } from '../auth';
import { EmptyState, ErrorState, Shell } from '../components/Shell';

function isPlatformAdmin(roles: Array<{ role: string }>): boolean {
  return roles.some((r) => r.role === 'rbit_admin' || r.role === 'rbit_super_admin');
}

function isSuperAdmin(roles: Array<{ role: string }>): boolean {
  return roles.some((r) => r.role === 'rbit_super_admin');
}

function AdminFrame({ children }: { children: ReactNode }) {
  return (
    <Shell>
      <div className="admin-layout">
        <aside className="admin-side" aria-label="Admin">
          <p className="section-eyebrow">RBIT ops</p>
          <nav className="admin-nav">
            <NavLink to="/admin/users">Users</NavLink>
            <NavLink to="/admin/orgs">Orgs</NavLink>
            <NavLink to="/admin/config/consent">Consent</NavLink>
            <NavLink to="/admin/integrations/certn">Certn</NavLink>
            <NavLink to="/admin/reviews/self-execution">Self-execution</NavLink>
            <NavLink to="/admin/config/flags">Flags</NavLink>
            <NavLink to="/admin/audit">Audit</NavLink>
          </nav>
          <Link to="/">← Marketing site</Link>
        </aside>
        <div className="admin-main">{children}</div>
      </div>
    </Shell>
  );
}

export function AdminGuard() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <Shell>
        <p>Checking sign-in…</p>
      </Shell>
    );
  }
  if (!user) return <Navigate to="/sign-in" replace />;
  if (!isPlatformAdmin(user.roles)) {
    return (
      <Shell>
        <EmptyState title="Admin access required">
          This console is limited to rbit_admin / rbit_super_admin.
        </EmptyState>
      </Shell>
    );
  }
  return (
    <AdminFrame>
      <Outlet />
    </AdminFrame>
  );
}

export function AdminUsersPage() {
  const { user } = useAuth();
  const superAdmin = user ? isSuperAdmin(user.roles) : false;
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [partyId, setPartyId] = useState('');
  const [role, setRole] = useState('renter');
  const [orgId, setOrgId] = useState('');

  async function load(search = q) {
    const data = await api.adminUsers(search);
    setRows(data.items as Array<Record<string, unknown>>);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.adminUsers('');
        if (!cancelled) setRows(data.items as Array<Record<string, unknown>>);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="stack">
      <h1>Users</h1>
      {error && <ErrorState title="Users error">{error}</ErrorState>}
      <form
        className="row-between"
        onSubmit={(e) => {
          e.preventDefault();
          void load().catch((err) =>
            setError(err instanceof ApiError ? err.message : 'Search failed'),
          );
        }}
      >
        <input
          placeholder="Search party id / email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Party</th>
              <th>Email ref</th>
              <th>Roles</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.party_id)}>
                <td className="font-mono">{String(r.party_id).slice(0, 8)}…</td>
                <td>{String(r.email_ref ?? '—')}</td>
                <td className="font-mono" style={{ fontSize: '0.75rem' }}>
                  {JSON.stringify(r.roles)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {superAdmin && (
        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              try {
                await api.adminAssignRole({
                  party_id: partyId,
                  role,
                  org_id: orgId.trim() ? orgId : null,
                });
                await load();
                setError(null);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Role assign failed');
              }
            })();
          }}
        >
          <h2>Assign role (rbit_super_admin)</h2>
          <div className="form-grid">
            <div className="field">
              <label>Party id</label>
              <input required value={partyId} onChange={(e) => setPartyId(e.target.value)} />
            </div>
            <div className="field">
              <label>Role</label>
              <input required value={role} onChange={(e) => setRole(e.target.value)} />
            </div>
            <div className="field">
              <label>Org id (optional)</label>
              <input value={orgId} onChange={(e) => setOrgId(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="btn btn-primary">
            Grant role
          </button>
        </form>
      )}
    </div>
  );
}

export function AdminOrgsPage() {
  const { user } = useAuth();
  const superAdmin = user ? isSuperAdmin(user.roles) : false;
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const data = await api.adminOrgs('');
    setRows(data.items);
  }

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof ApiError ? err.message : 'Load failed'),
    );
  }, []);

  return (
    <div className="stack">
      <h1>Organizations</h1>
      {error && <ErrorState title="Orgs error">{error}</ErrorState>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Connect</th>
              <th>Self-exec</th>
              <th>Broker payouts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={String(o.id)}>
                <td>{String(o.display_name)}</td>
                <td>{String(o.kind)}</td>
                <td className="font-mono">
                  {String(o.stripe_connect_status ?? '—')}
                </td>
                <td>{String(o.self_execution_status ?? '—')}</td>
                <td>
                  {String(Boolean(o.broker_payouts_enabled))}
                  {superAdmin && (
                    <button
                      type="button"
                      className="btn btn-soft"
                      style={{ marginLeft: '0.5rem' }}
                      onClick={() => {
                        void (async () => {
                          try {
                            await api.adminOrgFlags(
                              String(o.id),
                              !o.broker_payouts_enabled,
                            );
                            await load();
                          } catch (err) {
                            setError(
                              err instanceof ApiError ? err.message : 'Flag update failed',
                            );
                          }
                        })();
                      }}
                    >
                      Toggle
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminConsentPage() {
  const { user } = useAuth();
  const superAdmin = user ? isSuperAdmin(user.roles) : false;
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await api.adminConsent();
        setText(cfg.text ?? '');
        setHistory(cfg.change_log ?? []);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, []);

  return (
    <div className="stack">
      <h1>Consent copy</h1>
      {error && <ErrorState title="Consent error">{error}</ErrorState>}
      {msg && <p className="callout">{msg}</p>}
      <textarea
        rows={12}
        value={text}
        disabled={!superAdmin}
        onChange={(e) => setText(e.target.value)}
        style={{ width: '100%', fontFamily: 'var(--font-m)' }}
      />
      <div className="row-between" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={() => setPreview((p) => !p)}>
          {preview ? 'Hide preview' : 'Preview'}
        </button>
        {superAdmin && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void (async () => {
                try {
                  await api.adminPutConsent(text);
                  setMsg('Saved — live without redeploy.');
                  const cfg = await api.adminConsent();
                  setHistory(cfg.change_log ?? []);
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Save failed');
                }
              })();
            }}
          >
            Save
          </button>
        )}
      </div>
      {preview && (
        <div className="panel">
          <pre style={{ whiteSpace: 'pre-wrap' }}>{text}</pre>
        </div>
      )}
      {history.length > 0 && (
        <div className="panel stack">
          <h2>Change log</h2>
          <pre style={{ fontSize: '0.75rem', overflow: 'auto' }}>
            {JSON.stringify(history, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function AdminCertnPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api
      .adminCertn()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Load failed'));
  }, []);
  return (
    <div className="stack">
      <h1>Certn status</h1>
      <p className="muted">Read-only. Secrets are never editable here.</p>
      {error && <ErrorState title="Certn error">{error}</ErrorState>}
      {data && (
        <pre className="panel" style={{ overflow: 'auto', fontSize: '0.8rem' }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AdminSelfExecutionPage() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function load(s = status) {
    const data = await api.adminSelfExecution(s);
    setRows(data.items);
  }

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof ApiError ? err.message : 'Load failed'),
    );
  }, [status]);

  return (
    <div className="stack">
      <h1>Self-execution review</h1>
      {error && <ErrorState title="Review error">{error}</ErrorState>}
      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="pending">pending</option>
        <option value="verified">verified</option>
        <option value="rejected">rejected</option>
      </select>
      {rows.map((r) => (
        <article key={String(r.id)} className="panel stack">
          <p className="font-mono">{String(r.id)}</p>
          <p>
            Org {String(r.org_id)} · {String(r.license_type)} · {String(r.license_state)} ·{' '}
            {String(r.status)}
          </p>
          <textarea
            placeholder="Reviewer notes (required to reject)"
            value={notes[String(r.id)] ?? ''}
            onChange={(e) => setNotes({ ...notes, [String(r.id)]: e.target.value })}
          />
          <div className="row-between" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const ok = window.confirm(
                  'Verify this self-execution evidence?\n\nWARNING: interim_v1 — state-specific license rules are not fully encoded. Proceed only with manual diligence.',
                );
                if (!ok) return;
                void (async () => {
                  try {
                    await api.adminDecideSelfExecution(String(r.id), {
                      decision: 'verify',
                      notes: notes[String(r.id)],
                    });
                    await load();
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : 'Verify failed');
                  }
                })();
              }}
            >
              Verify (interim_v1)
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                void (async () => {
                  try {
                    await api.adminDecideSelfExecution(String(r.id), {
                      decision: 'reject',
                      notes: notes[String(r.id)],
                    });
                    await load();
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : 'Reject failed');
                  }
                })();
              }}
            >
              Reject
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function AdminFlagsPage() {
  const { user } = useAuth();
  const superAdmin = user ? isSuperAdmin(user.roles) : false;
  const [flags, setFlags] = useState<Array<Record<string, unknown>>>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const data = await api.adminFlags();
    setFlags(data.flags);
    setNote(data.note ?? '');
  }

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof ApiError ? err.message : 'Load failed'),
    );
  }, []);

  return (
    <div className="stack">
      <h1>Feature flags</h1>
      <p className="muted">{note}</p>
      {error && <ErrorState title="Flags error">{error}</ErrorState>}
      {flags.map((f) => (
        <div key={String(f.name)} className="panel row-between">
          <div>
            <strong>{String(f.name)}</strong>
            <p className="muted">{String(f.description ?? '')}</p>
            {f.compliance_tag ? (
              <span className="font-mono" style={{ fontSize: '0.7rem' }}>
                {String(f.compliance_tag)}
              </span>
            ) : null}
          </div>
          <div>
            <span>{f.enabled ? 'ON' : 'OFF'}</span>
            {superAdmin && (
              <button
                type="button"
                className="btn btn-soft"
                style={{ marginLeft: '0.5rem' }}
                onClick={() => {
                  void (async () => {
                    try {
                      await api.adminSetFlag(String(f.name), !f.enabled);
                      await load();
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : 'Toggle failed');
                    }
                  })();
                }}
              >
                Toggle
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminAuditPage() {
  const [eventType, setEventType] = useState('');
  const [partyId, setPartyId] = useState('');
  const [orgId, setOrgId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);

  function params() {
    const p: Record<string, string> = { limit: '100' };
    if (eventType) p.event_type = eventType;
    if (partyId) p.party_id = partyId;
    if (orgId) p.org_id = orgId;
    if (from) p.from = from;
    if (to) p.to = to;
    return p;
  }

  async function load() {
    const data = await api.adminAudit(params());
    setRows(data.items);
  }

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof ApiError ? err.message : 'Load failed'),
    );
  }, []);

  return (
    <div className="stack">
      <h1>Audit log</h1>
      <p className="muted">No PII in rows — party_id / org_id references only.</p>
      {error && <ErrorState title="Audit error">{error}</ErrorState>}
      <div className="form-grid">
        <div className="field">
          <label>Event type</label>
          <input value={eventType} onChange={(e) => setEventType(e.target.value)} />
        </div>
        <div className="field">
          <label>Party id</label>
          <input value={partyId} onChange={(e) => setPartyId(e.target.value)} />
        </div>
        <div className="field">
          <label>Org id</label>
          <input value={orgId} onChange={(e) => setOrgId(e.target.value)} />
        </div>
        <div className="field">
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="row-between" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            void load().catch((err) =>
              setError(err instanceof ApiError ? err.message : 'Load failed'),
            );
          }}
        >
          Apply filters
        </button>
        <a
          className="btn btn-primary"
          href={api.adminAuditCsvUrl(params())}
          onClick={(e) => {
            // fetch with session cookie via window open won't send bearer; use fetch blob
            e.preventDefault();
            void (async () => {
              try {
                const headers: Record<string, string> = {};
                const sid = getMemorySessionId();
                if (sid) headers.Authorization = `Bearer ${sid}`;
                const res = await fetch(api.adminAuditCsvUrl(params()), {
                  credentials: 'include',
                  headers,
                });
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'audit.csv';
                a.click();
                URL.revokeObjectURL(url);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'CSV export failed');
              }
            })();
          }}
        >
          Export CSV
        </a>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Aggregate</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>{String(r.occurred_at ?? '')}</td>
                <td>{String(r.event_type)}</td>
                <td className="font-mono">
                  {String(r.aggregate_type)}/{String(r.aggregate_id).slice(0, 8)}
                </td>
                <td className="font-mono">{String(r.actor_party_id ?? '—').slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminIndexRedirect() {
  return <Navigate to="/admin/users" replace />;
}
