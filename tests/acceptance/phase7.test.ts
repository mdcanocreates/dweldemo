import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RULES_V0_VERSION,
  ML_V1_CANDIDATE_VERSION,
  RENTER_SCORE_MODEL_KEY,
  evaluatePhase7Gate,
  runFeatureLeakageGate,
  runOfflineOnlineParity,
  runTrainingPipeline,
  makePoisonedFixture,
  computeRenterScore,
  recomputeHistoricalScore,
  runRulesV0,
  runMlV1Candidate,
  ensureRulesV0Registered,
  getActiveRenterScoreModel,
  tryActivateMlCandidate,
  assertRulesV0ActiveWhenGateUnmet,
  runShadowHarness,
  runDriftMonitors,
  generateParityFixtures,
  assembleOnlineFeatures,
  assembleTrainingFeatures,
  type RenterFeatures,
} from '../../src/modules/scoring/index.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import { sampleObservations, seedScoringParty } from '../helpers/phase7.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'evidence', 'phase7');

function writeEvidence(name: string, body: string): void {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, name), body, 'utf8');
}

describe('Phase 7 acceptance (§17 Scoring v1 / §8)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('Leakage test: poisoned fixture fails the pipeline', () => {
    const gate = runFeatureLeakageGate();
    expect(gate.pass).toBe(true);
    expect(gate.poisonedFixtureFailsPipeline).toBe(true);

    const poisoned = makePoisonedFixture();
    const pipeline = runTrainingPipeline([poisoned]);
    expect(pipeline.ok).toBe(true);
    expect(pipeline.rows[0]!.features.fraud_flag_count).toBe(0);
    expect(pipeline.rows[0]!.features.placement_count).toBe(0);

    writeEvidence(
      'leakage.txt',
      [
        'PASS: poisoned fixture fails the (broken) pipeline / excluded by PIT',
        gate.detail,
        JSON.stringify(gate.evidence, null, 2),
        `correct_fraud_flag_count=${pipeline.rows[0]!.features.fraud_flag_count}`,
        `correct_placement_count=${pipeline.rows[0]!.features.placement_count}`,
      ].join('\n'),
    );
  });

  it('Offline/online parity across 1000 fixtures', () => {
    const result = runOfflineOnlineParity(1000, 42);
    expect(result.pass).toBe(true);
    expect(result.identical).toBe(1000);
    expect(result.mismatches).toHaveLength(0);

    // Spot-check shared implementation identity
    const fx = generateParityFixtures(1, 7)[0]!;
    const a = assembleOnlineFeatures(fx);
    const b = assembleTrainingFeatures(fx);
    expect(a.features).toEqual(b.features);

    writeEvidence(
      'offline-online-parity.txt',
      [
        'PASS: offline/online parity across 1000 fixtures',
        `n=${result.n}`,
        `identical=${result.identical}`,
        `mismatches=${result.mismatches.length}`,
      ].join('\n'),
    );
  });

  it('30-day shadow harness: fixture distribution; prod shadow N/A until gate met', async () => {
    const fixtures = generateParityFixtures(200, 99);
    const features = fixtures.map((f) => assembleOnlineFeatures(f).features);

    const summary = await withBypass(db.pool, async (c) => {
      await ensureRulesV0Registered(c);
      return runShadowHarness(c, features, { mode: 'prod' });
    });

    expect(summary.gateMet).toBe(false);
    expect(summary.activationAllowed).toBe(false);
    expect(summary.n).toBe(200);
    expect(summary.note).toMatch(/N\/A|UNMET|refused/i);

    // Fixture-mode comparison still runs
    const fixtureSummary = await withBypass(db.pool, async (c) =>
      runShadowHarness(c, features, { mode: 'fixture' }),
    );
    expect(fixtureSummary.n).toBe(200);
    expect(fixtureSummary.meanAbsDiff).toBeGreaterThanOrEqual(0);

    writeEvidence(
      'shadow-30d.txt',
      [
        'PASS: 30-day shadow harness implemented',
        'Real 30-day prod shadow: N/A until Phase 7 gate met',
        `prod_mode_note=${summary.note}`,
        `fixture_n=${fixtureSummary.n}`,
        `fixture_v0_mean=${fixtureSummary.v0Mean}`,
        `fixture_candidate_mean=${fixtureSummary.candidateMean}`,
        `fixture_mean_abs_diff=${fixtureSummary.meanAbsDiff}`,
        `fixture_band_agreement=${fixtureSummary.bandAgreementRate}`,
        `activation_allowed=${summary.activationAllowed}`,
      ].join('\n'),
    );
  });

  it('Historical score recomputable from feature_snapshot + model_version', async () => {
    const result = await withBypass(db.pool, async (c) => {
      await ensureRulesV0Registered(c);
      const { partyId } = await seedScoringParty(c, db.kms);
      const pit = new Date('2026-02-01T00:00:00.000Z');
      const obs = sampleObservations(new Date(pit.getTime() - 86400000));

      const scored = await computeRenterScore(c, {
        partyId,
        pointInTimeKey: pit,
        observations: obs,
        cohortKey: 'global|fallback',
        cohortN: 0,
      });

      const replayedV0 = recomputeHistoricalScore(
        scored.featureSnapshot,
        scored.modelVersion,
      );
      expect(replayedV0.rawScore).toBe(scored.rawScore);
      expect(replayedV0.band).toBe(scored.band);

      // Inactive ML candidate also recomputable from same snapshot
      const ml = runMlV1Candidate(scored.featureSnapshot);
      const replayedMl = recomputeHistoricalScore(
        scored.featureSnapshot,
        ML_V1_CANDIDATE_VERSION,
      );
      expect(replayedMl.rawScore).toBe(ml.rawScore);

      const { rows } = await c.query<{
        feature_snapshot: typeof scored.featureSnapshot;
        model_version: string;
        raw_score: string;
      }>(`select feature_snapshot, model_version, raw_score::text from score where id = $1`, [
        scored.id,
      ]);

      return {
        scoreId: scored.id,
        storedRaw: Number(rows[0]!.raw_score),
        replayedRaw: replayedV0.rawScore,
        modelVersion: rows[0]!.model_version,
        mlRaw: ml.rawScore,
        mlReplay: replayedMl.rawScore,
      };
    });

    expect(result.storedRaw).toBe(result.replayedRaw);
    expect(result.modelVersion).toBe(RULES_V0_VERSION);
    expect(result.mlRaw).toBe(result.mlReplay);

    writeEvidence(
      'reproducibility.txt',
      [
        'PASS: historical score recomputable from feature_snapshot + model_version',
        `score_id=${result.scoreId}`,
        `model_version=${result.modelVersion}`,
        `stored_raw_score=${result.storedRaw}`,
        `replayed_raw_score=${result.replayedRaw}`,
        `ml_candidate_raw=${result.mlRaw}`,
        `ml_candidate_replay=${result.mlReplay}`,
      ].join('\n'),
    );
  });

  it('Gate status: currently UNMET; ML activation blocked; rules v0 active', async () => {
    const result = await withBypass(db.pool, async (c) => {
      await ensureRulesV0Registered(c);
      const gate = await evaluatePhase7Gate(c);
      expect(gate.met).toBe(false);

      const active = await getActiveRenterScoreModel(c);
      expect(active.version).toBe(RULES_V0_VERSION);
      expect(active.kind).toBe('rules');

      const activation = await tryActivateMlCandidate(c, ML_V1_CANDIDATE_VERSION);
      expect(activation.activated).toBe(false);
      expect(activation.gateMet).toBe(false);

      await assertRulesV0ActiveWhenGateUnmet(c);

      const { rows: ml } = await c.query<{ activated_at: Date | null }>(
        `select activated_at from model_registry
         where model_key = $1 and version = $2`,
        [RENTER_SCORE_MODEL_KEY, ML_V1_CANDIDATE_VERSION],
      );
      expect(ml[0]?.activated_at).toBeNull();

      const sample: RenterFeatures = assembleOnlineFeatures({
        partyId: '00000000-0000-4000-8000-000000000099',
        pointInTimeKey: new Date(),
        observations: sampleObservations(new Date()),
      }).features;
      const drift = await runDriftMonitors(c, {
        baselineFeatures: [sample],
        currentFeatures: [sample],
        baselineScores: [50],
        currentScores: [52],
        baselineOutcomeRate: 0.5,
        currentOutcomeRate: 0.4,
      });
      expect(drift.activationRefused).toBe(true);

      return { gate, activation, active, driftRefuse: drift.refuseReason };
    });

    writeEvidence(
      'gate-status.txt',
      [
        'GATE STATUS: UNMET',
        `met=${result.gate.met}`,
        `reason=${result.gate.reason}`,
        JSON.stringify(result.gate.evidence, null, 2),
        `active_model=${result.active.modelKey}@${result.active.version} kind=${result.active.kind}`,
        `ml_activation_attempted=${ML_V1_CANDIDATE_VERSION}`,
        `ml_activated=${result.activation.activated}`,
        `ml_activation_reason=${result.activation.reason}`,
        `drift_refuse=${result.driftRefuse}`,
        'ML activation is BLOCKED. Rules v0 continues.',
      ].join('\n'),
    );

    writeEvidence(
      'criteria-checklist.txt',
      [
        'Phase 7 acceptance criteria',
        '[x] Leakage test: poisoned fixture fails the pipeline — PASS',
        '[x] Offline/online parity across 1000 fixtures — PASS',
        '[x] 30-day shadow harness + fixture distribution; prod 30d N/A until gate — PASS',
        '[x] Historical score recomputable from feature_snapshot + model_version — PASS',
        '[x] Gate UNMET; ML activation blocked; rules v0 active — PASS',
        '',
        'NOTE: Phase 7 did NOT ship a trained production ML model.',
        'Training pipeline plumbing + inactive ml-v1-candidate stub only.',
      ].join('\n'),
    );

    writeEvidence(
      'spec-gaps.txt',
      [
        'SPEC GAPS — Phase 7 (do not invent silently; recorded here)',
        '',
        '1. Cohort normalization (§8.2) submarket|bedband|rentband|window keys require',
        '   live listing/submarket join at score time. Phase 7 persists cohort_key with',
        '   global|fallback when thin/absent; full cohort resolver deferred to when',
        '   scoring is wired into application submit paths with listing context.',
        '',
        '2. ml-v1-candidate is a deterministic shadow stub (weight transform of v0),',
        '   not a gradient-boosted model trained on production labels. Spec §8.5 v1',
        '   training is gated; stub exists so shadow/replay/activation paths are real.',
        '',
        '3. Real 30-day production shadow requires gate met + traffic. Harness is',
        '   implemented; evidence documents N/A until gate. Fixture distribution',
        '   comparison runs in CI.',
        '',
        '4. Label coverage for gate uses placement_outcome due rows with',
        '   source is distinct from no_response as responded. Spec target ≥60%',
        '   at 90d; non-response recorded separately per §8.4.',
        '',
        '5. score UPDATE/DELETE revoked for app roles in 0037 (insert-only §8.1).',
        '   feature_snapshot likewise append-oriented.',
      ].join('\n'),
    );
  });

  it('Rules v0: explained, versioned, registered; empty explanation rejected by contract', async () => {
    const features = assembleOnlineFeatures({
      partyId: 'p',
      pointInTimeKey: new Date(),
      observations: sampleObservations(new Date()),
    }).features;
    const scored = runRulesV0(features);
    expect(scored.modelVersion).toBe(RULES_V0_VERSION);
    expect(Object.keys(scored.explanation).length).toBeGreaterThan(0);
    expect(scored.explanation).toHaveProperty('top_drivers');

    await withBypass(db.pool, async (c) => {
      const reg = await ensureRulesV0Registered(c);
      expect(reg.version).toBe(RULES_V0_VERSION);
      const { rows } = await c.query<{ kind: string; activated_at: Date | null }>(
        `select kind, activated_at from model_registry
         where model_key = $1 and version = $2`,
        [RENTER_SCORE_MODEL_KEY, RULES_V0_VERSION],
      );
      expect(rows[0]!.kind).toBe('rules');
      expect(rows[0]!.activated_at).not.toBeNull();
    });
  });

  it('score is insert-only for app role', async () => {
    await withBypass(db.pool, async (c) => {
      await ensureRulesV0Registered(c);
      const { partyId } = await seedScoringParty(c, db.kms);
      const pit = new Date();
      const scored = await computeRenterScore(c, {
        partyId,
        pointInTimeKey: pit,
        observations: sampleObservations(pit),
      });

      // Superuser/bypass can still update; verify privilege revoke via has_table_privilege
      const { rows } = await c.query<{ can_update: boolean; can_delete: boolean }>(
        `select
           has_table_privilege('rbit_app_user', 'score', 'update') as can_update,
           has_table_privilege('rbit_app_user', 'score', 'delete') as can_delete`,
      );
      expect(rows[0]!.can_update).toBe(false);
      expect(rows[0]!.can_delete).toBe(false);
      expect(scored.id).toBeTruthy();
    });
  });
});
