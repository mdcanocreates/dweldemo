import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Shell } from '../components/Shell';

type Workspace = Awaited<ReturnType<typeof api.authorityWorkspace>>;

/** Case workspace. Buttons follow the server permission flags, and the server checks them again. */
export function AuthorityCasePage() {
  const caseId = useParams().caseId ?? '';
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [data, setData] = useState<Workspace | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [appointmentVersion, setAppointmentVersion] = useState(1);

  const load = useCallback(async (id: string, currentCase: string) => {
    const workspace = await api.authorityWorkspace(id, currentCase);
    setData(workspace);
    const first = workspace.appointments[0];
    if (first) {
      setAppointmentId(first.id);
      setAppointmentVersion(first.version);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const me = await api.authorityMe();
        if (controller.signal.aborted) return;
        const id = me.agencies[0]?.agencyId ?? null;
        setAgencyId(id);
        if (!id) {
          setState('error');
          setMessage('No agency workspace is available for this account.');
          return;
        }
        await load(id, caseId);
        if (!controller.signal.aborted) setState('ready');
      } catch (err) {
        if (controller.signal.aborted) return;
        setState('error');
        setMessage(err instanceof ApiError ? err.message : 'This case could not be loaded.');
      }
    })();
    return () => controller.abort();
  }, [caseId, load]);

  async function refresh() {
    if (!agencyId) return;
    await load(agencyId, caseId);
    setState('ready');
  }

  async function onTask(event: FormEvent) {
    event.preventDefault();
    if (!agencyId) return;
    setMessage(null);
    try {
      await api.authorityCreateTask(agencyId, caseId, {
        title,
        dueAt: new Date(Date.now() - 60_000).toISOString(),
      });
      setTitle('');
      await refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'The task could not be saved.');
    }
  }

  async function onSchedule(event: FormEvent) {
    event.preventDefault();
    if (!agencyId) return;
    setMessage(null);
    try {
      const start = new Date(Date.now() + 86_400_000).toISOString();
      const scheduled = await api.authoritySchedule(agencyId, caseId, start);
      setAppointmentId(scheduled.appointmentId);
      setAppointmentVersion(scheduled.version);
      await refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'The appointment could not be saved.');
    }
  }

  async function onReschedule(event: FormEvent) {
    event.preventDefault();
    if (!agencyId || !appointmentId) return;
    setMessage(null);
    try {
      const start = new Date(Date.now() + 2 * 86_400_000);
      const end = new Date(start.getTime() + 60 * 60_000);
      await api.authorityReschedule(agencyId, appointmentId, {
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        reason,
        expectedVersion: appointmentVersion,
      });
      setReason('');
      await refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'The appointment could not be moved.');
    }
  }

  async function onFile(file: File) {
    if (!agencyId) return;
    setMessage(null);
    try {
      const intent = await api.authorityUploadIntent(agencyId, caseId, {
        filename: file.name,
        mimeType: file.type || 'application/pdf',
        byteSize: file.size,
      });
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      await api.authorityCompleteUpload(agencyId, intent.documentId, btoa(binary));
      await refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'The file could not be uploaded.');
    }
  }

  async function onEnroll() {
    setMessage(null);
    try {
      const enrolled = await api.authorityEnrollMfa();
      setSecret(enrolled.secret);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Verification could not be started.');
    }
  }

  async function onConfirm(event: FormEvent) {
    event.preventDefault();
    if (!agencyId) return;
    const code = String(new FormData(event.currentTarget as HTMLFormElement).get('code') ?? '');
    setMessage(null);
    try {
      await api.authorityConfirmMfa(code);
      setSecret(null);
      setMessage('Verification code accepted.');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'That verification code was not accepted.');
    }
  }

  async function onLeaseup() {
    if (!agencyId) return;
    setMessage(null);
    try {
      const saved = await api.authorityLeaseup(agencyId, caseId, 'PHA lease-up desk');
      setMessage(saved.statusLabel);
      await refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Lease-up could not be recorded.');
    }
  }

  return (
    <Shell>
      <p>
        <Link to="/authority/cases">Back to housing searches</Link>
      </p>
      <h1>Housing case</h1>
      {state === 'loading' && <p role="status">Loading housing case…</p>}
      {message && <p role="alert">{message}</p>}
      {state === 'error' && !data && <p role="alert">{message}</p>}
      {data && (
        <>
          <p>
            {data.case.reference}: {data.case.statusLabel}
          </p>
          <p>{data.case.nextAction}</p>
          <h2>Tasks</h2>
          {data.tasks.length === 0 && <p>No tasks yet.</p>}
          <ul>
            {data.tasks.map((task) => (
              <li key={task.id}>
                {task.title}: {task.statusLabel}
              </li>
            ))}
          </ul>
          {data.permissions.canWrite && (
            <form onSubmit={(event) => void onTask(event)}>
              <label>
                Task title
                <input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} />
              </label>
              <button type="submit">Save task</button>
            </form>
          )}
          <h2>Appointments</h2>
          {data.appointments.length === 0 && <p>No appointments yet.</p>}
          <ul>
            {data.appointments.map((visit) => (
              <li key={visit.id}>
                {visit.statusLabel}
                {visit.localLabel ? ` ${visit.localLabel}` : ''}
              </li>
            ))}
          </ul>
          {data.permissions.canSchedule && (
            <form onSubmit={(event) => void onSchedule(event)}>
              <button type="submit">Schedule visit</button>
            </form>
          )}
          {data.permissions.canSchedule && appointmentId && (
            <form onSubmit={(event) => void onReschedule(event)}>
              <label>
                Reason for the new time
                <input value={reason} onChange={(event) => setReason(event.target.value)} required minLength={5} />
              </label>
              <button type="submit">Reschedule visit</button>
            </form>
          )}
          <h2>Documents</h2>
          {data.documents.length === 0 && <p>No documents yet.</p>}
          <ul>
            {data.documents.map((doc) => (
              <li key={doc.id}>
                {doc.statusLabel}
                {doc.previewable && (
                  <button type="button" onClick={() => void api.authorityPreview(agencyId!, doc.id)}>
                    Preview
                  </button>
                )}
              </li>
            ))}
          </ul>
          <label>
            Evidence file
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
          </label>
          {data.permissions.canVerify && (
            <section>
              <h2>Privileged confirmation</h2>
              <button type="button" onClick={() => void onEnroll()}>
                Set up verification
              </button>
              {secret && (
                <p>
                  Authenticator secret <span>{secret}</span>
                </p>
              )}
              <form onSubmit={(event) => void onConfirm(event)}>
                <label>
                  Verification code
                  <input name="code" inputMode="numeric" autoComplete="one-time-code" />
                </label>
                <button type="submit">Confirm code</button>
              </form>
              <button type="button" onClick={() => void onLeaseup()}>
                Record lease-up
              </button>
            </section>
          )}
        </>
      )}
    </Shell>
  );
}
