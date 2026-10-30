import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Shell } from '../components/Shell';

const ACTIVITY: Record<string, string> = {
  'authority.case_created': 'Case created',
  'authority.task_created': 'Task created',
  'authority.task_updated': 'Task updated',
  'authority.appointment_rescheduled': 'Appointment rescheduled',
  'authority.packet_sent': 'Packet sent to the agency',
  'authority.agency_ack_received': 'Agency received the packet',
  'authority.leaseup_confirmed': 'Lease-up confirmed by the agency',
  'authority.document_previewed': 'Document previewed',
  'authority.share_accepted': 'Household accepted the share',
};

/** Owner and supervisor audit. Payloads, document keys, and voucher identifiers are not returned. */
export function AuthorityAuditPage() {
  const [rows, setRows] = useState<Array<{ id: string; kind: string; occurredAt: string }>>([]);
  const [message, setMessage] = useState('Loading audit…');

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const me = await api.authorityMe();
        const agencyId = me.agencies[0]?.agencyId;
        if (!agencyId) {
          if (!controller.signal.aborted) setMessage('No agency workspace is available for this account.');
          return;
        }
        const audit = await api.authorityAudit(agencyId);
        if (controller.signal.aborted) return;
        setRows(audit.events);
        setMessage(audit.events.length === 0 ? 'No audit events yet.' : '');
      } catch (err) {
        if (!controller.signal.aborted) {
          setMessage(err instanceof ApiError ? err.message : 'The audit could not be loaded.');
        }
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <Shell>
      <h1>Agency audit</h1>
      {message && <p role="status">{message}</p>}
      {rows.length > 0 && (
        <table>
          <caption>Agency activity</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.occurredAt).toLocaleString()}</td>
                <td>{ACTIVITY[row.kind] ?? 'Activity recorded'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
