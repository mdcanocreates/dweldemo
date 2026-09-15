/**
 * Offline/online parity (§8.3): one feature-assembly implementation;
 * both paths must yield identical features across fixtures.
 */

import {
  assembleOnlineFeatures,
  assembleTrainingFeatures,
  featuresEqual,
} from './features.js';
import { generateParityFixtures } from './fixtures.js';

export type ParityResult = {
  n: number;
  identical: number;
  mismatches: Array<{ id: string; online: unknown; offline: unknown }>;
  pass: boolean;
};

export function runOfflineOnlineParity(n = 1000, seed = 42): ParityResult {
  const fixtures = generateParityFixtures(n, seed);
  const mismatches: ParityResult['mismatches'] = [];
  let identical = 0;

  for (const fx of fixtures) {
    const online = assembleOnlineFeatures(fx);
    const offline = assembleTrainingFeatures(fx);
    if (featuresEqual(online.features, offline.features)) {
      identical += 1;
    } else {
      mismatches.push({
        id: fx.id,
        online: online.features,
        offline: offline.features,
      });
    }
  }

  return {
    n,
    identical,
    mismatches,
    pass: mismatches.length === 0 && identical === n,
  };
}
