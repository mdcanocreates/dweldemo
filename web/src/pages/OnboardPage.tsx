import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorState, Shell } from '../components/Shell';

/** /onboard retired — G-0 lives in homepage hero chat. */
export function OnboardPage() {
  const [params] = useSearchParams();
  const returnTo = params.get('return');
  const qs = returnTo ? `?return=${encodeURIComponent(returnTo)}` : '';
  return <Navigate to={`/${qs}`} replace />;
}

export function ScreeningChoicePage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [feeCents, setFeeCents] = useState(2000);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [completedAt, setCompletedAt] = useState('');
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/?need_profile=1', { replace: true });
      return;
    }
    void api.screeningChoice().then((data) => {
      setFeeCents(data.path2_fee.amount_cents);
      if (data.report?.fresh) navigate('/listings', { replace: true });
    });
  }, [user, loading, navigate]);

  async function uploadPath1(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!completedAt || !fileName) throw new Error('Completion date and file are required');
      await api.uploadNyReport({
        completed_at: new Date(completedAt).toISOString(),
        original_filename: fileName,
        content_type: 'application/pdf',
        storage_key: `dev-upload:${fileName}`,
      });
      navigate('/listings');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <p className="section-eyebrow">New York compliance</p>
      <h1 className="section-title">Choose your screening path</h1>
      <p style={{ color: 'hsl(var(--muted-foreground))', maxWidth: '40rem' }}>
        NY applicants need a valid report (completed within 30 days) before marking interest.
      </p>
      {error && <ErrorState title="Could not continue">{error}</ErrorState>}

      <div style={{ display: 'grid', gap: '1rem', marginTop: '1.5rem', maxWidth: '40rem' }}>
        <section className="card" style={{ padding: '1.25rem' }}>
          <h2 className="font-display" style={{ fontSize: '1.35rem' }}>
            Path 1 — Upload your own report
          </h2>
          <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
            PDF or image. Completion date must be within 30 days of upload.
          </p>
          <form onSubmit={uploadPath1}>
            <div className="field">
              <label htmlFor="completed_at">Completion date</label>
              <input
                id="completed_at"
                type="date"
                required
                value={completedAt}
                onChange={(e) => setCompletedAt(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="report_file">Report file</label>
              <input
                id="report_file"
                type="file"
                accept=".pdf,image/*"
                required
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Upload report
            </button>
          </form>
        </section>

        <section className="card" style={{ padding: '1.25rem' }}>
          <h2 className="font-display" style={{ fontSize: '1.35rem' }}>
            Path 2 — Purchase through RBIT
          </h2>
          <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
            NY-capped fee ${(feeCents / 100).toFixed(2)}. Path 2 compliance is interpretive, pending
            legal review.
          </p>
          <button
            type="button"
            className="btn btn-dark"
            onClick={() => navigate('/applications/new/consent?ny_path2=1')}
          >
            Continue to payment
          </button>
        </section>
      </div>
    </Shell>
  );
}
