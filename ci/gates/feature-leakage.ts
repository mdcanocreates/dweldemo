/**
 * CI gate: poisoned fixture must fail the (broken) pipeline / be excluded by PIT.
 * Exit 0 on pass, 1 on fail.
 */

import { runFeatureLeakageGate } from '../../src/modules/scoring/index.js';

function main(): void {
  const result = runFeatureLeakageGate();
  if (!result.pass || !result.poisonedFixtureFailsPipeline) {
    console.error('feature-leakage: FAIL');
    console.error(result.detail);
    console.error(JSON.stringify(result.evidence, null, 2));
    process.exit(1);
  }
  console.log('feature-leakage: ok');
  console.log(result.detail);
  console.log(JSON.stringify(result.evidence, null, 2));
}

main();
