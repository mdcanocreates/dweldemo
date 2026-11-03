import { Shell } from '../components/Shell';
import { DraftLegalBanner, H, LegalDocLayout, P } from '../components/LegalDoc';

/** Fair housing tip page — still uses draft banner until counsel approves a full statement. */
export function LegalFairHousingPage() {
  return (
    <Shell>
      <DraftLegalBanner />
      <LegalDocLayout title="Fair housing">
        <P>
          Apply the same screening and property criteria consistently to every applicant. Use the same
          standards, requirements, and screening process for all applicants for a property.
        </P>
        <H>Need help?</H>
        <P>
          Questions about fair housing on Dwel can be sent to{' '}
          <a href="mailto:info@rbitfinancial.com">info@rbitfinancial.com</a>. This page remains a draft
          pending RBIT counsel review.
        </P>
      </LegalDocLayout>
    </Shell>
  );
}
