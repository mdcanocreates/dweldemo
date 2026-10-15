import { useEffect, useState } from 'react';
import { api, getSessionToken } from '../../api/client';
import { Button } from '../ui/Button';

/**
 * Renter CTA for Checkr hosted applicant experience.
 * Never collects SSN inside Dwel — continues to Checkr when application_url exists.
 */
export function CheckrApplicantContinue({ applicationId }: { applicationId: string }) {
  const [checkr, setCheckr] = useState<{
    status: string;
    application_url?: string | null;
  } | null>(null);

  useEffect(() => {
    if (!getSessionToken()) return;
    let cancelled = false;
    void (async () => {
      try {
        const row = await api.getCheckrScreening(applicationId);
        if (!cancelled) {
          setCheckr({ status: row.status, application_url: row.application_url });
        }
      } catch {
        /* Checkr not enabled or no screening yet */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  if (!checkr || checkr.status === 'not_requested') return null;

  const label =
    checkr.status === 'awaiting_applicant'
      ? 'Continue screening with Checkr'
      : checkr.status === 'processing'
        ? 'Screening is processing'
        : checkr.status === 'completed'
          ? 'Screening complete'
          : checkr.status === 'failed'
            ? 'Screening could not finish'
            : `Screening: ${checkr.status}`;

  return (
    <div className="mt-4 rounded-[10px] border border-dwel-line bg-dwel-surface2 px-4 py-3">
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-1 text-xs text-dwel-muted">
        Identity verification runs on Checkr&apos;s secure applicant experience. Dwel never asks for
        your full Social Security number.
      </p>
      {checkr.application_url && checkr.status === 'awaiting_applicant' ? (
        <a
          href={checkr.application_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block"
        >
          <Button>Continue to Checkr</Button>
        </a>
      ) : null}
    </div>
  );
}
