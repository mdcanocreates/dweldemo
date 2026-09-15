/**
 * R-5 static check: fail if any SET rbit.* lacks LOCAL, or set_config(..., false)
 * for rbit.* session variables (non-transaction-local tenant bleed).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCAN_ROOTS = ['src', 'ci', 'scripts', 'migrations', 'tests'];

const violations: string[] = [];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'coverage') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|js|sql)$/.test(ent.name)) out.push(p);
  }
  return out;
}

function scanFile(file: string): void {
  const rel = path.relative(ROOT, file);
  // This gate file and R-5 evidence/teeth test may mention the forbidden patterns.
  if (rel.replace(/\\/g, '/').includes('ci/gates/tenant-session-local.ts')) return;
  if (rel.replace(/\\/g, '/').includes('remediation-r5.test.ts')) return;

  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;

    // Plain SET rbit. without LOCAL
    if (/\bSET\s+rbit\./i.test(line) && !/\bSET\s+LOCAL\s+rbit\./i.test(line)) {
      violations.push(`${rel}:${lineNo}: SET rbit.* without LOCAL — ${line.trim()}`);
    }

    // set_config('rbit....', ..., false) — third arg false
    if (
      /set_config\s*\(\s*['`]rbit\./i.test(line) &&
      /,\s*false\s*\)/.test(line)
    ) {
      violations.push(`${rel}:${lineNo}: set_config(rbit.*, false) — ${line.trim()}`);
    }
  }
}

function main(): void {
  for (const root of SCAN_ROOTS) {
    const abs = path.join(ROOT, root);
    try {
      for (const f of walk(abs)) scanFile(f);
    } catch {
      /* missing root ok */
    }
  }

  const evidenceDir = path.join(ROOT, 'evidence', 'remediation', 'R-5');
  mkdirSync(evidenceDir, { recursive: true });

  if (violations.length) {
    const body = `FAIL ${violations.length} violation(s)\n` + violations.join('\n') + '\n';
    writeFileSync(path.join(evidenceDir, 'static-check-last-fail.txt'), body, 'utf8');
    console.error(body);
    process.exit(1);
  }

  const ok = 'PASS — no plain SET rbit.* without LOCAL; no set_config(rbit.*, false)\n';
  writeFileSync(path.join(evidenceDir, 'static-check-last-pass.txt'), ok, 'utf8');
  console.log(ok);
}

main();
