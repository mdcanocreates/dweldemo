/** Shared scoring types (§8). */

export const RENTER_SCORE_MODEL_KEY = 'renter_score';
export const RULES_V0_VERSION = 'rules-v0';
export const ML_V1_CANDIDATE_VERSION = 'ml-v1-candidate';
export const FEATURE_SET_VERSION = 'renter_features-v1';

export type RenterFeatureName =
  | 'application_count'
  | 'interest_received_count'
  | 'approval_count'
  | 'decline_count'
  | 'placement_count'
  | 'fraud_flag_count'
  | 'paid_upfront_screening_count'
  | 'income_band'
  | 'household_size'
  | 'approval_rate';

export type RenterFeatures = Record<RenterFeatureName, number>;

/** A single timed observation used for point-in-time assembly. */
export type FeatureObservation = {
  name: RenterFeatureName | string;
  value: number | null;
  /** When this value became true in the source system. */
  written_at: Date;
};

export type FeatureAssemblyInput = {
  partyId: string;
  applicationId?: string | null;
  pointInTimeKey: Date;
  observations: FeatureObservation[];
};

export type AssembledFeatures = {
  features: RenterFeatures;
  featureSources: Record<string, { written_at: string; source: string }>;
  featureSetVersion: string;
  pointInTimeKey: Date;
  partyId: string;
  applicationId: string | null;
};

export type ScoreResult = {
  modelKey: string;
  modelVersion: string;
  cohortKey: string;
  cohortN: number;
  rawScore: number;
  percentile: number | null;
  band: string;
  featureSnapshot: RenterFeatures;
  featureSources: Record<string, { written_at: string; source: string }>;
  explanation: Record<string, unknown>;
  computedBy: string;
};

export type Phase7GateResult = {
  met: boolean;
  reason: string;
  evidence: {
    placement_span_days: number;
    placement_count: number;
    min_span_days: number;
    horizon_days: number;
    due_count: number;
    responded_count: number;
    label_coverage: number;
    min_label_coverage: number;
    as_of: string;
  };
};
