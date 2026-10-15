import { RoleEntryPage } from '../../components/layout/RoleEntryPage';

export function LandlordsMarketingPage() {
  return (
    <RoleEntryPage
      role="landlord"
      title="Dwel for landlords"
      body="List homes, review renter interest, and request screening only when you're ready — without brochure-site noise."
      bullets={[
        'Publish listings with clear rent, beds, and availability',
        'See who is interested before you request a background check',
        'Transparent listing fees — no placement fees in Phase 1',
      ]}
    />
  );
}
