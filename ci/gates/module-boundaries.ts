import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Module boundary lint (P1).
 * Modules may import from their own tree, from each module's index.ts public surface,
 * and from src/infra and src/db. Deep imports into another module's internals fail.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULES_DIR = path.join(ROOT, 'src/modules');

const ALLOWED_DEEP_PREFIXES = ['src/infra/', 'src/db/', 'src/modules/shared/'];

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) out.push(...(await walk(full)));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function moduleNameOf(file: string): string | null {
  const rel = path.relative(MODULES_DIR, file).replace(/\\/g, '/');
  if (rel.startsWith('..')) return null;
  return rel.split('/')[0] ?? null;
}

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(fromFile), spec);
  const candidates = [`${resolved}.ts`, path.join(resolved, 'index.ts')];
  return candidates[0] ?? null;
}

async function main(): Promise<void> {
  const files = await walk(path.join(ROOT, 'src'));
  const violations: string[] = [];

  for (const file of files) {
    const fromMod = moduleNameOf(file);
    if (!fromMod) continue;
    const src = await readFile(file, 'utf8');
    const importRe = /from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(src))) {
      const spec = m[1]!;
      const absGuess = resolveImport(file, spec);
      if (!absGuess) continue;
      // Normalize to existing path by checking relative target string.
      const targetRel = path
        .relative(ROOT, path.resolve(path.dirname(file), spec))
        .replace(/\\/g, '/');
      const cleaned = targetRel.replace(/\.js$/, '.ts');

      if (ALLOWED_DEEP_PREFIXES.some((p) => cleaned.startsWith(p))) continue;

      const toMod = moduleNameOf(
        cleaned.endsWith('.ts')
          ? path.join(ROOT, cleaned)
          : path.join(ROOT, `${cleaned}.ts`),
      );
      if (!toMod || toMod === fromMod) continue;

      const isPublic =
        cleaned === `src/modules/${toMod}/index.ts` ||
        cleaned === `src/modules/${toMod}/index` ||
        cleaned.endsWith(`src/modules/${toMod}/index`);
      // Allow importing public barrel via relative path ending in ../other/index.js
      const base = path.basename(cleaned).replace(/\.ts$/, '');
      const parent = path.basename(path.dirname(path.join(ROOT, cleaned + (cleaned.endsWith('.ts') ? '' : '.ts'))));
      const importingPublic =
        (base === 'index' && parent === toMod) ||
        spec.replace(/\\/g, '/').endsWith(`/${toMod}/index.js`) ||
        spec.replace(/\\/g, '/').endsWith(`/${toMod}/index`);

      if (!importingPublic && !isPublic) {
        violations.push(
          `${path.relative(ROOT, file)} -> ${spec} (deep import into module '${toMod}')`,
        );
      }
    }
  }

  if (violations.length) {
    console.error('Module boundary violations:');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log('module-boundaries: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
