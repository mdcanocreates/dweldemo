import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { RenterShell } from '../../components/layout/RenterShell';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { api, ApiError, getSessionToken } from '../../api/client';
import { getPreviewRole } from '../../lib/internal-preview';
import { isUiPreviewActive } from '../../lib/ui-preview';
import { isValidApplicationId, applicationPath } from '../../lib/application-routes';
import { friendlyApiError } from '../../lib/application-status';
import { formatCents } from '../../lib/money';
import { FCRA_CONSENT_COPY, FCRA_CONSENT_COPY_PREVIEW } from '../../types';
import { CheckrApplicantContinue } from '../../components/screening/CheckrApplicantContinue';

type AppRow = {
  application_id: string;
  status: string;
  listing_id: string | null;
  listing: {
    line1: string | null;
    city: string | null;
    state: string | null;
  } | null;
};

type Eligibility = {
  reusable: boolean;
  fee_cents: number;
  fee_cents_if_new: number;
  reason: string;
  message: string;
  expires_at: string | null;
};

function listingHref(listingId: string | null): string {
  return listingId ? `/listing/${listingId}` : '/search';
}

function ExitActions({
  listingId,
  applicationId,
}: {
  listingId: string | null;
  applicationId: string;
  showViewApplication?: boolean;
}) {
  const detail = applicationPath(applicationId);
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <Link href="/applications">
        <Button>Back to Applications</Button>
      </Link>
      {detail && (
        <Link href={detail}>
          <Button variant="secondary">View application</Button>
        </Link>
      )}
      {listingId && (
        <Link href={listingHref(listingId)} className="self-center text-sm font-semibold underline">
          View this home
        </Link>
      )}
    </div>
  );
}

/**
 * Screening consent — pay-consent. Reuses eligible prior report without double-charging.
 * Preview uses in-memory adapters (no Stripe/Certn/SES).
 */
