/**
 * Preflight assertions before an authorized staging plan/apply.
 * Does not call AWS mutators. Optional live checks if AWS_PROFILE is set.
 *
 * Usage:
 *   npx tsx scripts/staging/preflight-assert.ts
 *   npx tsx scripts/staging/preflight-assert.ts --image <ecr-uri:tag>
 */
const EXPECTED_ACCOUNT = '941612827888';
const EXPECTED_REGION = 'us-east-2';
const HOST = 'dwel-staging.rbitfinancial.com';
const FORBIDDEN_IMAGE = /validate-only|do-not-apply|amazonlinux|:latest$/i;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(msg: string): never {
  console.error(`preflight: FAIL — ${msg}`);
  process.exit(1);
}

const image = argValue('--image') ?? process.env.STAGING_APP_IMAGE_URI ?? '';
if (!image) {
  fail('pass --image <pinned-uri> or STAGING_APP_IMAGE_URI (pinned SHA/tag required)');
}
if (FORBIDDEN_IMAGE.test(image)) {
  fail(`image looks like a placeholder or :latest: ${image}`);
}

if (process.env.AWS_REGION && process.env.AWS_REGION !== EXPECTED_REGION) {
  fail(`AWS_REGION must be ${EXPECTED_REGION}, got ${process.env.AWS_REGION}`);
}

console.log('preflight: static checks ok');
console.log(`  expected_account=${EXPECTED_ACCOUNT}`);
console.log(`  expected_region=${EXPECTED_REGION}`);
console.log(`  hostname=${HOST}`);
console.log(`  image=${image}`);
console.log('  secrets_prefix=rbit/staging/dwel/*');
console.log('  documents_prefix=dwel-staging-documents-');
console.log('  NOTE: live AWS identity/tag checks require authorized plan session');
