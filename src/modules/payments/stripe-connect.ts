/**
 * Part I — Stripe Connect Express (org-scoped).
 * Live adapter uses Stripe API; Memory adapter for tests.
 */

import Stripe from 'stripe';
import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import { emitDomainEvent } from '../audit/index.js';

export type ConnectAccountStatus = 'none' | 'pending' | 'restricted' | 'active';

export type ConnectAccountView = {
  account_id: string | null;
  status: ConnectAccountStatus;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  broker_payouts_enabled: boolean;
};

export type StripeConnectAdapter = {
  createExpressAccount(input: {
    email?: string | null;
    metadata: Record<string, string>;
  }): Promise<{ accountId: string }>;
  createAccountLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  retrieveAccount(accountId: string): Promise<{
    id: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    disabledReason: string | null;
  }>;
  createLoginLink(accountId: string): Promise<{ url: string }>;
};

type MemAccount = {
  id: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
};

export class MemoryStripeConnectAdapter implements StripeConnectAdapter {
  private accounts = new Map<string, MemAccount>();
  private seq = 0;

  reset(): void {
    this.accounts.clear();
    this.seq = 0;
  }

  /** Test helper: mark onboarding complete. */
  completeOnboarding(accountId: string): void {
    const a = this.accounts.get(accountId);
    if (!a) throw new Error('unknown account');
    a.detailsSubmitted = true;
    a.chargesEnabled = true;
    a.payoutsEnabled = true;
    a.disabledReason = null;
  }

  async createExpressAccount(input: {
    email?: string | null;
    metadata: Record<string, string>;
  }): Promise<{ accountId: string }> {
    void input;
    const id = `acct_mem_${++this.seq}`;
    this.accounts.set(id, {
      id,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      disabledReason: null,
    });
    return { accountId: id };
  }

  async createAccountLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    if (!this.accounts.has(input.accountId)) {
      throw new AppError('connect account not found', 'connect_account_not_found', 404);
    }
    return {
      url: `memory://stripe-connect/onboard?account=${encodeURIComponent(input.accountId)}&return=${encodeURIComponent(input.returnUrl)}`,
    };
  }

  async retrieveAccount(accountId: string) {
    const a = this.accounts.get(accountId);
    if (!a) throw new AppError('connect account not found', 'connect_account_not_found', 404);
    return { ...a };
  }

  async createLoginLink(accountId: string): Promise<{ url: string }> {
    if (!this.accounts.has(accountId)) {
      throw new AppError('connect account not found', 'connect_account_not_found', 404);
    }
    return { url: `memory://stripe-connect/dashboard?account=${encodeURIComponent(accountId)}` };
  }
}

export class LiveStripeConnectAdapter implements StripeConnectAdapter {
  private readonly stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, { apiVersion: '2025-02-24.acacia' });
  }

  async createExpressAccount(input: {
    email?: string | null;
    metadata: Record<string, string>;
  }): Promise<{ accountId: string }> {
    const account = await this.stripe.accounts.create({
      type: 'express',
      email: input.email ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: input.metadata,
    });
    return { accountId: account.id };
  }

  async createAccountLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const link = await this.stripe.accountLinks.create({
      account: input.accountId,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: 'account_onboarding',
    });
    return { url: link.url };
  }

  async retrieveAccount(accountId: string) {
    const account = await this.stripe.accounts.retrieve(accountId);
    return {
      id: account.id,
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      disabledReason: account.requirements?.disabled_reason ?? null,
    };
  }

  async createLoginLink(accountId: string): Promise<{ url: string }> {
    const link = await this.stripe.accounts.createLoginLink(accountId);
    return { url: link.url };
  }
}

let adapter: StripeConnectAdapter = new MemoryStripeConnectAdapter();

export function getStripeConnectAdapter(): StripeConnectAdapter {
  return adapter;
}

export function setStripeConnectAdapter(next: StripeConnectAdapter): void {
  adapter = next;
}

export function resetStripeConnectAdapter(): MemoryStripeConnectAdapter {
  const mem = new MemoryStripeConnectAdapter();
  adapter = mem;
  return mem;
}

function deriveStatus(input: {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
}): ConnectAccountStatus {
  if (!input.accountId) return 'none';
  if (input.disabledReason) return 'restricted';
  if (input.chargesEnabled && input.payoutsEnabled && input.detailsSubmitted) return 'active';
  return 'pending';
}

