const CASE_LABELS: Record<string, string> = {
  draft: 'Not started',
  searching: 'Searching',
  tenancy_packet: 'RFTA in progress',
  agency_review: 'Agency review in progress',
  leaseup_confirmed: 'Lease-up confirmed',
  closed: 'Closed',
};

const PACKET_LABELS: Record<string, string> = {
  draft: 'Packet started',
  awaiting_participant: 'Waiting for participant',
  awaiting_provider: 'Waiting for provider',
  ready_for_agency_review: 'Ready for agency review',
  sent_to_agency: 'Sent to the agency',
  agency_acknowledged: 'Agency received the packet',
  cancelled: 'Cancelled',
};

const APPOINTMENT_LABELS: Record<string, string> = {
  scheduling_requested: 'Scheduling requested',
  appointment_offered: 'Appointment offered',
  scheduled: 'Scheduled',
  rescheduled: 'Rescheduled',
  completed_pending_result: 'Visit complete, waiting for the agency result',
  external_result_recorded: 'Agency result recorded',
};

export function caseStatusLabel(status: string): string {
  return CASE_LABELS[status] ?? 'Status unavailable';
}

export function packetStatusLabel(status: string): string {
  return PACKET_LABELS[status] ?? 'Status unavailable';
}

export function appointmentStatusLabel(status: string): string {
  return APPOINTMENT_LABELS[status] ?? 'Status unavailable';
}

export function nextCaseAction(status: string): string {
  switch (status) {
    case 'draft':
      return 'Add search preferences and assign a caseworker';
    case 'searching':
      return 'Save a home or contact a provider';
    case 'tenancy_packet':
      return 'Finish the RFTA sections still open';
    case 'agency_review':
      return 'Agency review in progress';
    case 'leaseup_confirmed':
      return 'Lease-up was confirmed by the agency';
    case 'closed':
      return 'This search is closed';
    default:
      return 'Review the case';
  }
}
