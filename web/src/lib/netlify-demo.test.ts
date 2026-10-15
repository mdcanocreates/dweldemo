import { describe, expect, it } from 'vitest';
import { NETLIFY_DEMO_ROLE_LOGIN } from './netlify-demo';

describe('netlify demo role navigation', () => {
  it('maps roles to real login deep links without inventing sessions', () => {
    expect(NETLIFY_DEMO_ROLE_LOGIN.renter.href).toContain('/auth/login');
    expect(NETLIFY_DEMO_ROLE_LOGIN.renter.href).toContain('returnTo=%2Frenter');
    expect(NETLIFY_DEMO_ROLE_LOGIN.broker.href).toContain('role=broker');
    expect(NETLIFY_DEMO_ROLE_LOGIN.landlord.label).toBe('Home Provider');
    expect(NETLIFY_DEMO_ROLE_LOGIN.landlord.href).toContain('partner%2Flandlord');
  });
});
