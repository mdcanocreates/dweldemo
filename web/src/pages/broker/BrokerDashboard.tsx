import { Link, Redirect, useLocation, useParams } from 'wouter';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { BrandMark } from '../../components/brand/BrandMark';
import { BrokerAckGate, type BrokerAckValues } from '../../components/broker/BrokerAckModal';
import { PreviewRoleSwitcher } from '../../components/layout/PreviewRoleSwitcher';
import { UiPreviewBanner } from '../../components/layout/UiPreviewBanner';
import { getPreviewRole } from '../../lib/internal-preview';
import { api, ApiError, getSessionToken } from '../../api/client';
import { BROKER_TERMS_VERSION } from '../../lib/demo-store';
import { useAuth } from '../../hooks/useAuth';
import { formatCents } from '../../lib/money';
import { brokerApplicantPath } from '../../lib/application-routes';
import {
  applicationStatusLabel,
  applicationStatusTone,
} from '../../lib/application-status';
import { isUiPreviewActive } from '../../lib/ui-preview';
import { previewInvite } from '../../lib/ui-preview-data';
import { isNetlifyDemoMode } from '../../lib/netlify-demo';
import {
  readDemoBrokerTermsAccepted,
  writeDemoBrokerTermsAccepted,
} from '../../lib/broker-terms-demo';
import {
  BrokerInviteModal,
  type BrokerInviteFormData,
} from '../../components/broker/BrokerInviteModal';
import { useEffect, useState, type ReactNode } from 'react';

const LOCAL_ACK_KEY = 'dwel.broker.terms.ack.v1';

function readLocalAck(): boolean {
  if (isNetlifyDemoMode() || isUiPreviewActive()) {
    return readDemoBrokerTermsAccepted(BROKER_TERMS_VERSION);
  }
  try {
    const raw = localStorage.getItem(LOCAL_ACK_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { terms_version?: string };
    return parsed.terms_version === BROKER_TERMS_VERSION;
  } catch {
    return false;
  }
}

function writeLocalAck(): void {
  if (isNetlifyDemoMode() || isUiPreviewActive()) {
    writeDemoBrokerTermsAccepted(BROKER_TERMS_VERSION);
    return;
  }
  localStorage.setItem(
    LOCAL_ACK_KEY,
    JSON.stringify({ terms_version: BROKER_TERMS_VERSION, accepted_at: new Date().toISOString() }),
  );
}

const NAV = [
  { href: '/broker/dashboard', label: 'Dashboard' },
  { href: '/broker/providers', label: 'Providers' },
  { href: '/broker/listings', label: 'Listings' },
  { href: '/broker/applicants', label: 'Applicants' },
  { href: '/broker/screenings', label: 'Screenings' },
  { href: '/broker/invitations', label: 'Invitations' },
  { href: '/broker/settings', label: 'Settings' },
];

export function BrokerShell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  return (
    <div className="min-h-screen bg-dwel-gray-100">
      <UiPreviewBanner />
      <header className="sticky top-0 z-40 border-b border-dwel-gray-200 bg-dwel-black text-dwel-white">
        <div className="mx-auto flex max-w-[1098px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <BrandMark href="/" tone="light" />
            <p className="mt-0.5 text-xs text-dwel-gray-400">Dwel Partner · Broker workspace</p>
          </div>
          <div className="flex items-center gap-3">
            <PreviewRoleSwitcher tone="dark" />
            <nav className="flex gap-3 overflow-x-auto text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    loc.startsWith(item.href)
                      ? 'whitespace-nowrap font-semibold text-dwel-mint'
                      : 'whitespace-nowrap text-dwel-gray-300 hover:text-white'
                  }
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1098px] px-4 py-6 sm:px-6 lg:px-12">{children}</main>
    </div>
  );
}

