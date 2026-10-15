import { Link, useLocation } from 'wouter';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import {
  isUiPreviewAllowed,
  startUiPreview,
  stopUiPreview,
  uiPreviewHomeForRole,
  type UiPreviewRole,
} from '../../lib/ui-preview';
import { resetUiPreviewUniverse } from '../../lib/ui-preview-data';

const LINKS: Array<{ role: UiPreviewRole; href: string; label: string }> = [
  { role: 'renter', href: '/', label: 'Public landing' },
  { role: 'renter', href: '/search', label: 'Browse homes' },
  { role: 'renter', href: '/listing/lst_atx_oak', label: 'Listing detail' },
  { role: 'renter', href: '/saved', label: 'Saved' },
  { role: 'renter', href: '/home', label: 'Renter home' },
  { role: 'renter', href: '/applications', label: 'Applications' },
  { role: 'renter', href: '/screening', label: 'Screening center' },
  { role: 'renter', href: '/support', label: 'Support' },
  { role: 'renter', href: '/profile', label: 'Profile' },
  { role: 'renter', href: '/renter/settings', label: 'Renter settings' },
  { role: 'landlord', href: '/dashboard', label: 'HP Dashboard' },
  { role: 'landlord', href: '/listings', label: 'HP Listings' },
  { role: 'landlord', href: '/listings/new', label: 'Create listing' },
  { role: 'landlord', href: '/landlord/listings/ui-lst-active', label: 'Listing detail' },
  { role: 'landlord', href: '/listings/applicants', label: 'Applicants' },
  { role: 'landlord', href: '/landlord/applicants/ui-app-interested', label: 'Pre-qual applicant' },
  { role: 'landlord', href: '/landlord/screenings', label: 'Screenings' },
  { role: 'landlord', href: '/landlord/leases', label: 'Leases' },
  { role: 'landlord', href: '/landlord/billing', label: 'Billing' },
  { role: 'landlord', href: '/landlord/activity', label: 'Activity' },
  { role: 'landlord', href: '/settings', label: 'HP Settings' },
  { role: 'broker', href: '/broker/dashboard', label: 'Broker dashboard' },
  { role: 'broker', href: '/broker/providers', label: 'Providers' },
  { role: 'broker', href: '/broker/listings', label: 'Broker listings' },
  { role: 'broker', href: '/broker/listings/ui-lst-active', label: 'Broker listing detail' },
  { role: 'broker', href: '/broker/applicants', label: 'Applicants' },
  { role: 'broker', href: '/broker/screenings', label: 'Screenings' },
  { role: 'broker', href: '/broker/invitations', label: 'Invitations' },
  { role: 'landlord', href: '/landlord/applicants/ui-app-complete', label: 'Applicant detail' },
  { role: 'broker', href: '/broker/settings', label: 'Broker settings' },
];

export function UiPreviewPage() {
  const [, setLocation] = useLocation();

  if (!isUiPreviewAllowed()) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Card className="p-6">
          <h1 className="text-xl font-semibold">UI preview unavailable</h1>
          <p className="mt-2 text-sm text-dwel-muted">
            Local UI inspection is disabled outside development builds. Production auth and RBAC
            remain enforced.
          </p>
          <Link href="/" className="mt-4 inline-block text-sm font-semibold underline">
            Back to Dwel
          </Link>
        </Card>
      </div>
    );
  }

  function enter(role: UiPreviewRole, href?: string) {
    resetUiPreviewUniverse();
    startUiPreview(role);
    setLocation(href ?? uiPreviewHomeForRole(role));
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f4fbf7_0%,#fff_40%)] px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-dwel-success">
            Local development only
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">UI inspection mode</h1>
          <p className="mt-2 max-w-2xl text-sm text-dwel-muted">
            Review real production React portals without magic links. Uses in-memory fictional data
            and preview adapters. Does not create production sessions or call live payment /
            screening / email APIs.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {(['renter', 'landlord', 'broker'] as UiPreviewRole[]).map((role) => (
            <Card key={role} className="p-4">
              <h2 className="font-semibold capitalize">
                {role === 'landlord' ? 'Home Provider' : role}
              </h2>
              <p className="mt-1 text-xs text-dwel-muted">
                Enter the workspace with a synthetic preview identity.
              </p>
              <Button className="mt-4 w-full" onClick={() => enter(role)}>
                Open {role === 'landlord' ? 'Home Provider' : role}
              </Button>
            </Card>
          ))}
        </div>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Deep links</h2>
            <Button
              variant="secondary"
              onClick={() => {
                stopUiPreview();
                resetUiPreviewUniverse();
              }}
            >
              Reset / exit preview
            </Button>
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {LINKS.map((item) => (
              <li key={item.href + item.label}>
                <button
                  type="button"
                  className="w-full rounded-[10px] border border-dwel-line bg-dwel-surface px-3 py-2 text-left text-sm hover:border-dwel-gray-400"
                  onClick={() => enter(item.role, item.href)}
                >
                  <span className="font-semibold">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-dwel-muted">
                    {item.role} · #{item.href}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <p className="text-xs text-dwel-muted">
          Authenticated internal preview for allowlisted emails remains at{' '}
          <Link href="/internal/preview" className="underline">
            #/internal/preview
          </Link>{' '}
          and still requires a real sign-in.
        </p>
      </div>
    </div>
  );
}
