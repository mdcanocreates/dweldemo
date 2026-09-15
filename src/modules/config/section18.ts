/**
 * §18-dependent config namespaces. Production boot refuses if any effective
 * row is missing, unapproved, or marked provisional.
 * Values themselves are NOT changed here — only registration + enforcement.
 */
export const SECTION_18_NAMESPACES = [
  { namespace: 'retention', decisions: ['D-01'] },
  { namespace: 'screening_policy', decisions: ['D-02', 'D-15'] },
  { namespace: 'broker_license_coverage', decisions: ['D-03'] },
  { namespace: 'ledger_policy', decisions: ['D-05'] },
  { namespace: 'ingestion_display_policy', decisions: ['D-11'] },
  { namespace: 'reso_aggregator', decisions: ['D-12'] },
  { namespace: 'renter_discoverability_filters', decisions: ['D-13'] },
  { namespace: 'vendor_adapters', decisions: ['D-14', 'D-16'] },
] as const;

export type Section18Namespace = (typeof SECTION_18_NAMESPACES)[number]['namespace'];
