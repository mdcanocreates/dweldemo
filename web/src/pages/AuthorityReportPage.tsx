import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Shell } from '../components/Shell';

/** Operational counts. Cells under five households stay suppressed. */
export function AuthorityReportPage() {
  const [text, setText] = useState('Loading report…');

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const me = await api.authorityMe();
        const agencyId = me.agencies[0]?.agencyId;
        if (!agencyId) {
          if (!controller.signal.aborted) setText('No agency workspace is available for this account.');
          return;
        }
        const report = await api.authorityLeaseupReport(agencyId);
        if (controller.signal.aborted) return;
        setText(
          report.suppressed
            ? 'This count is hidden because fewer than five households are in the cell.'
            : `${report.numerator ?? 0} confirmed lease-ups. ${report.source}`,
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          setText(err instanceof ApiError ? err.message : 'The report could not be loaded.');
        }
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <Shell>
      <h1>Lease-up report</h1>
      <p role="status">{text}</p>
    </Shell>
  );
}
