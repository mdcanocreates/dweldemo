import type { AuthorityRoleName } from './contracts.js';

export type AuthorityPrincipal = {
  partyId: string;
  role: AuthorityRoleName;
  membershipId: string;
};

const CASE_READ_ROLES = new Set<AuthorityRoleName>([
  'agency_owner',
  'agency_supervisor',
  'caseworker',
  'navigator',
  'inspection_coordinator',
]);

export function mayReadAgencyCase(input: {
  principal: AuthorityPrincipal;
  assignedMembershipId: string | null;
  sharedPartyIds: string[];
}): boolean {
  const { principal } = input;
  if (!CASE_READ_ROLES.has(principal.role)) return false;
  if (principal.role === 'agency_owner' || principal.role === 'agency_supervisor') return true;
  if (principal.role === 'inspection_coordinator') return true;
  if (principal.role === 'caseworker') {
    return input.assignedMembershipId === principal.membershipId;
  }
  return input.sharedPartyIds.includes(principal.partyId);
}

export function mayVerifyAssistance(role: AuthorityRoleName): boolean {
  return role === 'agency_owner' || role === 'agency_supervisor';
}

export function mayAcknowledgePacket(role: AuthorityRoleName): boolean {
  return role === 'agency_owner' || role === 'agency_supervisor';
}

export function mayReadSensitiveCaseFields(role: AuthorityRoleName): boolean {
  return role === 'agency_owner' || role === 'agency_supervisor' || role === 'caseworker';
}

export function supportMayReadHousehold(): boolean {
  return false;
}
