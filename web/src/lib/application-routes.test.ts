import { describe, expect, it } from 'vitest';
import {
  applicationPath,
  applicationScreeningPath,
  isValidApplicationId,
} from './application-routes';

describe('application routes', () => {
  it('rejects undefined/null/empty ids (regression for #/applications/undefined/screening)', () => {
    expect(isValidApplicationId(undefined)).toBe(false);
    expect(isValidApplicationId(null)).toBe(false);
    expect(isValidApplicationId('undefined')).toBe(false);
    expect(isValidApplicationId('null')).toBe(false);
    expect(isValidApplicationId('')).toBe(false);
    expect(applicationScreeningPath(undefined)).toBeNull();
    expect(applicationPath('undefined')).toBeNull();
  });

  it('accepts UUID and preview ids', () => {
    const uuid = 'a1000000-0000-4000-8000-000000000001';
    expect(applicationScreeningPath(uuid)).toBe(`/applications/${uuid}/screening`);
    expect(applicationPath('ui-app-awaiting-consent')).toBe(
      '/applications/ui-app-awaiting-consent',
    );
  });
});