export async function getOrgConnectStatus(
  client: DbClient,
  orgId: string,
): Promise<ConnectAccountView> {
  const { rows } = await client.query<{
    broker_payouts_enabled: boolean;
    stripe_connect_account_id: string | null;
    stripe_connect_status: ConnectAccountStatus | null;
    stripe_connect_charges_enabled: boolean;
    stripe_connect_payouts_enabled: boolean;
    stripe_connect_details_submitted: boolean;
  }>(
    `select broker_payouts_enabled,
            stripe_connect_account_id,
            stripe_connect_status,
            stripe_connect_charges_enabled,
            stripe_connect_payouts_enabled,
            stripe_connect_details_submitted
     from org where id = $1`,
    [orgId],
  );
  const row = rows[0];
  if (!row) throw new AppError('org not found', 'org_not_found', 404);

  if (!row.stripe_connect_account_id) {
    return {
      account_id: null,
      status: 'none',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      broker_payouts_enabled: row.broker_payouts_enabled,
    };
  }

  // Refresh from Stripe when possible
  try {
    const live = await getStripeConnectAdapter().retrieveAccount(row.stripe_connect_account_id);
    const status = deriveStatus({
      accountId: live.id,
      chargesEnabled: live.chargesEnabled,
      payoutsEnabled: live.payoutsEnabled,
      detailsSubmitted: live.detailsSubmitted,
      disabledReason: live.disabledReason,
    });
    await client.query(
      `update org set
         stripe_connect_status = $2,
         stripe_connect_charges_enabled = $3,
         stripe_connect_payouts_enabled = $4,
         stripe_connect_details_submitted = $5,
         stripe_connect_updated_at = now()
       where id = $1`,
      [orgId, status, live.chargesEnabled, live.payoutsEnabled, live.detailsSubmitted],
    );
    return {
      account_id: live.id,
      status,
      charges_enabled: live.chargesEnabled,
      payouts_enabled: live.payoutsEnabled,
      details_submitted: live.detailsSubmitted,
      broker_payouts_enabled: row.broker_payouts_enabled,
    };
  } catch {
    return {
      account_id: row.stripe_connect_account_id,
      status: row.stripe_connect_status ?? 'pending',
      charges_enabled: row.stripe_connect_charges_enabled,
      payouts_enabled: row.stripe_connect_payouts_enabled,
      details_submitted: row.stripe_connect_details_submitted,
      broker_payouts_enabled: row.broker_payouts_enabled,
    };
  }
}

export async function createOrgConnectAccount(
  client: DbClient,
  input: {
    orgId: string;
    actorPartyId: string;
    email?: string | null;
  },
): Promise<ConnectAccountView> {
  const existing = await getOrgConnectStatus(client, input.orgId);
  if (existing.account_id) return existing;

  const created = await getStripeConnectAdapter().createExpressAccount({
    email: input.email,
    metadata: { org_id: input.orgId },
  });

  await client.query(
    `update org set
       stripe_connect_account_id = $2,
       stripe_connect_status = 'pending',
       stripe_connect_charges_enabled = false,
       stripe_connect_payouts_enabled = false,
       stripe_connect_details_submitted = false,
       stripe_connect_updated_at = now()
     where id = $1`,
    [input.orgId, created.accountId],
  );

  await emitDomainEvent(client, {
    aggregateType: 'org',
    aggregateId: input.orgId,
    eventType: 'stripe_connect_account_created',
    payload: { account_id: created.accountId },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  return getOrgConnectStatus(client, input.orgId);
}

export async function createOrgOnboardingLink(
  client: DbClient,
  input: {
    orgId: string;
    refreshUrl: string;
    returnUrl: string;
  },
): Promise<{ url: string; account_id: string }> {
  const status = await getOrgConnectStatus(client, input.orgId);
  if (!status.account_id) {
    throw new AppError('connect account required', 'connect_account_required', 400);
  }
  const link = await getStripeConnectAdapter().createAccountLink({
    accountId: status.account_id,
    refreshUrl: input.refreshUrl,
    returnUrl: input.returnUrl,
  });
  return { url: link.url, account_id: status.account_id };
}

export async function createOrgDashboardLink(
  client: DbClient,
  orgId: string,
): Promise<{ url: string; account_id: string }> {
  const status = await getOrgConnectStatus(client, orgId);
  if (!status.account_id) {
    throw new AppError('connect account required', 'connect_account_required', 400);
  }
  const link = await getStripeConnectAdapter().createLoginLink(status.account_id);
  return { url: link.url, account_id: status.account_id };
}
