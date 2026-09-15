import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertProductionConfigReady,
  ProductionConfigBlockedError,
} from '../../src/modules/config/index.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'remediation', 'R-2');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

describe('R-2 remediation — §18 boot assertion', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('boot assertion does not fire in test/dev', async () => {
    await withBypass(db.pool, async (c) => {
      const rTest = await assertProductionConfigReady(c, 'test');
      const rDev = await assertProductionConfigReady(c, 'development');
      expect(rTest).toEqual({ ok: true });
      expect(rDev).toEqual({ ok: true });
      writeEvidence('boot-dev-test.txt', 'NODE_ENV=test|development → ok\n');
    });
  });

  it('production boot refuses unapproved/provisional §18 config', async () => {
    let message = '';
    try {
      await withBypass(db.pool, async (c) => {
        await assertProductionConfigReady(c, 'production');
      });
    } catch (err) {
      expect(err).toBeInstanceOf(ProductionConfigBlockedError);
      message = (err as Error).message;
    }
    expect(message).toMatch(/Production boot blocked/);
    expect(message).toMatch(/§18/);
    writeEvidence('boot-production-refuse.txt', message + '\n');

    // Also via CLI script
    try {
      execFileSync('npx', ['tsx', 'scripts/boot-check.ts'], {
        cwd: ROOT,
        env: {
          ...process.env,
          DATABASE_URL: db.connectionString,
          NODE_ENV: 'production',
        },
        encoding: 'utf8',
        shell: true,
      });
      expect.fail('boot-check should have exited non-zero');
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
      writeEvidence('boot-check-cli.txt', out);
      expect(out).toMatch(/Production boot blocked/);
    }
  });
});
