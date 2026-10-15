import type {
  ESign,
  IdentityVerification,
  IncomeVerification,
  PaymentRail,
  TenantScreening,
  VaultTokenizer,
} from './types.js';
import {
  AlternateTenantScreening,
  PlaidIncomeAdapter,
  StubESign,
  StubIdentityVerification,
  StubIncomeVerification,
  StubStripePaymentRail,
  StubTenantScreening,
  StubVaultTokenizer,
} from './stubs.js';
import { createCertnSandboxFromEnv } from './certn.js';
import { UnavailableTenantScreening } from './unavailable.js';
import { assessCertnAvailability } from './certn-availability.js';
import {
  assessCheckrAvailability,
  CheckrTenantScreening,
  createCheckrTenantClientFromEnv,
} from './checkr/index.js';
import { AppError } from '../shared/errors.js';

export type VendorRegistryConfig = {
  tenantScreening?: string;
  identityVerification?: string;
  incomeVerification?: string;
  eSign?: string;
  vaultTokenizer?: string;
  paymentRail?: string;
};

/**
 * Config-only vendor selection. Call sites depend on interfaces, never concrete classes.
 */
export class VendorRegistry {
  private tenantScreeningImpl: TenantScreening;
  private identityImpl: IdentityVerification;
  private incomeImpl: IncomeVerification;
  private eSignImpl: ESign;
  private vaultImpl: VaultTokenizer;
  private paymentRailImpl: PaymentRail;

  constructor(config: VendorRegistryConfig = {}) {
    this.tenantScreeningImpl = this.resolveTenantScreening(
      config.tenantScreening ?? 'certn_stub',
    );
    this.identityImpl = this.resolveIdentity(
      config.identityVerification ?? 'stub_identity',
    );
    this.incomeImpl = this.resolveIncome(
      config.incomeVerification ?? 'stub_income',
    );
    this.eSignImpl = this.resolveESign(config.eSign ?? 'stub_esign');
    this.vaultImpl = this.resolveVault(config.vaultTokenizer ?? 'vault_stub');
    this.paymentRailImpl = this.resolvePaymentRail(config.paymentRail ?? 'stripe_stub');
  }

  reconfigure(config: VendorRegistryConfig): void {
    if (config.tenantScreening) {
      this.tenantScreeningImpl = this.resolveTenantScreening(config.tenantScreening);
    }
    if (config.identityVerification) {
      this.identityImpl = this.resolveIdentity(config.identityVerification);
    }
    if (config.incomeVerification) {
      this.incomeImpl = this.resolveIncome(config.incomeVerification);
    }
    if (config.eSign) {
      this.eSignImpl = this.resolveESign(config.eSign);
    }
    if (config.vaultTokenizer) {
      this.vaultImpl = this.resolveVault(config.vaultTokenizer);
    }
    if (config.paymentRail) {
      this.paymentRailImpl = this.resolvePaymentRail(config.paymentRail);
    }
  }

  tenantScreening(): TenantScreening {
    return this.tenantScreeningImpl;
  }

  identityVerification(): IdentityVerification {
    return this.identityImpl;
  }

  incomeVerification(): IncomeVerification {
    return this.incomeImpl;
  }

  eSign(): ESign {
    return this.eSignImpl;
  }

  vaultTokenizer(): VaultTokenizer {
    return this.vaultImpl;
  }

  paymentRail(): PaymentRail {
    return this.paymentRailImpl;
  }

  private resolveTenantScreening(key: string): TenantScreening {
    switch (key) {
      case 'certn_stub':
        return new StubTenantScreening();
      case 'alternate_screening':
        return new AlternateTenantScreening();
      case 'certn':
      case 'certn_sandbox': {
        const status = assessCertnAvailability();
        if (!status.available) {
          return new UnavailableTenantScreening(status.reason);
        }
        return createCertnSandboxFromEnv();
      }
      case 'certn_unavailable':
        return new UnavailableTenantScreening('certn_api_key_missing');
      case 'checkr':
      case 'checkr_tenant':
      case 'checkr_sandbox': {
        const status = assessCheckrAvailability();
        if (!status.available) {
          return new UnavailableTenantScreening(status.reason);
        }
        return new CheckrTenantScreening({
          client: createCheckrTenantClientFromEnv(),
          resolveOrderContext: async () => {
            throw new AppError(
              'Checkr orders must be created via initiateCheckrScreening',
              'checkr_use_initiate_path',
              500,
            );
          },
        });
      }
      case 'checkr_unavailable':
        return new UnavailableTenantScreening('checkr_disabled');
      default:
        throw new Error(`unknown TenantScreening vendor key: ${key}`);
    }
  }

  private resolveIdentity(key: string): IdentityVerification {
    switch (key) {
      case 'stub_identity':
        return new StubIdentityVerification();
      default:
        throw new Error(`unknown IdentityVerification vendor key: ${key}`);
    }
  }

  private resolveIncome(key: string): IncomeVerification {
    switch (key) {
      case 'stub_income':
        return new StubIncomeVerification();
      case 'plaid':
        return new PlaidIncomeAdapter();
      default:
        throw new Error(`unknown IncomeVerification vendor key: ${key}`);
    }
  }

  private resolveESign(key: string): ESign {
    switch (key) {
      case 'stub_esign':
        return new StubESign();
      default:
        throw new Error(`unknown ESign vendor key: ${key}`);
    }
  }

  private resolveVault(key: string): VaultTokenizer {
    switch (key) {
      case 'vault_stub':
        return new StubVaultTokenizer();
      default:
        // D-14: no Skyflow/Basis Theory keys allowed until decision.
        throw new Error(`unknown VaultTokenizer key (D-14 blocked): ${key}`);
    }
  }

  private resolvePaymentRail(key: string): PaymentRail {
    switch (key) {
      case 'stripe_stub':
        return new StubStripePaymentRail();
      default:
        throw new Error(`unknown PaymentRail vendor key: ${key}`);
    }
  }
}

let defaultRegistry = new VendorRegistry();

export function getVendorRegistry(): VendorRegistry {
  return defaultRegistry;
}

export function setVendorRegistry(registry: VendorRegistry): void {
  defaultRegistry = registry;
}

export function resetVendorRegistry(config?: VendorRegistryConfig): VendorRegistry {
  defaultRegistry = new VendorRegistry(config);
  return defaultRegistry;
}
