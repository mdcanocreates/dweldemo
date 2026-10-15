import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { BrokerShell } from './BrokerDashboard';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { ErrorState } from '../../components/ui/ErrorState';
import { LoadingState } from '../../components/ui/LoadingState';
import { api, ApiError, getSessionToken } from '../../api/client';
import {
  applicationStatusLabel,
  applicationStatusTone,
  friendlyApiError,
  screeningCheckLabel,
} from '../../lib/application-status';
import { isValidApplicationId } from '../../lib/application-routes';

type Detail = Awaited<ReturnType<typeof api.brokerApplicationDetail>>;

/** Broker application detail — `/broker/applicants/:applicationId`. */
export function BrokerApplicantDetailPage() {
  const params = useParams<{ applicationId: string }>();
  const applicationId = params.applicationId;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidId = !isValidApplicationId(applicationId);

  async function refresh() {
    if (invalidId || !applicationId) {
      setLoading(false);
      setError('This application link is invalid.');
      return;
    }
    if (!getSessionToken()) {
      setLoading(false);
      setError('Sign in as a broker to view this application.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const d = await api.brokerApplicationDetail(applicationId);
      setDetail(d);
    } catch (err) {
      setError(friendlyApiError(err instanceof ApiError ? err.message : 'Could not load application.'));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [applicationId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      setNote('');
      await refresh();
    } catch (err) {
      setActionError(friendlyApiError(err instanceof ApiError ? err.message : 'Action failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BrokerShell>
      <Link href="/broker/applicants" className="text-sm text-dwel-gray-500 underline">
        ← Applicant feed
      </Link>

      {invalidId ? (
        <div className="mt-6">
          <ErrorState message="This application link is invalid." />
        </div>
      ) : null}

      {loading ? <div className="mt-6"><LoadingState /></div> : null}
      {error ? (
        <div className="mt-6">
          <ErrorState message={error} onRetry={() => void refresh()} />
        </div>
      ) : null}

      {detail ? (
        <>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{detail.renter_label}</h1>
              <p className="mt-1 text-sm text-dwel-gray-500">
                {detail.listing_label} · {detail.provider_name}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone={applicationStatusTone(detail.status)}>
                  {applicationStatusLabel(detail.status)}
                </Badge>
                {detail.screening_status !== 'none' ? (
                  <Badge tone="blue">{applicationStatusLabel(detail.screening_status)}</Badge>
                ) : null}
              </div>
            </div>
            <Link href={`/broker/listings/${detail.listing_id}`}>
              <Button variant="secondary" className="!px-4 !py-2 text-sm">
                View listing
              </Button>
            </Link>
          </div>

          <Card className="mt-4 border-l-4 border-dwel-blue bg-[#f8fbff] p-4 text-sm">
            Final approve or decline stays with the Home Provider. Your notes and recommendations
            help them decide.
          </Card>

          {actionError ? <p className="mt-4 text-sm text-dwel-red">{actionError}</p> : null}

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="font-semibold">Application overview</h2>
              <p className="mt-2 text-sm text-dwel-gray-600">
                Status: <strong>{applicationStatusLabel(detail.status)}</strong>
              </p>
              <p className="mt-1 text-sm text-dwel-gray-600">
                Screening:{' '}
                <strong>
                  {detail.screening_status === 'none'
                    ? 'Not started'
                    : applicationStatusLabel(detail.screening_status)}
                </strong>
              </p>
            </Card>

            <Card className="p-5">
              <h2 className="font-semibold">Screening status</h2>
              <p className="mt-2 text-sm text-dwel-gray-600">
                {detail.screening_status === 'none'
                  ? 'No screening has been requested yet.'
                  : `Pipeline: ${screeningCheckLabel(detail.screening_status)}`}
              </p>
              {detail.can_request_screening ? (
                <Button
                  className="mt-4 !px-4 !py-2 text-sm"
                  disabled={busy}
                  onClick={() =>
                    void run(() => api.brokerRequestScreening(detail.application_id))
                  }
                >
                  Request screening
                </Button>
              ) : null}
            </Card>

            <Card className="p-5 lg:col-span-2">
              <h2 className="font-semibold">Broker notes</h2>
              {detail.notes.length === 0 ? (
                <p className="mt-2 text-sm text-dwel-gray-400">No notes yet.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm text-dwel-gray-600">
                  {detail.notes.map((n) => (
                    <li key={`${n.at}-${n.note.slice(0, 12)}`}>
                      {n.note}{' '}
                      <span className="text-xs text-dwel-gray-400">
                        · {new Date(n.at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a broker note"
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  className="!px-4 !py-2 text-sm"
                  disabled={busy || !note.trim()}
                  onClick={() =>
                    void run(() => api.brokerAddNote(detail.application_id, note.trim()))
                  }
                >
                  Add note
                </Button>
              </div>
            </Card>

            <Card className="p-5 lg:col-span-2">
              <h2 className="font-semibold">Broker recommendation</h2>
              <p className="mt-1 text-sm text-dwel-gray-500">
                Current:{' '}
                {detail.recommendation
                  ? detail.recommendation === 'approve'
                    ? 'Recommend approve'
                    : 'Recommend decline'
                  : 'None'}
                {detail.recommendation_at
                  ? ` · ${new Date(detail.recommendation_at).toLocaleString()}`
                  : ''}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  className="!px-4 !py-2 text-sm"
                  disabled={busy}
                  onClick={() =>
                    void run(() => api.brokerSetRecommendation(detail.application_id, 'approve'))
                  }
                >
                  Recommend approve
                </Button>
                <Button
                  variant="secondary"
                  className="!px-4 !py-2 text-sm"
                  disabled={busy}
                  onClick={() =>
                    void run(() => api.brokerSetRecommendation(detail.application_id, 'decline'))
                  }
                >
                  Recommend decline
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(() => api.brokerSetRecommendation(detail.application_id, null))
                  }
                >
                  Clear recommendation
                </Button>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </BrokerShell>
  );
}
