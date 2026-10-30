import { describe, expect, it } from 'vitest';
import { edgeOriginForPath } from '../../src/edge/spa-routing.js';

describe('local SPA edge split', () => {
  it('keeps API prefixes off the SPA document', () => {
    expect(edgeOriginForPath('/listings')).toBe('spa');
    expect(edgeOriginForPath('/listings/')).toBe('spa');
    expect(edgeOriginForPath('/v1/listings')).toBe('api');
    expect(edgeOriginForPath('/internal/v1/cases')).toBe('api');
    expect(edgeOriginForPath('/health')).toBe('api');
    expect(edgeOriginForPath('/health/ready')).toBe('api');
  });
});