function useBrokerAckGate() {
  const netlifyDemo = isNetlifyDemoMode();
  const uiPreview = isUiPreviewActive();
  const internalPreview = getPreviewRole() === 'broker';
  const { logout } = useAuth();
  const [, setLocation] = useLocation();
  const [needsAck, setNeedsAck] = useState(() => {
    if (uiPreview) return false;
    return !readLocalAck();
  });
  const [checking, setChecking] = useState(!uiPreview);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    // Pure local UI inspection skips the legal modal entirely.
    if (uiPreview && !netlifyDemo) {
      setNeedsAck(false);
      setChecking(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        // Netlify demo + production both go through /v1/broker/terms.
        // Demo builds are served by offline adapters (localStorage), never AWS.
        const status = await api.getBrokerTerms();
        if (!cancelled) {
          setNeedsAck(!status.accepted);
          if (status.accepted) writeLocalAck();
        }
      } catch {
        if (!cancelled) setNeedsAck(!readLocalAck());
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uiPreview, netlifyDemo, internalPreview]);

  async function onAccepted(values: BrokerAckValues) {
    setAcceptError(null);
    setAccepting(true);
    try {
      const incomplete =
        !values.compensation_cap_ack ||
        !values.non_circumvention_ack ||
        !values.licensing_ack ||
        !values.platform_role_ack;
      if (incomplete) {
        setAcceptError('Check all acknowledgment boxes before continuing.');
        return;
      }

      if (uiPreview && !netlifyDemo) {
        writeLocalAck();
        setNeedsAck(false);
        return;
      }

      await api.acceptBrokerTerms({
        terms_version: BROKER_TERMS_VERSION,
        compensation_cap_ack: true,
        non_circumvention_ack: true,
        licensing_ack: true,
        platform_role_ack: true,
      });
      writeLocalAck();
      setNeedsAck(false);
    } catch (err) {
      setAcceptError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not save acknowledgments. Please try again.',
      );
    } finally {
      setAccepting(false);
    }
  }

  return {
    checking,
    needsAck,
    preview: uiPreview || internalPreview,
    demo: netlifyDemo,
    acceptError,
    accepting,
    onAccepted,
    onSignOut: () => {
      void logout().finally(() => setLocation('/'));
    },
  };
}

function withAck(gate: ReturnType<typeof useBrokerAckGate>, body: ReactNode) {
  if (gate.checking) {
    return (
      <BrokerShell>
        <p className="text-sm text-dwel-gray-500">Loading partner acknowledgments…</p>
      </BrokerShell>
    );
  }
  return (
    <BrokerAckGate
      needsAck={gate.needsAck}
      preview={gate.preview}
      demo={gate.demo}
      acceptError={gate.acceptError}
      accepting={gate.accepting}
      onAccepted={gate.onAccepted}
      onSignOut={gate.onSignOut}
    >
      <BrokerShell>{body}</BrokerShell>
    </BrokerAckGate>
  );
}

