import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { BrokerShell } from './BrokerDashboard';
import {
  BrokerInviteModal,
  type BrokerInviteFormData,
} from '../../components/broker/BrokerInviteModal';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { api, ApiError } from '../../api/client';
import { friendlyApiError } from '../../lib/application-status';
import { isUiPreviewActive } from '../../lib/ui-preview';
import {
  getUiPreviewUniverse,
  previewCancelInvite,
  previewInvite,
  previewResendInvite,
  type PreviewInvitation,
  type PreviewInvitationStatus,
} from '../../lib/ui-preview-data';

type InvitationRow = {
  id: string;
  email: string;
  business_name: string;
  note?: string;
  status: string;
  sent_at: string;
  expires_at: string | null;
  provider_org_id?: string | null;
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'accepted':
      return 'Accepted';
    case 'expired':
      return 'Expired';
    case 'revoked':
    case 'cancelled':
      return 'Revoked';
    case 'delivery_failed':
      return 'Delivery failed';
    default:
      return status;
  }
}

function statusTone(status: string): 'mint' | 'amber' | 'gray' {
  if (status === 'accepted') return 'mint';
  if (status === 'pending') return 'amber';
  return 'gray';
}

function mapPreview(inv: PreviewInvitation): InvitationRow {
  return {
    id: inv.id,
    email: inv.email,
    business_name: inv.business_name,
    note: inv.note,
    status: inv.status,
    sent_at: inv.sent_at,
    expires_at: inv.expires_at,
    provider_org_id: inv.provider_org_id,
  };
}

export function BrokerInvitationsPage() {
  const preview = isUiPreviewActive();
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (preview) {
        setInvitations(getUiPreviewUniverse().invitations.map(mapPreview));
        return;
      }
      const res = await api.listBrokerInvitations();
      setInvitations(
        res.invitations.map((inv) => ({
          id: inv.id,
          email: inv.contact_email,
          business_name: inv.business_name || inv.contact_email,
          note: inv.note ?? undefined,
          status: inv.status,
          sent_at: inv.created_at,
          expires_at: inv.expires_at,
          provider_org_id: inv.provider_org_id,
        })),
      );
    } catch (err) {
      setError(
        friendlyApiError(err instanceof ApiError ? err.message : 'Could not load invitations.'),
      );
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, [preview]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleInvite(data: BrokerInviteFormData) {
    setSubmitting(true);
    setModalError(null);
    try {
      if (preview) {
        previewInvite(data.email, data.businessName, data.note || undefined);
        setModalOpen(false);
        await reload();
      } else {
        await api.createBrokerInvitation({
          contact_email: data.email,
          business_name: data.businessName,
          note: data.note || undefined,
        });
        setModalOpen(false);
        await reload();
      }
    } catch (err) {
      setModalError(
        friendlyApiError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Could not send invitation.'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelInvite(id: string) {
    setActionBusy(id);
    setError(null);
    try {
      if (preview) {
        previewCancelInvite(id);
      } else {
        await api.cancelBrokerInvitation(id);
      }
      await reload();
    } catch (err) {
      setError(
        friendlyApiError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Cancel failed.'),
      );
    } finally {
      setActionBusy(null);
    }
  }

  async function resendInvite(id: string) {
    if (!preview) {
      setError('Resend is available in preview only until the resend API ships.');
      return;
    }
    setActionBusy(id);
    setError(null);
    try {
      previewResendInvite(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resend failed.');
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <BrokerShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Invitations</h1>
          <p className="mt-1 text-sm text-dwel-gray-500">
            {preview
              ? 'Local preview — invitations stay in memory only (no email).'
              : 'Invite Home Providers to join your managed portfolio.'}
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>Invite a Home Provider</Button>
      </div>

      {error ? <p className="mt-4 text-sm text-dwel-red">{error}</p> : null}
      {loading ? <p className="mt-6 text-sm text-dwel-muted">Loading…</p> : null}

      {!loading && invitations.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No invitations yet"
            body="Invite a Home Provider to join your managed portfolio. They must approve the relationship before you can access their listings."
            action={<Button onClick={() => setModalOpen(true)}>Invite a Home Provider</Button>}
          />
        </div>
      ) : null}

      {!loading && invitations.length > 0 ? (
        <Card className="mt-6 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-dwel-gray-200 bg-dwel-gray-100/80 text-xs uppercase tracking-wide text-dwel-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Business / email</th>
                  <th className="px-4 py-3 font-semibold">Invited</th>
                  <th className="px-4 py-3 font-semibold">Expires</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dwel-gray-100">
                {invitations.map((inv) => (
                  <tr key={inv.id} className="bg-white hover:bg-dwel-gray-50/80">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-dwel-gray-900">{inv.business_name}</p>
                      <p className="text-dwel-gray-500">{inv.email}</p>
                      {inv.note ? (
                        <p
                          className="mt-1 max-w-xs truncate text-xs text-dwel-gray-400"
                          title={inv.note}
                        >
                          “{inv.note}”
                        </p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-dwel-gray-600">
                      {formatDate(inv.sent_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-dwel-gray-600">
                      {inv.expires_at ? formatDate(inv.expires_at) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(inv.status)}>
                        {statusLabel(inv.status as PreviewInvitationStatus)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {inv.status === 'pending' || inv.status === 'delivery_failed' ? (
                          <Button
                            variant="secondary"
                            className="!px-3 !py-1.5 text-xs"
                            disabled={actionBusy === inv.id}
                            onClick={() => void cancelInvite(inv.id)}
                          >
                            Cancel
                          </Button>
                        ) : null}
                        {preview &&
                        ['pending', 'expired', 'delivery_failed'].includes(inv.status) ? (
                          <Button
                            variant="secondary"
                            className="!px-3 !py-1.5 text-xs"
                            disabled={actionBusy === inv.id}
                            onClick={() => void resendInvite(inv.id)}
                          >
                            Resend
                          </Button>
                        ) : null}
                        {inv.status === 'accepted' && inv.provider_org_id ? (
                          <Link href={`/broker/providers/${inv.provider_org_id}`}>
                            <Button variant="secondary" className="!px-3 !py-1.5 text-xs">
                              View provider
                            </Button>
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <BrokerInviteModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setModalError(null);
        }}
        onSubmit={handleInvite}
        submitting={submitting}
        error={modalError}
      />
    </BrokerShell>
  );
}
