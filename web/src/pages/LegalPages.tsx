import { Link } from 'wouter';
import { RenterShell } from '../components/layout/RenterShell';
import { Card } from '../components/ui/Card';

export function TermsPage() {
  return (
    <RenterShell workspace={false}>
      <Card className="p-6">
        <h1 className="text-2xl font-semibold">Terms of use</h1>
        <p className="mt-4 text-sm leading-relaxed text-dwel-muted">
          Dwel is a product of RBIT Financial Inc. By using Dwel you agree to use the service
          lawfully and in accordance with applicable fair-housing and consumer-protection rules.
          Contact{' '}
          <a className="font-semibold underline" href="mailto:info@rbitfinancial.com">
            info@rbitfinancial.com
          </a>{' '}
          with questions.
        </p>
      </Card>
    </RenterShell>
  );
}

export function PrivacyPage() {
  return (
    <RenterShell workspace={false}>
      <Card className="p-6">
        <h1 className="text-2xl font-semibold">Privacy &amp; data</h1>
        <p className="mt-4 text-sm leading-relaxed text-dwel-muted">
          We collect account, preference, application, consent, and payment metadata needed to
          operate Dwel. Before approval, Home Providers receive only permitted prequalification
          information; contact details stay masked per policy. Brokers see only delegated
          applications. Screening results go only to authorized recipients.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-dwel-muted">
          Signed-in renters can request account deletion from Settings. Legally required financial,
          screening, and compliance records may be retained. Contact{' '}
          <a className="font-semibold underline" href="mailto:info@rbitfinancial.com">
            info@rbitfinancial.com
          </a>{' '}
          about your data.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/renter/settings" className="font-semibold underline">
            Open privacy settings
          </Link>
        </p>
      </Card>
    </RenterShell>
  );
}

export function AboutPage() {
  return (
    <RenterShell workspace={false}>
      <Card className="p-6">
        <h1 className="text-2xl font-semibold">About Dwel</h1>
        <p className="mt-2 text-sm font-medium text-dwel-ink">
          Dwel is a product of RBIT Financial Inc.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-dwel-muted">
          Dwel helps renters browse homes, express interest once, complete screening when requested,
          and — when a rental qualifies — receive a stated cashback benefit. Home Providers manage
          listings and applicants. Brokers work only with explicitly delegated providers.
        </p>
        <p className="mt-3 text-sm text-dwel-muted">
          We do not invent partnerships, testimonials, or guarantees. Expressing interest does not
          guarantee a home, approval, or cashback.
        </p>
      </Card>
    </RenterShell>
  );
}

export function ContactPage() {
  return (
    <RenterShell workspace={false}>
      <Card className="p-6">
        <h1 className="text-2xl font-semibold">Contact &amp; support</h1>
        <p className="mt-4 text-sm text-dwel-muted">
          Email{' '}
          <a className="font-semibold underline" href="mailto:info@rbitfinancial.com">
            info@rbitfinancial.com
          </a>{' '}
          for screening, payment, privacy, listing, or billing questions. Include your application
          or listing reference when possible. We do not promise a fixed response time without an
          operational SLA.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-dwel-muted">
          <li>Suspected listing scam or impersonation — mark subject “Fraud report”</li>
          <li>Payment dispute — mark subject “Payment review”</li>
          <li>Privacy / deletion — mark subject “Privacy request”</li>
        </ul>
      </Card>
    </RenterShell>
  );
}

export function CashbackTermsPage() {
  return (
    <RenterShell workspace={false}>
      <Card className="p-6">
        <h1 className="text-2xl font-semibold">Cashback terms</h1>
        <p className="mt-4 text-sm leading-relaxed text-dwel-muted">
          Listed cashback amounts are <strong className="text-dwel-ink">estimates</strong> based on
          Dwel&apos;s interim rule of 20% of the published first month&apos;s rent, unless a
          listing-specific offer version says otherwise. Estimates are not guaranteed payouts.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-dwel-muted">
          <li>Eligibility requires a qualifying completed lease through Dwel and program conditions.</li>
          <li>If rent changes before signing, the displayed estimate may change; interest captures the offer version shown at that time.</li>
          <li>If a lease falls through, cashback is not owed.</li>
          <li>Payment method and timing are confirmed after qualification — not when you express interest.</li>
          <li>
            A promotional screening-fee credit after a completed lease is <em>not</em> established
            policy until RBIT approves funding, qualifying conditions, and consumer terms.
          </li>
        </ul>
        <p className="mt-4 text-sm">
          <Link href="/fees" className="font-semibold underline">
            Fee &amp; screening details
          </Link>
        </p>
      </Card>
    </RenterShell>
  );
}
