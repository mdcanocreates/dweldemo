import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { BrokerShell } from './BrokerDashboard';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { useAuth } from '../../hooks/useAuth';
import { isUiPreviewActive } from '../../lib/ui-preview';
import { getUiPreviewUniverse } from '../../lib/ui-preview-data';
import {
  getPreviewBrokerSettings,
  savePreviewBrokerSettings,
  type PreviewBrokerSettings,
} from '../../lib/ui-preview-settings';

type Section =
  | 'business'
  | 'licensing'
  | 'contact'
  | 'notifications'
  | 'security'
  | 'providers'
  | 'invitations'
  | 'terms';

const NAV: { id: Section; label: string }[] = [
  { id: 'business', label: 'Business profile' },
  { id: 'licensing', label: 'Licensing' },
  { id: 'contact', label: 'Primary contact' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'security', label: 'Security' },
  { id: 'providers', label: 'Provider relationships' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'terms', label: 'Accepted agreement' },
];

/** Full Broker settings — sectioned, preview-persisted where API is missing. */
export function BrokerSettingsPage() {
  const { user } = useAuth();
  const preview = isUiPreviewActive();
  const [section, setSection] = useState<Section>('business');
  const [settings, setSettings] = useState<PreviewBrokerSettings>(() =>
    getPreviewBrokerSettings(user),
  );
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const invitations = preview ? getUiPreviewUniverse().invitations : [];

  useEffect(() => {
    setSettings(getPreviewBrokerSettings(user));
  }, [user, preview]);

  function persist(next: PreviewBrokerSettings, message: string) {
    if (!preview) {
      setError('Broker profile API is not available yet. Changes are not saved.');
      setOk(null);
      return;
    }
    setError(null);
    const saved = savePreviewBrokerSettings(next);
    setSettings(getPreviewBrokerSettings(user));
    setOk(message);
    void saved;
  }

  return (
    <BrokerShell>
      <h1 className="text-2xl font-semibold">Broker settings</h1>
      <p className="mt-1 text-sm text-dwel-muted">
        Business profile, licensing, notifications, and provider relationships.
        {preview ? ' Preview changes stay in this session only.' : ''}
      </p>
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
          {section === 'business' && (
            <>
              <h2 className="text-xl font-semibold">Business profile</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['display_name', 'Display name'],
                    ['legal_name', 'Legal name'],
                    ['website', 'Website'],
                    ['phone', 'Phone'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block text-sm">
                    <span className="font-medium">{label}</span>
                    <input
                      className="mt-1 w-full rounded-[10px] border border-dwel-line px-3 py-2"
                      value={settings.business[key]}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          business: { ...s.business, [key]: e.target.value },
                        }))
                      }
                      disabled={!preview}
                    />
                  </label>
                ))}
                <label className="block text-sm sm:col-span-2">
                  <span className="font-medium">Business address</span>
                  <input
                    className="mt-1 w-full rounded-[10px] border border-dwel-line px-3 py-2"
                    value={settings.business.business_address}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        business: { ...s.business, business_address: e.target.value },
                      }))
                    }
                    disabled={!preview}
                  />
                </label>
              </div>
              {preview ? (
                <Button
                  className="min-h-11"
                  onClick={() =>
                    persist(settings, 'Business profile saved (preview). Reloaded from adapter.')
                  }
                >
                  Save business profile
                </Button>
              ) : (
                <p className="text-sm text-dwel-muted">Profile API not available.</p>
              )}
            </>
          )}

          {section === 'licensing' && (
            <>
              <h2 className="text-xl font-semibold">Licensing / verification</h2>
              <p className="text-sm text-dwel-muted">
                License edits may require verification review. Status is not fabricated as approved
                when pending.
              </p>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-dwel-muted">Verification</dt>
                  <dd className="font-semibold capitalize">
                    {settings.licensing.verification_status.replace('_', ' ')}
                  </dd>
                </div>
              </dl>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium">License number</span>
                  <input
                    className="mt-1 w-full rounded-[10px] border border-dwel-line px-3 py-2"
                    value={settings.licensing.license_number}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        licensing: {
                          ...s.licensing,
                          license_number: e.target.value,
                          verification_status: 'pending_review',
                        },
                      }))
                    }
                    disabled={!preview}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">State</span>
                  <input
                    className="mt-1 w-full rounded-[10px] border border-dwel-line px-3 py-2"
                    value={settings.licensing.license_state}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        licensing: {
                          ...s.licensing,
                          license_state: e.target.value,
                          verification_status: 'pending_review',
                        },
                      }))
                    }
                    disabled={!preview}
                  />
                </label>
              </div>
              {preview ? (
                <Button
                  className="min-h-11"
                  onClick={() =>
                    persist(settings, 'License submitted for review (preview). Not auto-verified.')
                  }
                >
                  Submit for review
                </Button>
              ) : (
                <p className="text-sm text-dwel-muted">Profile API not available.</p>
              )}
            </>
          )}

          {section === 'contact' && (
            <>
              <h2 className="text-xl font-semibold">Primary contact</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['name', 'Name'],
                    ['email', 'Email'],
                    ['phone', 'Phone'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block text-sm">
                    <span className="font-medium">{label}</span>
                    <input
                      className="mt-1 w-full rounded-[10px] border border-dwel-line px-3 py-2"
                      value={settings.contact[key]}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          contact: { ...s.contact, [key]: e.target.value },
                        }))
                      }
                      disabled={!preview}
                    />
                  </label>
                ))}
              </div>
              {preview ? (
                <Button
                  className="min-h-11"
                  onClick={() => persist(settings, 'Primary contact saved (preview).')}
                >
                  Save contact
                </Button>
              ) : (
                <p className="text-sm text-dwel-muted">Profile API not available.</p>
              )}
            </>
          )}

          {section === 'notifications' && (
            <>
              <h2 className="text-xl font-semibold">Notification preferences</h2>
              {(
                [
                  ['new_applicants', 'New applicants on delegated listings'],
                  ['screening_updates', 'Screening status updates'],
                  ['provider_invites', 'Invitation delivery / acceptance'],
                  ['billing_alerts', 'Billing alerts'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.notifications[key]}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        notifications: { ...s.notifications, [key]: e.target.checked },
                      }))
                    }
                    disabled={!preview}
                  />
                  {label}
                </label>
              ))}
              {preview ? (
                <Button
                  className="mt-4 min-h-11"
                  onClick={() => persist(settings, 'Notification preferences saved (preview).')}
                >
                  Save preferences
                </Button>
              ) : (
                <p className="mt-3 text-sm text-dwel-muted">Profile API not available.</p>
              )}
            </>
          )}

          {section === 'security' && (
            <>
              <h2 className="text-xl font-semibold">Security</h2>
              <p className="text-sm text-dwel-muted">
                Sign-in uses magic-link email
                {user?.email ? ` to ${user.email}` : ''}. MFA is{' '}
                <strong>{user?.mfa_enrolled ? 'enrolled' : 'not enabled'}</strong> for this account.
              </p>
            </>
          )}

          {section === 'providers' && (
            <>
              <h2 className="text-xl font-semibold">Provider relationships</h2>
              <p className="text-sm text-dwel-muted">
                Brokers cannot grant themselves access. Home Providers authorize delegation.
              </p>
              {preview ? (
                <ul className="mt-3 space-y-2 text-sm">
                  <li className="rounded-[10px] border border-dwel-line px-3 py-2">
                    <strong>Preview Oaks LLC</strong>
                    <span className="ml-2 text-dwel-muted">· active</span>
                    <p className="mt-1 text-xs text-dwel-muted">
                      Permissions: view listings, view applicants, request screening, recommend
                      (HP decides)
                    </p>
                  </li>
                  <li className="rounded-[10px] border border-dwel-line px-3 py-2">
                    <strong>Invited Provider (pending)</strong>
                    <span className="ml-2 text-dwel-muted">· invited</span>
                    <p className="mt-1 text-xs text-dwel-muted">No listing access until accepted.</p>
                  </li>
                </ul>
              ) : (
                <p className="mt-2 text-sm text-dwel-muted">
                  Open Providers in the broker nav when signed in with a broker org.
                </p>
              )}
              <Link href="/broker/providers" className="inline-block text-sm font-semibold underline">
                View providers →
              </Link>
            </>
          )}

          {section === 'invitations' && (
            <>
              <h2 className="text-xl font-semibold">Invitations</h2>
              {!preview ? (
                <p className="text-sm text-dwel-muted">
                  Invitation lifecycle is available in local UI preview. Production invite API is not
                  wired for full CRUD yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {invitations.map((inv) => (
                    <li
                      key={inv.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-dwel-line px-3 py-2 text-sm"
                    >
                      <span>
                        {inv.business_name}
                        <span className="text-dwel-muted"> · {inv.email}</span>
                      </span>
                      <span className="font-semibold uppercase text-dwel-muted">{inv.status}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href="/broker/invitations"
                className="inline-block text-sm font-semibold underline"
              >
                Manage invitations →
              </Link>
            </>
          )}

          {section === 'terms' && (
            <>
              <h2 className="text-xl font-semibold">Accepted agreement</h2>
              {settings.terms.version && settings.terms.accepted_at ? (
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-dwel-muted">Version</dt>
                    <dd className="font-semibold">{settings.terms.version}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-dwel-muted">Accepted</dt>
                    <dd className="font-semibold">
                      {new Date(settings.terms.accepted_at).toLocaleString()}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-dwel-muted">
                  No acceptance record on file. Acceptance history is not fabricated.
                </p>
              )}
            </>
          )}
        </Card>
      </div>
    </BrokerShell>
  );
}
