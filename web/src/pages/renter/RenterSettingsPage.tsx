import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { RenterShell } from '../../components/layout/RenterShell';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { friendlyApiError } from '../../lib/application-status';
import { formatCents } from '../../lib/money';
import { isUiPreviewActive } from '../../lib/ui-preview';

function CashbackStatusCard() {
  const [rows, setRows] = useState<
    Array<{ id: string; status: string; amount_cents: number | null; application_id: string }>
  >([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.getRenterCashback();
        if (cancelled) return;
        setNote(res.offer_version_note ?? null);
        setRows(
          res.eligibility.map((e) => ({
            id: e.id,
            status: e.status,
            amount_cents: e.amount_cents,
            application_id: e.application_id,
          })),
        );
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="p-[18px]">
      <h2 className="text-xl font-semibold">Cashback status</h2>
      <p className="mt-3 text-sm text-dwel-muted">
        {note ||
          'Status only. Funding is a pending business decision — not a payout promise.'}
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-dwel-muted">No cashback eligibility rows yet.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-2 rounded-[10px] bg-dwel-surface2 px-3 py-2">
              <span>
                {r.status}
                {r.amount_cents != null ? ` · ${formatCents(r.amount_cents)}` : ''}
              </span>
              <Link href={`/applications/${r.application_id}`} className="font-semibold underline">
                View
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Real supported controls only — no fake toggles. */
export function RenterSettingsPage() {
  const { user, logout } = useAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<null | { id: string; status: string; created_at: string }>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.getAccountDeletionStatus();
        if (!cancelled) setStatus(res.request);
      } catch {
        /* endpoint may be unavailable until migration */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitDeletion() {
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestAccountDeletion({ confirm: true });
      setMessage(res.message);
      setStatus({
        id: res.request_id,
        status: res.status,
        created_at: new Date().toISOString(),
      });
      setDeleteOpen(false);
    } catch (err) {
      setError(
        friendlyApiError(err instanceof ApiError ? err.message : 'Could not submit deletion request.'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <RenterShell workspace>
      <h1 className="text-[30px] font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-dwel-muted">Account, privacy, security, and screening.</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-[18px]">
          <h2 className="text-xl font-semibold">Account</h2>
          <p className="mt-4 flex justify-between gap-3 text-sm">
            <span className="text-dwel-muted">Verified email</span>
            <strong className="text-right">{user?.email || '—'}</strong>
          </p>
          <p className="mt-2 flex justify-between gap-3 text-sm">
            <span className="text-dwel-muted">Name</span>
            <strong className="text-right">
              {[user?.given_name, user?.family_name].filter(Boolean).join(' ') || '—'}
            </strong>
          </p>
          <Link href="/profile" className="mt-4 inline-block">
            <Button variant="secondary" className="!py-2 text-sm">
              Edit profile
            </Button>
          </Link>
          <Button variant="secondary" className="mt-3 !py-2 text-sm" onClick={() => void logout()}>
            Sign out
          </Button>
        </Card>

        <Card className="p-[18px]">
          <h2 className="text-xl font-semibold">Privacy &amp; data</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-dwel-muted">
            <li>Account, preferences, saved homes, applications, and consent history</li>
            <li>Screening status shared only with authorized Home Providers</li>
            <li>Contact details masked until approval</li>
          </ul>
          <p className="mt-3 text-sm">
            <Link href="/privacy" className="font-semibold underline">
              Read privacy details
            </Link>
          </p>
          {status && (
            <p className="mt-3 rounded-[10px] bg-dwel-surface2 px-3 py-2 text-sm">
              Deletion request <strong>{status.status}</strong> · submitted{' '}
              {new Date(status.created_at).toLocaleDateString()}
            </p>
          )}
          {message && <p className="mt-2 text-sm text-dwel-success">{message}</p>}
          <Button
            variant="secondary"
            className="mt-4 !py-2 text-sm"
            onClick={() => {
              setDeleteOpen(true);
              setConfirmed(false);
              setError(null);
            }}
          >
            Request deletion of my Dwel account
          </Button>
        </Card>

        <Card className="p-[18px]">
          <h2 className="text-xl font-semibold">Security</h2>
          <p className="mt-3 text-sm text-dwel-muted">
            Sign-in uses magic links emailed to your verified address. MFA/passkeys are not enabled
            in this environment unless configured.
          </p>
        </Card>

        <Card className="p-[18px]">
          <h2 className="text-xl font-semibold">Screening</h2>
          <p className="mt-3 text-sm text-dwel-muted">
            View report status, consent, and authorization from your applications. Eligible reports
            may be reused without another fee when permitted — consent remains provider-specific.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/screening">
              <Button variant="secondary" className="!py-2 text-sm">
                Screening center
              </Button>
            </Link>
            <Link href="/applications">
              <Button variant="secondary" className="!py-2 text-sm">
                View applications
              </Button>
            </Link>
            <Link href="/support">
              <Button variant="secondary" className="!py-2 text-sm">
                Support
              </Button>
            </Link>
          </div>
        </Card>

        <CashbackStatusCard />
      </div>

      {deleteOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-title"
        >
          <Card className="w-full max-w-lg p-5">
            <h2 id="delete-title" className="text-lg font-semibold">
              Request deletion of my Dwel account
            </h2>
            <p className="mt-3 text-sm text-dwel-muted">
              This submits a tracked request. It does <strong className="text-dwel-ink">not</strong>{' '}
              instantly wipe your account.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-dwel-muted">
              <li>You may lose access to saved homes, profile editing, and open applications</li>
              <li>Pending Home Provider decisions may continue under retention rules</li>
              <li>
                Financial, screening, audit, and compliance records may be legally retained
              </li>
              <li>Screening fees are not automatically refunded from this flow</li>
            </ul>
            {isUiPreviewActive() && (
              <p className="mt-3 text-xs font-semibold text-dwel-success">
                Local preview — request stays in memory only.
              </p>
            )}
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>I understand this request and want to proceed.</span>
            </label>
            {error && <p className="mt-2 text-sm text-dwel-red">{error}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button disabled={!confirmed || busy} onClick={() => void submitDeletion()}>
                {busy ? 'Submitting…' : 'Submit deletion request'}
              </Button>
              <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}
    </RenterShell>
  );
}