function useBrokerInviteModal() {
  const offlineFixtures = isUiPreviewActive() || isNetlifyDemoMode();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(data: BrokerInviteFormData) {
    setSubmitting(true);
    setError(null);
    try {
      if (offlineFixtures) {
        previewInvite(data.email, data.businessName, data.note || undefined);
        setOpen(false);
        setLocation('/broker/invitations');
      } else {
        setError(
          'Home Provider invite is not available in this environment yet. Demo builds support it offline.',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setSubmitting(false);
    }
  }

  return { open, setOpen, submitting, error, submit };
}

export function BrokerDashboardPage() {
  const gate = useBrokerAckGate();
  const invite = useBrokerInviteModal();
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.brokerPortfolio>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSessionToken()) return;
    void (async () => {
      try {
        setOverview(await api.brokerPortfolio());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load portfolio.');
      }
    })();
  }, []);

  return withAck(
    gate,
    <>
      <h1 className="text-3xl font-semibold">Broker dashboard</h1>
      {error && <p className="mt-3 text-sm text-dwel-red">{error}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="p-4">
          <p className="text-sm text-dwel-gray-500">Managed providers</p>
          <p className="mt-2 text-2xl font-semibold">{overview?.managed_providers ?? '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-dwel-gray-500">Listings</p>
          <p className="mt-2 text-2xl font-semibold">{overview?.listings ?? '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-dwel-gray-500">Open applicants</p>
          <p className="mt-2 text-2xl font-semibold">{overview?.open_applicants ?? '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-dwel-gray-500">Screenings</p>
          <p className="mt-2 text-2xl font-semibold">{overview?.screenings ?? '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-dwel-gray-500">Needs attention</p>
          <p className="mt-2 text-2xl font-semibold">
            {overview?.needs_attention.length ?? '—'}
          </p>
        </Card>
      </div>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Needs attention</h2>
        {!overview?.needs_attention.length ? (
          <Card className="mt-4 p-5 text-sm text-dwel-gray-500">
            Nothing needs attention right now. New renter interest and screening updates will appear
            here.
          </Card>
        ) : (
          <div className="mt-4 space-y-2">
            {overview.needs_attention.map((item) => (
              <Link key={item.id + item.kind} href={item.href}>
                <Card className="p-4 hover:border-dwel-mint">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="mt-1 text-xs text-dwel-gray-400">{item.kind.replace(/_/g, ' ')}</p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Card className="mt-8 p-5">
        <p className="font-semibold">Invite a Home Provider</p>
        <p className="mt-1 text-sm text-dwel-gray-500">
          Grow your managed portfolio. No broker fee in Phase 1.
        </p>
        <Button className="mt-3" onClick={() => invite.setOpen(true)}>
          Invite a Home Provider
        </Button>
      </Card>

      <BrokerInviteModal
        open={invite.open}
        onClose={() => invite.setOpen(false)}
        onSubmit={invite.submit}
        submitting={invite.submitting}
        error={invite.error}
      />
    </>,
  );
}

export function BrokerInvitePage() {
  return <Redirect to="/broker/invitations" />;
}

export function BrokerProvidersPage() {
  const gate = useBrokerAckGate();
  const [providers, setProviders] = useState<
    Awaited<ReturnType<typeof api.brokerProviders>>['providers']
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSessionToken()) return;
    void (async () => {
      try {
        const res = await api.brokerProviders();
        setProviders(res.providers);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load providers.');
      }
    })();
  }, []);

  return withAck(
    gate,
    <>
      <h1 className="text-2xl font-semibold">Managed Home Providers</h1>
      <p className="mt-1 text-sm text-dwel-gray-500">
        Only providers explicitly delegated to your brokerage.
      </p>
      {error && <p className="mt-3 text-sm text-dwel-red">{error}</p>}
      {!error && providers.length === 0 && (
        <Card className="mt-6 p-6 text-sm text-dwel-gray-500">
          No managed Home Providers yet.{' '}
          <Link href="/broker/invitations" className="font-semibold underline">
            Invite a Home Provider
          </Link>
        </Card>
      )}
      <div className="mt-6 space-y-3">
        {providers.map((p) => (
          <Link key={p.org_id} href={`/broker/providers/${p.org_id}`}>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4 hover:border-dwel-mint">
              <div>
                <p className="font-semibold">{p.display_name}</p>
                <p className="text-sm text-dwel-gray-500">{p.legal_name}</p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-dwel-gray-600">
                <span>{p.active_listings} listings</span>
                <span>{p.open_applications} open apps</span>
                <span>{p.screenings} screenings</span>
                <Badge tone="mint">{p.status}</Badge>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>,
  );
}

export function BrokerProviderDetailPage() {
  const params = useParams<{ id: string }>();
  const providerOrgId = params.id ?? '';
  const [tab, setTab] = useState<'overview' | 'listings' | 'applicants' | 'screenings'>('overview');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.brokerProviderDetail>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!providerOrgId || !getSessionToken()) return;
    void (async () => {
      try {
        setData(await api.brokerProviderDetail(providerOrgId));
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Provider unavailable.');
        setData(null);
      }
    })();
  }, [providerOrgId]);

  return (
    <BrokerShell>
      <p className="mb-3 text-sm">
        <Link href="/broker/providers" className="font-semibold underline">
          ← Providers
        </Link>
      </p>
      {error && <p className="text-sm text-dwel-red">{error}</p>}
      {data && (
        <>
          <h1 className="text-2xl font-semibold">{data.provider.display_name}</h1>
          <p className="mt-1 text-sm text-dwel-gray-500">{data.provider.legal_name}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            {(
              [
                ['overview', 'Overview'],
                ['listings', 'Listings'],
                ['applicants', 'Applicants'],
                ['screenings', 'Screenings'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-full px-3 py-1.5 font-medium ${
                  tab === id ? 'bg-dwel-mint text-dwel-black' : 'bg-dwel-white border border-dwel-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <Card className="p-4">
                <p className="text-sm text-dwel-gray-500">Active listings</p>
                <p className="mt-2 text-2xl font-semibold">{data.provider.active_listings}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-dwel-gray-500">Open applications</p>
                <p className="mt-2 text-2xl font-semibold">{data.provider.open_applications}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-dwel-gray-500">Screenings</p>
                <p className="mt-2 text-2xl font-semibold">{data.provider.screenings}</p>
              </Card>
            </div>
          )}

          {tab === 'listings' && (
            <BrokerListingRows
              listings={data.listings as Awaited<ReturnType<typeof api.brokerPortfolioListings>>['listings']}
            />
          )}

          {(tab === 'applicants' || tab === 'screenings') && (
            <BrokerApplicantRows
              applicants={
                (data.applicants as Awaited<
                  ReturnType<typeof api.brokerPortfolioApplicants>
                >['applicants']).filter((a) =>
                  tab === 'screenings' ? a.screening_status !== 'none' : true,
                )
              }
            />
          )}
        </>
      )}
    </BrokerShell>
  );
}

function BrokerListingRows({
  listings,
}: {
  listings: Awaited<ReturnType<typeof api.brokerPortfolioListings>>['listings'];
}) {
  if (!listings.length) {
    return (
      <Card className="mt-6 p-6 text-sm text-dwel-gray-500">
        No delegated listings yet.
      </Card>
    );
  }
  return (
    <div className="mt-6 space-y-3">
      {listings.map((l) => (
        <Card key={l.id} className="overflow-hidden p-0">
          <div className="flex">
            <div className="h-24 w-28 shrink-0 bg-dwel-gray-200">
              {l.photo_url ? (
                <img src={l.photo_url} alt={l.line1 || 'Listing'} className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="flex flex-1 flex-wrap items-start justify-between gap-2 p-4">
              <div>
                <p className="font-semibold">{l.line1 || 'Listing'}</p>
                <p className="text-sm text-dwel-gray-500">
                  {l.provider_name} · {[l.city, l.state].filter(Boolean).join(', ')} ·{' '}
                  {formatCents(l.rent_amount_cents)}/mo
                </p>
                <p className="mt-1 text-xs text-dwel-gray-400">
                  {l.applicant_count} interest · {l.screening_count} screening
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge tone={l.status === 'active' ? 'mint' : 'amber'}>{l.status}</Badge>
                <Link href={`/broker/listings/${l.id}`} className="text-sm font-semibold underline">
                  Open
                </Link>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function BrokerApplicantRows({
  applicants,
  onChanged,
}: {
  applicants: Awaited<ReturnType<typeof api.brokerPortfolioApplicants>>['applicants'];
  onChanged?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function requestScreening(applicationId: string) {
    setBusyId(applicationId);
    setActionError(null);
    try {
      await api.brokerRequestScreening(applicationId);
      onChanged?.();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  if (!applicants.length) {
    return (
      <Card className="mt-6 p-6 text-sm text-dwel-gray-500">
        No applicants yet. Renter interest will appear here when someone expresses interest in a
        managed listing.
      </Card>
    );
  }
  return (
    <div className="mt-6 space-y-3">
      {actionError ? <p className="text-sm text-dwel-red">{actionError}</p> : null}
      {applicants.map((a) => (
        <Card key={a.application_id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{a.renter_label}</p>
              <p className="text-sm text-dwel-gray-500">
                {a.listing_label} · {a.provider_name}
              </p>
              <p className="mt-1 text-xs text-dwel-gray-400">
                Screening:{' '}
                {a.screening_status === 'none'
                  ? '—'
                  : applicationStatusLabel(a.screening_status)}
              </p>
            </div>
            <Badge tone={applicationStatusTone(a.status)}>
              {applicationStatusLabel(a.status)}
            </Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {brokerApplicantPath(a.application_id) ? (
              <Link href={brokerApplicantPath(a.application_id)!}>
                <Button variant="secondary" className="!px-4 !py-2 text-sm">
                  View
                </Button>
              </Link>
            ) : null}
            {['draft', 'awaiting_landlord_interest', 'submitted', 'prescreen', 'interested'].includes(
              a.status,
            ) && (
              <Button
                className="!px-4 !py-2 text-sm"
                disabled={busyId === a.application_id}
                onClick={() => void requestScreening(a.application_id)}
              >
                Request screening
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function BrokerListingsPage() {
  const gate = useBrokerAckGate();
  const [listings, setListings] = useState<
    Awaited<ReturnType<typeof api.brokerPortfolioListings>>['listings']
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSessionToken()) return;
    void (async () => {
      try {
        const res = await api.brokerPortfolioListings();
        setListings(res.listings);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load listings.');
      }
    })();
  }, []);

  return withAck(
    gate,
    <>
      <h1 className="text-2xl font-semibold">Portfolio listings</h1>
      {error && <p className="mt-3 text-sm text-dwel-red">{error}</p>}
      <BrokerListingRows listings={listings} />
    </>,
  );
}

export function BrokerApplicantsPage() {
  const gate = useBrokerAckGate();
  const [applicants, setApplicants] = useState<
    Awaited<ReturnType<typeof api.brokerPortfolioApplicants>>['applicants']
  >([]);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!getSessionToken()) return;
    try {
      const res = await api.brokerPortfolioApplicants();
      setApplicants(res.applicants);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load applicants.');
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  return withAck(
    gate,
    <>
      <h1 className="text-2xl font-semibold">Applicant feed</h1>
      <p className="mt-1 text-sm text-dwel-gray-500">
        Interest across delegated Home Provider listings.
      </p>
      {error && <p className="mt-3 text-sm text-dwel-red">{error}</p>}
      <BrokerApplicantRows applicants={applicants} onChanged={() => void reload()} />
    </>,
  );
}

export function BrokerScreeningsPage() {
  const gate = useBrokerAckGate();
  const [applicants, setApplicants] = useState<
    Awaited<ReturnType<typeof api.brokerPortfolioApplicants>>['applicants']
  >([]);

  useEffect(() => {
    if (!getSessionToken()) return;
    void (async () => {
      try {
        const res = await api.brokerPortfolioApplicants();
        setApplicants(res.applicants.filter((a) => a.screening_status !== 'none'));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  return withAck(
    gate,
    <>
      <h1 className="text-2xl font-semibold">Screenings</h1>
      <p className="mt-1 text-sm text-dwel-gray-500">
        Screening pipeline for delegated applications.
      </p>
      <BrokerApplicantRows applicants={applicants} />
    </>,
  );
}
