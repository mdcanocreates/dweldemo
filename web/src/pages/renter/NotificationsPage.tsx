import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { RenterShell } from '../../components/layout/RenterShell';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { LoadingState } from '../../components/ui/LoadingState';
import { api, ApiError } from '../../api/client';
import { friendlyApiError } from '../../lib/application-status';

type Row = {
  id: string;
  event_type: string;
  template_key: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
  read_at: string | null;
  deep_link: string | null;
};

function labelFor(eventType: string): string {
  const map: Record<string, string> = {
    applicant_request_screening: 'Home Provider moved forward',
    applicant_move_forward: 'Home Provider moved forward',
    applicant_pass: 'Home Provider passed for now',
    applicant_request_more_info: 'Missing information requested',
    applicant_approved: 'Application approved',
    applicant_declined: 'Application outcome',
    'notification.queued': 'Update',
  };
  return map[eventType] ?? eventType.replace(/[._]/g, ' ');
}

export function NotificationsPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listNotifications();
      setItems(res.notifications);
    } catch (err) {
      setError(
        friendlyApiError(err instanceof ApiError ? err.message : 'Could not load notifications.'),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function markRead(id: string) {
    try {
      await api.markNotificationRead(id);
      setItems((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n,
        ),
      );
    } catch {
      /* non-blocking */
    }
  }

  return (
    <RenterShell>
      <h1 className="text-[32px] font-semibold tracking-tight">Notifications</h1>
      <p className="mt-1 text-sm text-dwel-muted">
        Application, screening, and decision updates. Each item deep-links to its context.
      </p>

      {loading ? (
        <div className="mt-6">
          <LoadingState />
        </div>
      ) : null}
      {error ? (
        <div className="mt-6">
          <ErrorState message={error} onRetry={() => void refresh()} />
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <Card className="mt-6 p-[18px] text-sm text-dwel-muted">No notifications yet.</Card>
      ) : null}

      <ul className="mt-6 space-y-2">
        {items.map((n) => (
          <li key={n.id}>
            <Card
              className={`p-[14px] ${n.read_at ? 'opacity-80' : 'border-dwel-mint/40 bg-dwel-mint/5'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{labelFor(n.event_type)}</p>
                  <p className="mt-1 text-xs text-dwel-muted">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  {n.deep_link ? (
                    <Link href={n.deep_link}>
                      <Button
                        variant="secondary"
                        className="!py-1.5 text-sm"
                        onClick={() => void markRead(n.id)}
                      >
                        Open
                      </Button>
                    </Link>
                  ) : null}
                  {!n.read_at ? (
                    <Button
                      variant="secondary"
                      className="!py-1.5 text-sm"
                      onClick={() => void markRead(n.id)}
                    >
                      Mark read
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </RenterShell>
  );
}
