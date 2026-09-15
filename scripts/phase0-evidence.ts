/**
 * Convenience runner: execute static gates that do not need a live DB,
 * and print paths to acceptance evidence produced by `npm test`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(script: string): void {
  console.log(`\n>> ${script}`);
  execFileSync('npm', ['run', script], { cwd: ROOT, stdio: 'inherit', shell: true });
}

run('lint:boundaries');
run('ci:migration-safety');
run('ci:pii-manifest');
run('ci:openapi-drift');

const evidenceDir = path.join(ROOT, 'evidence', 'phase0');
if (existsSync(evidenceDir)) {
  console.log('\nPhase 0 evidence artifacts:');
  for (const f of readdirSync(evidenceDir)) {
    console.log(`  - evidence/phase0/${f}`);
  }
} else {
  console.log('\nNo evidence/phase0 yet — run `npm test` to generate acceptance artifacts.');
}
