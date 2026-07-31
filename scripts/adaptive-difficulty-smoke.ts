import assert from 'node:assert/strict';
import { ADAPTIVE_DIFFICULTY_INTERVAL_MS } from '../src/config/constants';
import { createDefaultGameState } from '../src/config/defaultState';
import {
  AdaptiveDifficultyController,
  classifyDifficultyGrowth,
  difficultyEffectiveLevel,
  scaleHealthPreservingRatio,
  strongestDifficultyGrowthProfile,
} from '../src/game/AdaptiveDifficultyController';
import { getRuneSpawnChance } from '../src/game/runeSpawn';
import { createInitialAdaptiveDifficultyState } from '../src/game/types';
import { normalizeSaveState } from '../src/services/saveService';

const fastState = createInitialAdaptiveDifficultyState();
const fast = new AdaptiveDifficultyController(fastState, 0);
fast.recordRegularSpawn(120);
const firstFast = fast.update(ADAPTIVE_DIFFICULTY_INTERVAL_MS, 0, 120);
assert.equal(firstFast?.pressure, 'fast');
assert.equal(fastState.activeTarget, 120);
assert.equal(fastState.spawnBatchSize, 5);
assert.ok(Math.abs(fastState.hpMultiplier - 1.1) < Number.EPSILON);
assert.ok(fastState.bossKillInterval < 1000);

fast.recordRegularSpawn(200);
const secondFast = fast.update(ADAPTIVE_DIFFICULTY_INTERVAL_MS, 0, 320);
assert.equal(secondFast?.pressure, 'fast');
assert.ok(Math.abs(fastState.hpMultiplier - 1.21) < 1e-12);
assert.equal(secondFast?.bossCount, 2);
assert.equal(fast.effectiveBossCount(), 2);
assert.match(secondFast?.message ?? '', /동시에 2마리/);
assert.equal(fast.isBossDue(fastState.bossKillInterval, false, 10), true);
fast.recordBossSpawn(fastState.bossKillInterval);
assert.equal(fast.isBossDue(fastState.bossKillInterval, false, 10), false);
const steadyAfterFast = fast.update(ADAPTIVE_DIFFICULTY_INTERVAL_MS, 0, 320);
assert.equal(steadyAfterFast?.pressure, 'steady');
assert.equal(steadyAfterFast?.bossCount, 1);
assert.equal(fast.effectiveBossCount(), 1);
assert.deepEqual(scaleHealthPreservingRatio(50, 100, 1.1), { hp: 55, maxHp: 110 });
assert.deepEqual(scaleHealthPreservingRatio(1, 3, 1.1), { hp: 1, maxHp: 3 });

assert.equal(difficultyEffectiveLevel({ level: 20, enhancementLevel: 10 }), 30);
assert.equal(classifyDifficultyGrowth({ level: 1, enhancementLevel: 0 }), 'slight');
assert.equal(classifyDifficultyGrowth({ level: 10, enhancementLevel: 0 }), 'medium');
assert.equal(classifyDifficultyGrowth({ level: 20, enhancementLevel: 5 }), 'large');
assert.equal(classifyDifficultyGrowth({ level: 2, enhancementLevel: 48 }), 'extreme');
assert.equal(classifyDifficultyGrowth({ level: Number.NaN, enhancementLevel: Number.NaN }), 'slight');
assert.deepEqual(strongestDifficultyGrowthProfile([
  { level: 30, enhancementLevel: 3 },
  { level: 20, enhancementLevel: 20 },
  { level: 40, enhancementLevel: 0 },
]), { level: 20, enhancementLevel: 20 });

const slightGrowthState = createInitialAdaptiveDifficultyState();
const slightGrowth = new AdaptiveDifficultyController(slightGrowthState, 0);
const slightAdjustment = slightGrowth.syncPlayerGrowth({ level: 1, enhancementLevel: 0 });
assert.equal(slightAdjustment?.tier, 'slight');
assert.equal(slightGrowthState.hpMultiplier, 1.1);
assert.equal(slightGrowthState.activeTarget, 90);
assert.equal(slightGrowthState.spawnBatchSize, 3);
assert.equal(slightGrowthState.spawnIntervalMs, 1400);
assert.equal(slightGrowthState.bossKillInterval, 950);
assert.equal(slightGrowth.syncPlayerGrowth({ level: 9, enhancementLevel: 0 }), null);

const mediumGrowthState = createInitialAdaptiveDifficultyState();
const mediumGrowth = new AdaptiveDifficultyController(mediumGrowthState, 0);
assert.equal(mediumGrowth.syncPlayerGrowth({ level: 7, enhancementLevel: 3 })?.tier, 'medium');
assert.equal(mediumGrowthState.hpMultiplier, 1.35);
assert.equal(mediumGrowthState.activeTarget, 110);
assert.equal(mediumGrowthState.spawnBatchSize, 5);
assert.equal(mediumGrowthState.spawnIntervalMs, 1200);
assert.equal(mediumGrowthState.bossKillInterval, 850);
assert.equal(mediumGrowth.syncPlayerGrowth({ level: 20, enhancementLevel: 10 })?.tier, 'large');
assert.equal(mediumGrowthState.hpMultiplier, 1.8);
assert.equal(mediumGrowthState.activeTarget, 145);
assert.equal(mediumGrowthState.spawnBatchSize, 7);
assert.equal(mediumGrowthState.spawnIntervalMs, 900);
assert.equal(mediumGrowthState.bossKillInterval, 650);
assert.equal(mediumGrowth.syncPlayerGrowth({ level: 1, enhancementLevel: 0 })?.tier, 'slight');
assert.equal(mediumGrowthState.hpMultiplier, 1.8);

