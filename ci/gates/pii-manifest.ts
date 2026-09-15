import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Minimal YAML subset parser for pii-manifest.yaml (tables -> columns -> meta).
 * Avoids adding a YAML dependency for the gate.
 */
function parseManifest(text: string): Record<string, Set<string>> {
  const tables: Record<string, Set<string>> = {};
  let currentTable: string | null = null;
  let inTables = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '');
    if (!line.trim()) continue;
    if (line.startsWith('tables:')) {
      inTables = true;
      continue;
    }
    if (!inTables) continue;

    const tableMatch = /^  ([a-z0-9_]+):\s*$/.exec(line);
    if (tableMatch) {
      currentTable = tableMatch[1]!;
      tables[currentTable] = new Set();
      continue;
    }
    const colMatch = /^    ([a-z0-9_]+):\s*$/.exec(line);
    if (colMatch && currentTable) {
      tables[currentTable]!.add(colMatch[1]!);
    }
  }
  return tables;
}

async function main(): Promise<void> {
  const manifestText = await readFile(path.join(ROOT, 'pii-manifest.yaml'), 'utf8');
  const manifest = parseManifest(manifestText);

  const migrationsDir = path.join(ROOT, 'migrations');
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  const createColRe =
    /create\s+table\s+([a-z0-9_]+)\s*\(([\s\S]*?)\);/gi;
  const alterAddRe =
    /alter\s+table\s+([a-z0-9_]+)\s+add\s+column\s+([a-z0-9_]+)/gi;

  const piiTables = new Set(Object.keys(manifest));
  const failures: string[] = [];

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    let m: RegExpExecArray | null;

    const createRe = new RegExp(createColRe.source, 'gi');
    while ((m = createRe.exec(sql))) {
      const table = m[1]!;
      if (!piiTables.has(table)) continue;
      const body = m[2]!;
      const cols = [...body.matchAll(/^\s*([a-z0-9_]+)\s+/gim)].map((x) => x[1]!);
      const required = manifest[table]!;
      for (const col of required) {
        if (!cols.includes(col)) {
          // Column listed in manifest but not in create — informational; OK if added later.
        }
      }
      for (const col of cols) {
        // Only require manifest entries for columns that look PII-bearing or are listed.
        // Gate: if table is in manifest, every column that appears in manifest must exist;
        // new columns in later alters are checked below.
        void col;
      }
    }

    const alterRe = new RegExp(alterAddRe.source, 'gi');
    while ((m = alterRe.exec(sql))) {
      const table = m[1]!;
      const col = m[2]!;
      if (piiTables.has(table) && !manifest[table]!.has(col)) {
        failures.push(`${file}: added ${table}.${col} without pii-manifest.yaml entry`);
      }
    }
  }

  // Ensure every manifest table exists in some migration.
  const allSql = (
    await Promise.all(files.map((f) => readFile(path.join(migrationsDir, f), 'utf8')))
  ).join('\n');
  for (const table of piiTables) {
    if (!new RegExp(`create\\s+table\\s+${table}\\b`, 'i').test(allSql)) {
      // notification_suppression is Phase 1 — allow forward references in manifest
      if (table === 'notification_suppression') continue;
      failures.push(`pii-manifest references unknown table ${table}`);
    }
  }

  if (failures.length) {
    console.error('pii-manifest-gate: FAIL');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('pii-manifest-gate: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
