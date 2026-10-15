import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('health live endpoint', () => {
  it('exposes /health/live without DB in server bootstrap', () => {
    const src = readFileSync(join(process.cwd(), 'src/server.ts'), 'utf8');
    expect(src).toContain("path === '/health/live'");
    expect(src).toContain('buildLiveHealthResponse');
    expect(src).toMatch(/buildLiveHealthResponse[\s\S]*statusCode:\s*200/);
  });
});