const extremeGrowthState = createInitialAdaptiveDifficultyState();
const extremeGrowth = new AdaptiveDifficultyController(extremeGrowthState, 0);
const extremeAdjustment = extremeGrowth.syncPlayerGrowth({ level: 30, enhancementLevel: 20 });
assert.equal(extremeAdjustment?.effectiveLevel, 50);
assert.match(extremeAdjustment?.message ?? '', /매우 큰 상향/);
assert.equal(extremeGrowthState.hpMultiplier, 2.6);
assert.equal(extremeGrowthState.activeTarget, 200);
assert.equal(extremeGrowthState.spawnBatchSize, 10);
assert.equal(extremeGrowthState.spawnIntervalMs, 650);
assert.equal(extremeGrowthState.bossKillInterval, 450);
extremeGrowth.recordRegularSpawn(300);
const extremeFast = extremeGrowth.update(ADAPTIVE_DIFFICULTY_INTERVAL_MS, 0, 300);
assert.equal(extremeFast?.pressure, 'fast');
assert.ok(Math.abs(extremeGrowthState.hpMultiplier - 3.51) < 1e-12);
assert.equal(extremeGrowthState.activeTarget, 330);
assert.equal(extremeGrowthState.spawnBatchSize, 16);
assert.equal(extremeGrowthState.spawnIntervalMs, 442);
assert.equal(extremeGrowthState.bossKillInterval, 270);
assert.match(extremeFast?.message ?? '', /매우 큰 상향/);

const hpCapState = createInitialAdaptiveDifficultyState();
hpCapState.hpMultiplier = 11.9;
const hpCap = new AdaptiveDifficultyController(hpCapState, 0);
hpCap.recordRegularSpawn(120);
hpCap.update(ADAPTIVE_DIFFICULTY_INTERVAL_MS, 0, 120);
assert.equal(hpCapState.hpMultiplier, 12);

const overwhelmedState = createInitialAdaptiveDifficultyState();
const overwhelmed = new AdaptiveDifficultyController(overwhelmedState, 0);
overwhelmed.recordRegularSpawn(80);
const stopped = overwhelmed.update(ADAPTIVE_DIFFICULTY_INTERVAL_MS, 80, 0);
assert.equal(stopped?.pressure, 'overwhelmed');
assert.equal(overwhelmedState.spawnPaused, true);
assert.equal(overwhelmed.canSpawn(80, 80), false);
assert.ok(overwhelmedState.activeTarget < 80);

const resumed = overwhelmed.update(ADAPTIVE_DIFFICULTY_INTERVAL_MS, 60, 20);
assert.equal(resumed?.pressure, 'steady');
assert.equal(overwhelmedState.spawnPaused, false);
assert.match(resumed?.message ?? '', /다시 시작/);

const capState = createInitialAdaptiveDifficultyState();
capState.activeTarget = 1000;
capState.spawnBatchSize = 40;
capState.consecutiveFastWindows = 100;
const capped = new AdaptiveDifficultyController(capState, 0);
assert.equal(capped.nextBatchSize(990, 900), 10);
assert.equal(capped.nextBatchSize(1000, 900), 0);
assert.equal(capped.effectiveBossCount(), 5);

const deathState = createInitialAdaptiveDifficultyState();
deathState.bossKillInterval = 500;
const afterDeath = new AdaptiveDifficultyController(deathState, 0);
assert.equal(afterDeath.reduceAfterDeath(), 0.9);
assert.equal(deathState.deathDifficultyMultiplier, 0.9);
assert.equal(afterDeath.effectiveHpMultiplier(), 0.9);
assert.equal(afterDeath.effectiveActiveTarget(), 72);
assert.equal(afterDeath.effectiveBossKillInterval(), 556);
assert.equal(afterDeath.effectiveBossCount(), 1);
assert.equal(afterDeath.reduceAfterDeath(), 0.9);
assert.ok(Math.abs(deathState.deathDifficultyMultiplier - 0.81) < Number.EPSILON);

const legacyState = createDefaultGameState() as unknown as {
  progression: { adaptiveDifficulty?: unknown };
};
delete legacyState.progression.adaptiveDifficulty;
const migrated = normalizeSaveState(legacyState);
assert.deepEqual(migrated.progression.adaptiveDifficulty, createInitialAdaptiveDifficultyState());

const resumedState = createDefaultGameState();
resumedState.progression.adaptiveDifficulty.activeTarget = 240;
resumedState.progression.adaptiveDifficulty.hpMultiplier = 1.25;
resumedState.progression.adaptiveDifficulty.deathDifficultyMultiplier = 0.81;
const normalizedResume = normalizeSaveState(resumedState);
assert.equal(normalizedResume.progression.adaptiveDifficulty.activeTarget, 240);
assert.equal(normalizedResume.progression.adaptiveDifficulty.hpMultiplier, 1.25);
assert.equal(normalizedResume.progression.adaptiveDifficulty.deathDifficultyMultiplier, 0.81);

assert.equal(getRuneSpawnChance(0), 0.5);
assert.equal(getRuneSpawnChance(100), 0.5);
assert.equal(getRuneSpawnChance(200), 0.55);
assert.equal(getRuneSpawnChance(500), 0.7);
assert.equal(getRuneSpawnChance(1000), 0.95);
assert.equal(getRuneSpawnChance(2000), 0.95);
assert.equal(getRuneSpawnChance(Number.NaN), 0.5);

console.log('Adaptive difficulty smoke test passed: growth tiers, scaling, repeated-fast boss count, death reduction, pause/resume, boss timing, 1000 cap, rune crowd chance, save migration');
