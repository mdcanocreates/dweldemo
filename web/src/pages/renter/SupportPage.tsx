import { useEffect, useState } from 'react';
import { RenterShell } from '../../components/layout/RenterShell';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Input } from '../../components/ui/Input';
import { LoadingState } from '../../components/ui/LoadingState';
import { api, ApiError, getSessionToken } from '../../api/client';
import { friendlyApiError } from '../../lib/application-status';

const CATEGORIES = [
  { value: 'screening', label: 'Screening' },
  { value: 'payment', label: 'Payment' },
  { value: 'cashback', label: 'Cashback' },
  { value: 'listing_issue', label: 'Listing issue' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'account', label: 'Account' },
  { value: 'broker_relationship', label: 'Broker relationship' },
  { value: 'fraud', label: 'Fraud / suspicious activity' },
] as const;

type CaseRow = {
  id: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  created_at: string;
};

/** Renter support cases — `#/support`. */
export function SupportPage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['value']>('account');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function load() {
    if (!getSessionToken()) {
      setLoading(false);
      setError('Sign in to view support cases.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.listSupportCases();
      setCases(res.cases);
    } catch (err) {
      setError(
        friendlyApiError(err instanceof ApiError ? err.message : 'Could not load support cases.'),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setOk(null);
    if (!subject.trim() || !description.trim()) {
      setFormError('Subject and description are required.');
      return;
    }
    setBusy(true);
    try {
      await api.createSupportCase({
        category,
        subject: subject.trim(),
        description: description.trim(),
      });
      setSubject('');
      setDescription('');
      setOk('Support case submitted.');
      await load();
    } catch (err) {
      setFormError(
        friendlyApiError(err instanceof ApiError ? err.message : 'Could not create support case.'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <RenterShell workspace>
      <h1 className="text-[30px] font-semibold tracking-tight">Support</h1>
      <p className="mt-1 text-sm text-dwel-muted">
        Open a case for screening, payment, privacy, or account issues. This is not legal advice.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-[18px]">
          <h2 className="text-lg font-semibold">Create a case</h2>
          <form className="mt-4 space-y-3" onSubmit={(e) => void submit(e)}>
            <label className="block text-sm">
              <span className="font-medium">Category</span>
              <select
                className="mt-1 w-full rounded-[10px] border border-dwel-line px-3 py-2"
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as (typeof CATEGORIES)[number]['value'])
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Subject</span>
              <Input
                className="mt-1"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                required
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Description</span>
              <textarea
                className="mt-1 w-full rounded-[10px] border border-dwel-line px-3 py-2 text-sm"
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
                required
              />
            </label>
            {formError ? <p className="text-sm text-dwel-red">{formError}</p> : null}
            {ok ? <p className="text-sm text-dwel-success">{ok}</p> : null}
            <Button type="submit" disabled={busy}>
              {busy ? 'Submitting…' : 'Submit case'}
            </Button>
          </form>
        </Card>

        <div>
          <h2 className="text-lg font-semibold">Your cases</h2>
          {loading ? (
            <div className="mt-4">
              <LoadingState />
            </div>
          ) : null}
          {error ? (
            <div className="mt-4">
              <ErrorState message={error} onRetry={() => void load()} />
            </div>
          ) : null}
          {!loading && !error && cases.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No cases yet" body="Submitted cases will appear here." />
            </div>
          ) : null}
          <ul className="mt-4 space-y-3">
            {cases.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{c.subject}</p>
                    <p className="mt-1 text-xs capitalize text-dwel-muted">
                      {c.category.replaceAll('_', ' ')} ·{' '}
                      {new Date(c.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge tone={c.status === 'open' ? 'amber' : 'gray'}>{c.status}</Badge>
                </div>
                <p className="mt-2 line-clamp-3 text-sm text-dwel-muted">{c.description}</p>
              </Card>
            ))}
          </ul>
        </div>
      </div>
    </RenterShell>
  );
}