export function ApplicationScreeningPage() {
  const params = useParams<{ id: string }>();
  const applicationId = params.id ?? '';
  const previewRenter = getPreviewRole() === 'renter' || isUiPreviewActive();
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [listingId, setListingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listingLabel, setListingLabel] = useState('this home');
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [reuseNotice, setReuseNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isValidApplicationId(applicationId)) return;
    if (!getSessionToken()) return;
    let cancelled = false;
    void (async () => {
      try {
        const mine = await api.listMyApplications();
        const row = mine.applications.find((a) => a.application_id === applicationId) as
          | AppRow
          | undefined;
        if (!cancelled && row) {
          setStatus(row.status);
          setListingId(row.listing_id);
          setListingLabel(
            [row.listing?.line1, row.listing?.city].filter(Boolean).join(', ') || 'this home',
          );
        } else if (!cancelled && !row) {
          setError('We could not find that application.');
        }
        try {
          const elig = await api.screeningEligibility(applicationId);
          if (!cancelled) setEligibility(elig);
        } catch {
          if (!cancelled) {
            setEligibility({
              reusable: false,
              fee_cents: 2900,
              fee_cents_if_new: 2900,
              reason: 'none',
              message: 'A screening fee applies unless you already have an eligible report.',
              expires_at: null,
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            friendlyApiError(err instanceof ApiError ? err.message : 'Could not load application.'),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  async function authorizeAndPay() {
    if (!isValidApplicationId(applicationId)) return;
    setBusy(true);
    setError(null);
    setReuseNotice(null);
    try {
      const res = await fetch(`/v1/applications/${applicationId}/pay-consent`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(getSessionToken() ? { Authorization: `Bearer ${getSessionToken()}` } : {}),
        },
        body: JSON.stringify({ agreed: true }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        status?: string;
        preview?: boolean;
        reused_existing_report?: boolean;
        fee_cents?: number;
      };
      if (!res.ok) {
        throw new ApiError(
          friendlyApiError(body.message || 'Consent/payment failed'),
          res.status,
          body.error,
        );
      }
      let next = body.status ?? 'screening_authorized';
      if (next === 'awaiting_consent') next = 'screening_authorized';
      setStatus(next);
      if (body.reused_existing_report) {
        setReuseNotice(
          'Authorization recorded. Your eligible screening was shared with this Home Provider — no additional fee and no new screening order.',
        );
        // Case B: share path must NOT call submit-screening / Certn.
        setStatus(body.status === 'screening_complete' ? 'screening_complete' : next);
        return;
      }

      if (previewRenter || body.preview) {
        setStatus('screening_authorized');
        return;
      }

      try {
        const submit = await fetch(`/v1/applications/${applicationId}/submit-screening`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(getSessionToken() ? { Authorization: `Bearer ${getSessionToken()}` } : {}),
          },
          body: '{}',
        });
        if (submit.ok) {
          const sbody = (await submit.json()) as { status?: string };
          setStatus(sbody.status ?? 'screening_running');
        } else if (submit.status === 503) {
          setStatus('awaiting_provider_configuration');
        }
      } catch {
        /* consent already recorded */
      }
    } catch (err) {
      setError(
        friendlyApiError(err instanceof ApiError ? err.message : 'Could not complete consent.'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!isValidApplicationId(applicationId)) {
    return (
      <RenterShell workspace>
        <Card className="mx-auto max-w-lg p-6">
          <h1 className="text-xl font-semibold">Application not found</h1>
          <p className="mt-2 text-sm text-dwel-muted">
            This screening link is missing a valid application. Return to your applications list and
            try again.
          </p>
          <Link href="/applications" className="mt-4 inline-block">
            <Button>Back to Applications</Button>
          </Link>
        </Card>
      </RenterShell>
    );
  }

  if (!getSessionToken()) {
    return (
      <RenterShell workspace>
        <Card className="p-6">
          <p>Sign in to continue screening.</p>
          <Link href={`/auth/login?returnTo=/applications/${applicationId}/screening`}>
            <Button className="mt-4">Sign in</Button>
          </Link>
        </Card>
      </RenterShell>
    );
  }

  if (status === 'screened' || status === 'screening_complete') {
    return (
      <RenterShell workspace>
        <Card className="mx-auto max-w-lg p-6">
          <h1 className="text-xl font-semibold">Your screening is complete</h1>
          <p className="mt-2 text-sm text-dwel-muted">
            Your Home Provider can now review the authorized results. Screening completion does not
            guarantee approval.
          </p>
          {reuseNotice && <p className="mt-3 text-sm text-dwel-success">{reuseNotice}</p>}
          <ExitActions listingId={listingId} applicationId={applicationId} />
        </Card>
      </RenterShell>
    );
  }

  if (status === 'screening_running' || status === 'screening_in_progress') {
    return (
      <RenterShell workspace>
        <Card className="mx-auto max-w-lg p-6">
          <h1 className="text-xl font-semibold">Your screening is in progress</h1>
          <p className="mt-2 text-sm text-dwel-muted">
            You&apos;ve completed your part. We&apos;ll update this application when screening
            finishes. You usually do not need to do anything else right now.
          </p>
          <CheckrApplicantContinue applicationId={applicationId} />
          <p className="mt-3 text-sm">
            <Link href="/fees" className="font-semibold underline">
              Need help with screening?
            </Link>
          </p>
          <ExitActions listingId={listingId} applicationId={applicationId} />
        </Card>
      </RenterShell>
    );
  }

  if (status === 'screening_authorized' || status === 'awaiting_provider_configuration') {
    return (
      <RenterShell workspace>
        <Card className="mx-auto max-w-lg p-6">
          <h1 className="text-xl font-semibold">Authorization recorded</h1>
          <p className="mt-2 text-sm text-dwel-muted">
            Your screening authorization has been saved for this Home Provider and listing.
            {reuseNotice ? ` ${reuseNotice}` : ''}
            {!previewRenter && status === 'awaiting_provider_configuration'
              ? ' Screening is temporarily unavailable in this environment — no new order was submitted.'
              : ' The Home Provider can proceed with review.'}
          </p>
          <ExitActions listingId={listingId} applicationId={applicationId} />
        </Card>
      </RenterShell>
    );
  }

  if (status === 'screening_error') {
    return (
      <RenterShell workspace>
        <Card className="mx-auto max-w-lg p-6">
          <h1 className="text-xl font-semibold">Screening could not be completed</h1>
          <p className="mt-2 text-sm text-dwel-muted">
            Something went wrong with the screening provider. Check whether a charge was recorded
            before trying again. Your application remains open.
          </p>
          <p className="mt-3 text-sm">
            <a href="mailto:info@rbitfinancial.com" className="font-semibold underline">
              Contact support about this screening
            </a>
          </p>
          <ExitActions listingId={listingId} applicationId={applicationId} />
        </Card>
      </RenterShell>
    );
  }

  const disclosure = previewRenter ? FCRA_CONSENT_COPY_PREVIEW : FCRA_CONSENT_COPY;
  const feeCents = eligibility?.fee_cents ?? 2900;
  const reusable = Boolean(eligibility?.reusable && feeCents === 0);
  /** Case B — reusable report; Case A — new paid screening. */
  const caseB = reusable;
  const payLabel = caseB
    ? 'Authorize share with this Home Provider'
    : `Authorize & pay ${formatCents(feeCents)}`;

  return (
    <RenterShell workspace>
      <div className="mx-auto max-w-2xl">
        <p className="mb-4 text-sm">
          <Link href="/applications" className="font-semibold underline">
            ← Back to Applications
          </Link>
          {listingId && (
            <>
              {' · '}
              <Link href={listingHref(listingId)} className="font-semibold underline">
                View this home
              </Link>
            </>
          )}
        </p>
        <h1 className="text-2xl font-semibold">
          {caseB
            ? 'Authorize share with this Home Provider'
            : 'Your Home Provider moved forward — screening needed'}
        </h1>
        <p className="mt-2 text-sm text-dwel-muted">
          Property: <strong className="text-dwel-ink">{listingLabel}</strong>.{' '}
          {caseB
            ? 'You already have an eligible screening report. Authorize this Home Provider to use it — no second charge.'
            : 'Review the disclosure, authorize this Home Provider, and pay the one-time screening fee.'}
        </p>

        <Card
          className={`mt-5 space-y-2 border-dwel-line p-4 text-sm ${
            caseB ? 'border-l-4 border-l-dwel-mint' : ''
          }`}
        >
          <p className="font-semibold text-dwel-ink">
            {caseB ? 'Case B — reusable report' : 'Case A — new screening'}
          </p>
          <p>
            <strong>What you&apos;ll authorize:</strong>{' '}
            {caseB
              ? 'sharing your eligible consumer screening report with this Home Provider for this application.'
              : 'a consumer screening report for evaluating this rental application.'}
          </p>
          <p>
            <strong>Who receives results:</strong> the requesting Home Provider (and a delegated
            broker, if any).
          </p>
          <p>
            <strong>Fee:</strong>{' '}
            {caseB
              ? 'No additional charge — authorize share only.'
              : `${formatCents(feeCents)} charged once for an eligible report.`}
          </p>
          {eligibility?.message && (
            <p className="text-dwel-muted">{eligibility.message}</p>
          )}
          <p className="text-xs text-dwel-muted">
            Consent is specific to this Home Provider and application. A reusable report does not
            automatically authorize every future provider. Screening fee credits after a completed
            lease are not automatic policy yet.
          </p>
        </Card>

        <div className="mt-6 max-h-[40vh] overflow-y-auto rounded-[10px] border border-dwel-line bg-dwel-surface2 p-5 text-sm whitespace-pre-wrap">
          {disclosure}
        </div>
        <label className="mt-6 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>
            I authorize Dwel to obtain a consumer report for evaluating my rental application for{' '}
            {listingLabel}.
          </span>
        </label>
        {error && <p className="mt-3 text-sm text-dwel-red">{error}</p>}
        <Button className="mt-6 min-h-11" disabled={!checked || busy} onClick={() => void authorizeAndPay()}>
          {busy ? 'Processing…' : payLabel}
        </Button>
        <p className="mt-3 text-sm">
          <a href="mailto:info@rbitfinancial.com" className="underline">
            Need help with screening?
          </a>
        </p>
      </div>
    </RenterShell>
  );
}

export function NyScreeningOptionsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const screeningHref = isValidApplicationId(id) ? `/applications/${id}/screening` : null;

  return (
    <RenterShell workspace>
      <Card className="mx-auto max-w-lg space-y-4 p-6">
        <p className="text-sm">
          <Link href="/applications" className="font-semibold underline">
            ← Back to Applications
          </Link>
        </p>
        <h1 className="text-xl font-semibold">New York screening options</h1>
        <p className="text-sm text-dwel-muted">
          New York law gives you the right to provide your own screening report.
        </p>
        <Button variant="secondary" className="w-full" disabled>
          Upload my own report (PDF)
        </Button>
        {screeningHref ? (
          <Link href={screeningHref}>
            <Button className="w-full">Purchase a screening report through Dwel</Button>
          </Link>
        ) : (
          <p className="text-sm text-dwel-red">Invalid application link.</p>
        )}
      </Card>
    </RenterShell>
  );
}
