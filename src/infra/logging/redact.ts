const FIELD_DENY = new Set([
  'ssn',
  'social_security_number',
  'socialSecurityNumber',
  'government_id',
  'governmentId',
  'dob',
  'date_of_birth',
  'dateOfBirth',
  'given_name',
  'givenName',
  'family_name',
  'familyName',
  'email',
  'phone',
  'phone_number',
  'phoneNumber',
  'card_number',
  'cardNumber',
  'password',
  'token',
  'otp',
  'magic_link',
  'magicLink',
  'identity_fingerprint',
  'identityFingerprint',
  'wrapped_key',
  'wrappedKey',
  'dek',
  'plaintext',
  'credential',
  'credentials',
  'credential_ref',
  'api_key',
  'apiKey',
  'client_secret',
  'clientSecret',
  'oauth_token',
  'oauthToken',
  'refresh_token',
  'refreshToken',
  'hmac_secret',
  'hmacSecret',
  'signing_secret',
  'signingSecret',
]);

const SSN_RE = /\b\d{3}-?\d{2}-?\d{4}\b/g;
const DOB_RE = /\b(?:19|20)\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])\b/g;
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;

export function redactString(input: string): string {
  return input
    .replace(SSN_RE, '[REDACTED_SSN]')
    .replace(DOB_RE, '[REDACTED_DOB]')
    .replace(CARD_RE, '[REDACTED_CARD]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(PHONE_RE, '[REDACTED_PHONE]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(
      /(api[_-]?key|client_secret|refresh_token|signing_secret|hmac_secret|password|secret|token|credential)\s*[:=]\s*\S+/gi,
      '$1=[REDACTED]',
    );
}

export function redactValue(value: unknown, key?: string): unknown {
  if (key && FIELD_DENY.has(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, k);
    }
    return out;
  }
  return value;
}

export function containsAnyPlaintext(haystack: string, needles: string[]): string[] {
  const found: string[] = [];
  for (const needle of needles) {
    if (!needle) continue;
    if (haystack.includes(needle)) found.push(needle);
  }
  return found;
}
