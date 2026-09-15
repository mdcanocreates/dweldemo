import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * §16.2 Migration safety gate:
 * - reject same-deploy column drops without annotated override
 * - reject ACCESS EXCLUSIVE without annotated override
 */
async function main(): Promise<void> {
  const dir = path.join(ROOT, 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const failures: string[] = [];

  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8');
    const hasDropOverride = /--\s*rbit:allow-column-drop/.test(sql);
    const hasLockOverride = /--\s*rbit:allow-access-exclusive/.test(sql);

    if (/alter\s+table[\s\S]*?drop\s+column/i.test(sql) && !hasDropOverride) {
      failures.push(`${file}: DROP COLUMN without -- rbit:allow-column-drop override`);
    }
    if (/access exclusive/i.test(sql) && !hasLockOverride) {
      failures.push(`${file}: ACCESS EXCLUSIVE without -- rbit:allow-access-exclusive override`);
    }
  }

  if (failures.length) {
    console.error('migration-safety-gate: FAIL');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('migration-safety-gate: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
