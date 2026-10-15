/**
 * Static safety gate for Dwel staging Terraform.
 * Run: npm run ci:staging-terraform-static
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'terraform');
const STAGING_ENV = join(ROOT, 'envs', 'staging');
const MODULE = join(ROOT, 'modules', 'dwel_staging_attachment');

function walkTf(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === '.terraform') continue;
      out.push(...walkTf(p));
    } else if (name.endsWith('.tf')) {
      out.push(p);
    }
  }
  return out;
}

function fail(msg: string): never {
  console.error(`staging-terraform-static: FAIL — ${msg}`);
  process.exit(1);
}

const files = [...walkTf(STAGING_ENV), ...walkTf(MODULE)];
if (files.length === 0) fail('no .tf files found under staging paths');

const combined = files.map((f) => readFileSync(f, 'utf8')).join('\n');

const prohibitedTypes = [
  'aws_vpc',
  'aws_nat_gateway',
  'aws_eip',
  'aws_ecs_cluster',
  'aws_elasticache_serverless_cache',
  'aws_elasticache_cluster',
  'aws_lb',
  'aws_lb_listener',
];

for (const type of prohibitedTypes) {
  const re = new RegExp(`resource\\s+"${type}"\\s+"`, 'g');
  if (re.test(combined)) {
    fail(`prohibited resource type found: ${type}`);
  }
}

if (/aliases\s*=\s*\[[^\]]*dwel\.rbitfinancial\.com/.test(combined)) {
  fail('CloudFront aliases must not include production hostname');
}

const required: Array<{ file: string; needle: string }> = [
  { file: join(MODULE, 'alb.tf'), needle: '/health/live' },
  { file: join(MODULE, 'alb.tf'), needle: 'host_header' },
  { file: join(MODULE, 'ecs.tf'), needle: 'APP_ENV' },
  { file: join(MODULE, 'ecs.tf'), needle: 'staging' },
  { file: join(MODULE, 'main.tf'), needle: 'Product     = "dwel"' },
  { file: join(MODULE, 'main.tf'), needle: 'Environment = "staging"' },
  { file: join(MODULE, 'main.tf'), needle: 'Owner' },
  { file: join(MODULE, 'cloudfront.tf'), needle: 'Forward viewer Host' },
  { file: join(STAGING_ENV, 'main.tf'), needle: 'creates_vpc' },
];

for (const req of required) {
  const body = readFileSync(req.file, 'utf8');
  if (!body.includes(req.needle)) {
    fail(`missing required fragment in ${req.file}: ${req.needle}`);
  }
}

const vars = readFileSync(join(STAGING_ENV, 'variables.tf'), 'utf8');
if (!vars.includes('validate-only-do-not-apply')) {
  fail('staging variables.tf must keep validate-only default image');
}

const backendExample = readFileSync(join(STAGING_ENV, 'backend.hcl.example'), 'utf8');
if (!backendExample.includes('PLACEHOLDER_REPLACE')) {
  fail('backend.hcl.example must mark PLACEHOLDER_REPLACE values');
}

console.log('staging-terraform-static: ok');
console.log(`  scanned ${files.length} .tf files`);
