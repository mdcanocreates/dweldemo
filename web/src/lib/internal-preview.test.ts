import { describe, expect, it, beforeEach, afterEach } from 'vitest';

describe('preview env gate (pure)', () => {
  const prevEnabled = process.env.DWEL_INTERNAL_PREVIEW_ENABLED;
  const prevEmails = process.env.DWEL_INTERNAL_PREVIEW_EMAILS;

  afterEach(() => {
    if (prevEnabled === undefined) delete process.env.DWEL_INTERNAL_PREVIEW_ENABLED;
    else process.env.DWEL_INTERNAL_PREVIEW_ENABLED = prevEnabled;
    if (prevEmails === undefined) delete process.env.DWEL_INTERNAL_PREVIEW_EMAILS;
    else process.env.DWEL_INTERNAL_PREVIEW_EMAILS = prevEmails;
  });

  function previewEnabled(): boolean {
    return process.env.DWEL_INTERNAL_PREVIEW_ENABLED === 'true';
  }
  function previewAllowlist(): string[] {
    return (process.env.DWEL_INTERNAL_PREVIEW_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }
  function mayPreview(email: string | undefined): boolean {
    if (!previewEnabled()) return false;
    const allow = previewAllowlist();
    if (!email || allow.length === 0) return false;
    return allow.includes(email.trim().toLowerCase());
  }

  beforeEach(() => {
    delete process.env.DWEL_INTERNAL_PREVIEW_ENABLED;
    delete process.env.DWEL_INTERNAL_PREVIEW_EMAILS;
  });

  it('rejects when env flag disabled', () => {
    process.env.DWEL_INTERNAL_PREVIEW_EMAILS = 'mdcano@rbitfinancial.com';
    expect(mayPreview('mdcano@rbitfinancial.com')).toBe(false);
  });

  it('rejects non-allowlisted email when enabled', () => {
    process.env.DWEL_INTERNAL_PREVIEW_ENABLED = 'true';
    process.env.DWEL_INTERNAL_PREVIEW_EMAILS =
      'mdcano@rbitfinancial.com,addison@rbitfinancial.com';
    expect(mayPreview('info@rbitfinancial.com')).toBe(false);
  });

  it('allows allowlisted emails when enabled', () => {
    process.env.DWEL_INTERNAL_PREVIEW_ENABLED = 'true';
    process.env.DWEL_INTERNAL_PREVIEW_EMAILS =
      'mdcano@rbitfinancial.com,addison@rbitfinancial.com';
    expect(mayPreview('mdcano@rbitfinancial.com')).toBe(true);
    expect(mayPreview('addison@rbitfinancial.com')).toBe(true);
  });
});
