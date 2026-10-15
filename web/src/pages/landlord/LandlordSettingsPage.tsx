import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { LandlordShell } from '../../components/layout/LandlordShell';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { LoadingState } from '../../components/ui/LoadingState';
import { api, ApiError, getSessionToken } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { friendlyApiError } from '../../lib/application-status';
import { isUiPreviewActive } from '../../lib/ui-preview';
import {
  getPreviewHpSettings,
  savePreviewHpSettings,
  type PreviewHpSettings,
} from '../../lib/ui-preview-settings';

type Section =
  | 'organization'
  | 'screening'
  | 'billing'
  | 'notifications'
  | 'security'
  | 'broker'
  | 'privacy';

const NAV: { id: Section; label: string }[] = [
  { id: 'organization', label: 'Organization' },
  { id: 'screening', label: 'Screening preferences' },
  { id: 'billing', label: 'Billing and payment' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'security', label: 'Security' },
  { id: 'broker', label: 'Broker relationship' },
  { id: 'privacy', label: 'Privacy and account' },
];

/** Full Home Provider settings — sectioned, save only when backed. */
export function LandlordSettingsPage() {
  const { user } = useAuth();
  const preview = isUiPreviewActive();
  const [section, setSection] = useState<Section>('organization');
  const [mode, setMode] = useState<'auto_screen' | 'manual_review'>('manual_review');
  const [listingCount, setListingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [org, setOrg] = useState({
    display_name: '',
    contact_name: '',
    contact_email: '',
    phone: '',
    business_address: '',
  });
  const [notes, setNotes] = useState<PreviewHpSettings['notifications']>({
    renter_interest: true,
    screening_complete: true,
    decision_required: true,
    billing_alerts: true,
    broker_changes: true,
  });
  const [brokerRel, setBrokerRel] = useState<PreviewHpSettings['broker']>({
    broker_name: null,
    status: 'none',
    permissions: [],
    since: null,
  });

  useEffect(() => {
    if (!getSessionToken() && !preview) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        if (preview) {
          const s = getPreviewHpSettings(user);
          setMode(s.screening_mode);
          setOrg(s.organization);
          setNotes(s.notifications);
          setBrokerRel(s.broker);
          setListingCount(4);
        } else {
          const [settings, listings] = await Promise.all([
            api.getLandlordSettings(),
            api.landlordListings(),
          ]);
          setMode(settings.screening_mode);
          setListingCount(listings.listings.length);
          setOrg({
            display_name: 'Home Provider organization',
            contact_name: [user?.given_name, user?.family_name].filter(Boolean).join(' '),
            contact_email: user?.email ?? '',
            phone: '',
            business_address: '',
          });
        }
      } catch (err) {
        setError(friendlyApiError(err instanceof ApiError ? err.message : 'Could not load settings.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [preview, user]);

  async function saveScreening() {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      if (preview) {
        savePreviewHpSettings({
          screening_mode: mode,
          organization: org,
          notifications: notes,
          broker: brokerRel,
        });
        setOk('Screening preference saved (preview).');
      } else {
        await api.putLandlordSettings(mode);
        setOk('Screening preference saved.');
      }
    } catch (err) {
      setError(friendlyApiError(err instanceof ApiError ? err.message : 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  function saveOrgPreview() {
    if (!preview) {
      setError(
        'Organization profile updates are not available from the API yet. Screening preference can still be saved.',
      );
      setOk(null);
      return;
    }
    if (!org.display_name.trim() || !org.contact_email.trim()) {
      setError('Display name and contact email are required.');
      return;
    }
    setError(null);
    savePreviewHpSettings({
      screening_mode: mode,
      organization: org,
      notifications: notes,
      broker: brokerRel,
    });
    setOk('Organization saved (preview). Reloaded from adapter.');
    const reloaded = getPreviewHpSettings(user);
    setOrg(reloaded.organization);
  }

  function saveNotificationsPreview() {
    if (!preview) {
      setError('Notification preference API is not available yet.');
      setOk(null);
      return;
    }
    setError(null);
    savePreviewHpSettings({
      screening_mode: mode,
      organization: org,
      notifications: notes,
      broker: brokerRel,
    });
    setOk('Notification preferences saved (preview).');
  }

  function revokeBroker() {
    if (!preview) {
      setError('Broker revocation API is not available yet.');
      return;
    }
    if (!window.confirm('Revoke broker access to your listings and applications?')) return;
    const next = {
      ...brokerRel,
      status: 'revoked' as const,
      permissions: [] as string[],
    };
    setBrokerRel(next);
    savePreviewHpSettings({
      screening_mode: mode,
      organization: org,
      notifications: notes,
      broker: next,
    });
    setOk('Broker access revoked (preview). Change audited in-memory.');
  }

  return (
    <LandlordShell>
      <h1 className="text-[32px] font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-dwel-muted">
        Account management for your Home Provider organization.
        {preview ? ' Preview changes stay in this session only.' : ''}
      </p>
      {loading ? (
        <div className="mt-6">
          <LoadingState />
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <ErrorState message={error} />
        </div>
      ) : null}
      {ok ? (
        <p className="mt-4 rounded-[12px] bg-dwel-mint-soft px-3 py-2 text-sm text-dwel-success">
          {ok}
        </p>
      ) : null}

      {!loading ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[240px_1fr]">
          <Card className="h-max p-2">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`mb-1 w-full rounded-[10px] px-3 py-2.5 text-left text-sm ${
                  section === item.id
                    ? 'bg-[#eaf0ff] font-extrabold text-dwel-blue'
                    : 'text-dwel-muted hover:bg-dwel-surface2'
                }`}
                onClick={() => {
                  setSection(item.id);
                  setOk(null);
                  setError(null);
                }}
              >
                {item.label}
              </button>
            ))}
          </Card>

          <Card className="space-y-5 p-[18px]">
            {section === 'organization' && (
              <>
                <h2 className="text-xl font-semibold">Organization</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ['display_name', 'Display name'],
                      ['contact_name', 'Contact name'],
                      ['contact_email', 'Contact email'],
                      ['phone', 'Phone'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="block text-sm sm:col-span-1">
                      <span className="font-medium">{label}</span>
                      <input
                        className="mt-1 w-full rounded-[10px] border border-dwel-line px-3 py-2"
                        value={org[key]}
                        onChange={(e) => setOrg((o) => ({ ...o, [key]: e.target.value }))}
                        disabled={!preview && key !== 'contact_email'}
                      />
                    </label>
                  ))}
                  <label className="block text-sm sm:col-span-2">
                    <span className="font-medium">Business address</span>
                    <input
                      className="mt-1 w-full rounded-[10px] border border-dwel-line px-3 py-2"
                      value={org.business_address}
                      onChange={(e) => setOrg((o) => ({ ...o, business_address: e.target.value }))}
                      disabled={!preview}
                    />
                  </label>
                </div>
                <p className="text-xs text-dwel-muted">
                  Active listings: <strong>{listingCount}</strong>. Legal entity verification is
                  separate from display edits.
                </p>
                {preview ? (
                  <Button className="min-h-11" onClick={saveOrgPreview}>
                    Save organization
                  </Button>
                ) : (
                  <p className="text-sm text-dwel-muted">
                    Organization profile is read-only here. Screening preference below can still be
                    saved.
                  </p>
                )}
              </>
            )}

            {section === 'screening' && (
              <>
                <h2 className="text-xl font-semibold">Screening preferences</h2>
                <label className="mt-2 flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="screening"
                    checked={mode === 'auto_screen'}
                    onChange={() => setMode('auto_screen')}
                  />
                  <span>
                    <strong>Automatic request</strong> when eligibility is met — still requires
                    renter consent, payment/reuse checks, and report eligibility. Does not bypass
                    authorization.
                  </span>
                </label>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="screening"
                    checked={mode === 'manual_review'}
                    onChange={() => setMode('manual_review')}
                  />
                  <span>
                    <strong>Manual review</strong> before requesting screening for each applicant.
                  </span>
                </label>
                <Button className="mt-4 min-h-11" disabled={saving} onClick={() => void saveScreening()}>
                  {saving ? 'Saving…' : 'Save screening preference'}
                </Button>
              </>
            )}

            {section === 'billing' && (
              <>
                <h2 className="text-xl font-semibold">Billing and payment</h2>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-dwel-muted">Payment method</dt>
                    <dd className="font-semibold">{preview ? 'Preview card on file' : 'Not linked'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-dwel-muted">Account standing</dt>
                    <dd className="font-semibold">Active</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-dwel-muted">Billing contact</dt>
                    <dd className="font-semibold">{org.contact_email || user?.email || '—'}</dd>
                  </div>
                </dl>
                <p className="text-sm text-dwel-muted">
                  No fake card save. Use billing when Stripe Connect / Billing is configured.
                </p>
                <Link href="/landlord/billing">
                  <Button variant="secondary">Open billing summary</Button>
                </Link>
              </>
            )}

            {section === 'notifications' && (
              <>
                <h2 className="text-xl font-semibold">Notifications</h2>
                {(
                  [
                    ['renter_interest', 'New renter interest'],
                    ['screening_complete', 'Screening complete'],
                    ['decision_required', 'Applicant decision required'],
                    ['billing_alerts', 'Billing alerts'],
                    ['broker_changes', 'Broker relationship changes'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="mt-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={notes[key]}
                      onChange={(e) => setNotes((n) => ({ ...n, [key]: e.target.checked }))}
                      disabled={!preview}
                    />
                    {label}
                  </label>
                ))}
                {preview ? (
                  <Button className="mt-4 min-h-11" onClick={saveNotificationsPreview}>
                    Save preferences
                  </Button>
                ) : (
                  <p className="mt-3 text-sm text-dwel-muted">
                    Notification preferences are read-only until a notifications API is available.
                  </p>
                )}
              </>
            )}

            {section === 'security' && (
              <>
                <h2 className="text-xl font-semibold">Security</h2>
                <p className="text-sm text-dwel-muted">
                  Sign-in uses magic-link email
                  {user?.email ? ` to ${user.email}` : ''}. MFA is{' '}
                  <strong>{user?.mfa_enrolled ? 'enrolled' : 'not enabled'}</strong> for this
                  account.
                </p>
              </>
            )}

            {section === 'broker' && (
              <>
                <h2 className="text-xl font-semibold">Broker relationship</h2>
                {brokerRel.status === 'none' || !brokerRel.broker_name ? (
                  <p className="text-sm text-dwel-muted">
                    No active broker delegation
                    {preview ? ' in this preview session' : ' on record'}.
                  </p>
                ) : (
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-dwel-muted">Broker</dt>
                      <dd className="font-semibold">{brokerRel.broker_name}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-dwel-muted">Status</dt>
                      <dd className="font-semibold capitalize">{brokerRel.status}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-dwel-muted">Since</dt>
                      <dd className="font-semibold">{brokerRel.since ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-dwel-muted">Permissions</dt>
                      <dd className="mt-1 font-semibold">
                        {brokerRel.permissions.length
                          ? brokerRel.permissions.join(', ')
                          : 'None'}
                      </dd>
                    </div>
                  </dl>
                )}
                {preview && brokerRel.status === 'active' ? (
                  <Button variant="destructive" className="mt-3" onClick={revokeBroker}>
                    Revoke broker access
                  </Button>
                ) : null}
              </>
            )}

            {section === 'privacy' && (
              <>
                <h2 className="text-xl font-semibold">Privacy and account</h2>
                <p className="text-sm text-dwel-muted">
                  Applicant contact stays masked until approval. Screening results go only to
                  authorized recipients. Account deletion for renters is handled in the renter
                  workspace; org offboarding requires support.
                </p>
                <a href="mailto:info@rbitfinancial.com" className="text-sm font-semibold underline">
                  Contact us about your organization data
                </a>
              </>
            )}
          </Card>
        </div>
      ) : null}
    </LandlordShell>
  );
}
