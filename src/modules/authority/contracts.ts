import { z } from 'zod';

export const AssistanceIndicator = z.enum([
  'unknown',
  'self_reported',
  'agency_verified',
  'expired',
  'revoked',
]);

export const CreateAssistanceIndicator = z.enum(['unknown', 'self_reported']);

export const HousingCaseStatus = z.enum([
  'draft',
  'searching',
  'tenancy_packet',
  'agency_review',
  'leaseup_confirmed',
  'closed',
]);

export const AuthorityRole = z.enum([
  'agency_owner',
  'agency_supervisor',
  'caseworker',
  'navigator',
  'inspection_coordinator',
]);

export const SearchPreferences = z
  .object({
    bedroomsMin: z.number().int().min(0).max(10).optional(),
    maxMonthlyGrossRentCents: z.number().int().nonnegative().max(100_000_000).optional(),
    areaIds: z.array(z.string().max(100)).max(20).default([]),
    moveInAfter: z.string().date().optional(),
    requiredAmenities: z.array(z.string().max(50)).max(30).default([]),
    accessibilityPreferences: z.array(z.string().max(60)).max(20).default([]),
  })
  .strict();

export const CreateHousingCase = z
  .object({
    displayReference: z.string().min(3).max(80),
    assignedMembershipId: z.string().uuid().optional(),
    searchPreferences: SearchPreferences,
    assistanceIndicator: CreateAssistanceIndicator.default('unknown'),
    dwelPartyId: z.string().uuid().optional(),
  })
  .strict();

export const UpdateHousingCase = z
  .object({
    searchPreferences: SearchPreferences.optional(),
    status: HousingCaseStatus.optional(),
    version: z.number().int().positive(),
  })
  .strict();

export const VerifyAssistance = z
  .object({
    indicator: z.enum(['agency_verified', 'expired', 'revoked']),
    programType: z.string().min(2).max(80),
    verificationSource: z.string().min(3).max(200),
    version: z.number().int().positive(),
  })
  .strict();

export const ALLOWED_DOCUMENT_MIME = ['application/pdf', 'image/png', 'image/jpeg'] as const;

export const UploadIntent = z
  .object({
    filename: z.string().min(1).max(180),
    mimeType: z.enum(ALLOWED_DOCUMENT_MIME),
    byteSize: z.number().int().positive().max(5_000_000),
  })
  .strict();

export type CreateHousingCaseInput = z.infer<typeof CreateHousingCase>;
export type AuthorityRoleName = z.infer<typeof AuthorityRole>;
