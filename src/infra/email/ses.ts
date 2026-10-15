/**
 * Dwel magic-link email — uses shared SESv2 transport.
 * This service is Dwel-only; product is hardcoded at the call site as 'dwel'.
 * Token generation / expiry / redeem semantics live in auth modules — untouched.
 */
import type { SESv2Client, SESv2ClientConfig } from '@aws-sdk/client-sesv2';
import { isEmailDeliveryEnabled, sendTransactionalEmail } from './transport.js';

export { isEmailDeliveryEnabled, resolveAwsRegion } from './transport.js';

export type SendMagicLinkEmailOptions = {
  expiresInMs: number;
  region?: string;
  client?: SESv2Client;
  clientConfig?: SESv2ClientConfig;
  env?: NodeJS.ProcessEnv;
};

export type DeliverMagicLinkInput = {
  email: string;
  purpose: string;
  /** Plaintext token from issueMagicToken. Never log. */
  token: string;
  magicTokenTtlMs: number;
  appOrigin: string;
  send?: typeof sendMagicLinkEmail;
};

/** Format expiry for copy from the configured magic-token TTL. */
export function formatMagicLinkExpiry(expiresInMs: number): string {
  const minutes = Math.max(1, Math.round(expiresInMs / 60_000));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * Build the hash-router sign-in URL that carries the redeem token.
 * Path matches the current Dwel frontend callback route.
 */
export function buildMagicLinkUrl(input: {
  appOrigin: string;
  token: string;
  purpose: string;
}): string {
  const origin = input.appOrigin.replace(/\/$/, '');
  const params = new URLSearchParams({
    token: input.token,
    purpose: input.purpose,
  });
  return `${origin}/#/auth/callback?${params.toString()}`;
}

export async function deliverMagicLinkEmailIfEnabled(
  input: DeliverMagicLinkInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!isEmailDeliveryEnabled(env)) return;

  const magicLinkUrl = buildMagicLinkUrl({
    appOrigin: input.appOrigin,
    token: input.token,
    purpose: input.purpose,
  });
  const send = input.send ?? sendMagicLinkEmail;
  await send(input.email, magicLinkUrl, {
    expiresInMs: input.magicTokenTtlMs,
    env,
  });
}

export async function sendMagicLinkEmail(
  to: string,
  magicLinkUrl: string,
  opts: SendMagicLinkEmailOptions,
): Promise<void> {
  // rbit-dev-api / RBIT2 is Dwel-only — hardcode at call site, not in transport.
  const product = 'dwel' as const;
  const expiry = formatMagicLinkExpiry(opts.expiresInMs);

  const subject = 'Sign in to Dwel';
  const textBody = [
    'Hello,',
    '',
    'Use this link to sign in to Dwel:',
    magicLinkUrl,
    '',
    `This link expires in ${expiry}.`,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  const htmlBody = [
    '<p>Hello,</p>',
    '<p>Use this link to sign in to Dwel:</p>',
    `<p><a href="${escapeHtmlAttr(magicLinkUrl)}">Sign in to Dwel</a></p>`,
    `<p>This link expires in ${escapeHtmlText(expiry)}.</p>`,
    '<p>If you did not request this, you can ignore this email.</p>',
  ].join('\n');

  await sendTransactionalEmail({
    product,
    to,
    subject,
    html: htmlBody,
    text: textBody,
    client: opts.client,
    clientConfig: opts.clientConfig,
    env: opts.env,
  });
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
