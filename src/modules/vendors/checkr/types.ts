/**
 * Typed Checkr Tenant API shapes derived from the official OpenAPI (v1.yaml).
 * No SDK types cross this boundary — keep payloads opaque outside vendors/checkr.
 */

export type CheckrPackageSlug = 'starter' | 'essential' | 'complete';

export type CheckrPayer = 'organization' | 'applicant';

export type CheckrOrderStatus =
  | 'waiting_for_applicant'
  | 'pending'
  | 'completed'
  | 'canceled';

export type CheckrProductSlug =
  | 'criminal_history'
  | 'credit_report'
  | 'eviction_history'
  | 'identity_verification'
  | 'income_verification'
  | 'sex_offender_registry'
  | 'global_watchlist';

export type CheckrResultStatus = 'clear' | 'consider' | 'pending' | string;

export type CheckrPropertyAddress = {
  name?: string | null;
  street: string;
  unit?: string | null;
  city: string;
  state: string;
  zipcode: string;
};

export type CheckrApplicantInline = {
  email: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  phone_number?: string;
  dob?: string;
  /** Never persist in Dwel — only for sandbox canned scenarios when explicitly testing. */
  ssn?: string;
};

export type CheckrOriginalRequesterInline = {
  external_id: string;
  type: 'individual' | 'business';
  name: string;
  email?: string;
  phone_number?: string;
  street?: string;
  unit?: string | null;
  city?: string;
  state?: string;
  zipcode?: string;
};

export type CheckrCreateOrderRequest = {
  order: {
    package: CheckrPackageSlug;
    add_on_products?: CheckrProductSlug[];
    payer?: CheckrPayer;
    property_id?: string;
    property?: CheckrPropertyAddress;
    applicant_id?: string;
    applicant?: CheckrApplicantInline;
    original_requester_id?: string;
    original_requester?: CheckrOriginalRequesterInline;
  };
};

export type CheckrOrder = {
  id: string;
  live_mode: boolean;
  status: CheckrOrderStatus;
  package: string;
  add_on_products?: string[];
  payer: CheckrPayer | string;
  property_id: string;
  applicant_id: string;
  original_requester_id?: string | null;
  application_url?: string | null;
  created_at: string;
  completed_at?: string | null;
  canceled_at?: string | null;
  property?: Record<string, unknown>;
  applicant?: Record<string, unknown>;
  original_requester?: Record<string, unknown>;
};

export type CheckrReportProductItem = {
  id?: string;
  status?: CheckrResultStatus;
  result?: CheckrResultStatus;
  consider_reasons?: Array<{ category?: string; label?: string }>;
  [key: string]: unknown;
};

export type CheckrReport = {
  id: string;
  object?: string;
  order_id: string;
  live_mode?: boolean;
  status?: string;
  result?: CheckrResultStatus;
  created_at?: string;
  completed_at?: string | null;
  criminal_history?: CheckrReportProductItem | null;
  credit_report?: CheckrReportProductItem | null;
  eviction_history?: CheckrReportProductItem | null;
  identity_verification?: CheckrReportProductItem | null;
  income_verification?: CheckrReportProductItem | null;
  sex_offender_registry?: CheckrReportProductItem | null;
  global_watchlist?: CheckrReportProductItem | null;
  [key: string]: unknown;
};

export type CheckrWebhookEventType =
  | 'order.applicant.visited'
  | 'order.applicant.started'
  | 'order.applicant.completed'
  | 'order.applicant.paid'
  | 'report.product.completed'
  | 'report.completed'
  | string;

export type CheckrWebhookEvent = {
  id: string;
  object: 'event';
  type: CheckrWebhookEventType;
  created_at: string;
  data: {
    id: string;
    order_id?: string;
    report_id?: string;
    product?: string;
  };
};

export type CheckrApiErrorBody = {
  error?: {
    type?: string;
    message?: string;
    codes?: string[];
  };
  errors?: Array<{ type?: string; message?: string }>;
};

export type CheckrHttpFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string | undefined;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;
