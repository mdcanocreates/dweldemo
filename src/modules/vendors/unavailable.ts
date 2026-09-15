import type {
  TenantScreening,
  TenantScreeningReportStatus,
  TenantScreeningSubmitRequest,
  TenantScreeningSubmitResult,
  VendorCallContext,
} from './types.js';
import { AppError } from '../shared/errors.js';

/**
 * Hard fail if HTTP gating is bypassed while Certn is not configured.
 * Must never produce stub-like success or mutate domain state.
 */
export class UnavailableTenantScreening implements TenantScreening {
  readonly vendorName = 'certn_unavailable';

  constructor(readonly unavailableReason: string) {}

  async submitOrder(
    _req: TenantScreeningSubmitRequest,
    _ctx: VendorCallContext,
  ): Promise<TenantScreeningSubmitResult> {
    throw new AppError(
      'screening provider not configured',
      'SCREENING_PROVIDER_UNAVAILABLE',
      503,
    );
  }

  async getReportStatus(
    _vendorReportId: string,
    _ctx: VendorCallContext,
  ): Promise<TenantScreeningReportStatus> {
    throw new AppError(
      'screening provider not configured',
      'SCREENING_PROVIDER_UNAVAILABLE',
      503,
    );
  }
}
