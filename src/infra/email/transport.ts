/**
 * Shared transactional email transport (SESv2).
 * Product-aware transport; callers pass product explicitly (never inferred here).
 *
 * Auth: default AWS credential provider chain (ECS task role). No static keys.
 */
import {
  SESv2Client,
  SendEmailCommand,
  type SESv2ClientConfig,
} from '@aws-sdk/client-sesv2';
import { createLogger } from '../logging/logger.js';

const logger = createLogger();

export type EmailProduct = 'lumis' | 'dwel';

export type SendTransactionalEmailInput = {
  product: EmailProduct;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Test seam */
  client?: SESv2Client;
  clientConfig?: SESv2ClientConfig;
  env?: NodeJS.ProcessEnv;
};

const DISPLAY_NAME: Record<EmailProduct, string> = {
  lumis: 'Lumis',
  dwel: 'Dwel',
};

export function resolveEmailProductDisplayName(product: EmailProduct): string {
  return DISPLAY_NAME[product];
}

/**
 * From address — EMAIL_FROM_ADDRESS only (ECS: noreply@rbitfinancial.com).
 * No SES_FROM_ADDRESS fallback.
 */
export function resolveEmailFromAddress(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.EMAIL_FROM_ADDRESS?.trim();
  if (!raw) {
    throw new Error('Missing required environment variable: EMAIL_FROM_ADDRESS');
  }
  return raw;
}

/** Exact From header: `Dwel <noreply@…>` / `Lumis <noreply@…>` */
export function formatFromHeader(
  product: EmailProduct,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return `${resolveEmailProductDisplayName(product)} <${resolveEmailFromAddress(env)}>`;
}

export function resolveAwsRegion(env: NodeJS.ProcessEnv = process.env): string {
  const region = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim();
  if (!region) {
    throw new Error('Missing required environment variable: AWS_REGION');
  }
  return region;
}

export function resolveReplyTo(env: NodeJS.ProcessEnv = process.env): string[] {
  const reply = env.EMAIL_REPLY_TO?.trim();
  return reply ? [reply] : [];
}

export function resolveConfigurationSet(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const name = env.SES_CONFIGURATION_SET?.trim();
  return name || undefined;
}

/**
 * Delivery gate: EMAIL_PROVIDER === 'ses' → send; otherwise stub (no send).
 * Independent of NODE_ENV — ECS runs NODE_ENV=dev with EMAIL_PROVIDER=ses.
 * Optional kill switch: EMAIL_DELIVERY_ENABLED=0/false forces stub even when provider is ses.
 */
export function isEmailDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.EMAIL_PROVIDER?.trim().toLowerCase() !== 'ses') return false;
  const flag = env.EMAIL_DELIVERY_ENABLED?.trim().toLowerCase();
  if (flag === '0' || flag === 'false') return false;
  return true;
}

/** Build the SESv2 SendEmailCommand input — exported for unit tests. */
export function buildSesSendInput(input: SendTransactionalEmailInput) {
  const env = input.env ?? process.env;
  const from = formatFromHeader(input.product, env);
  const replyTo = resolveReplyTo(env);
  const configurationSetName = resolveConfigurationSet(env);

  return {
    FromEmailAddress: from,
    Destination: { ToAddresses: [input.to] },
    ReplyToAddresses: replyTo.length ? replyTo : undefined,
    ConfigurationSetName: configurationSetName,
    Content: {
      Simple: {
        Subject: { Data: input.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: input.html, Charset: 'UTF-8' },
          Text: { Data: input.text, Charset: 'UTF-8' },
        },
      },
    },
  };
}

export async function sendTransactionalEmail(
  input: SendTransactionalEmailInput,
): Promise<{ messageId: string | null }> {
  const env = input.env ?? process.env;
  const region = resolveAwsRegion(env);
  const client =
    input.client ??
    new SESv2Client({
      region,
      ...input.clientConfig,
    });

  const commandInput = buildSesSendInput(input);
  const appEnv = env.APP_ENV ?? env.NODE_ENV ?? 'unknown';

  try {
    const out = await client.send(new SendEmailCommand(commandInput));
    const messageId = out.MessageId ?? null;
    logger.info(
      {
        product: input.product,
        environment: appEnv,
        destination: input.to,
        ses_message_id: messageId,
        http_status: 200,
      },
      'transactional email sent',
    );
    return { messageId };
  } catch (err) {
    // Log error class only — never tokens, HTML, or plaintext bodies.
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : 'SES send failed';
    const awsStatus =
      err && typeof err === 'object' && '$metadata' in err
        ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode
        : undefined;
    logger.error(
      {
        err_name: name,
        err_message: message.slice(0, 200),
        err_code: name,
        product: input.product,
        environment: appEnv,
        destination: input.to,
        http_status: awsStatus ?? null,
      },
      'transactional email send failed',
    );
    throw new Error(`email_send_failed: ${name}`, { cause: err });
  }
}
