import assert from 'node:assert/strict';
import { ADAPTIVE_DIFFICULTY_INTERVAL_MS } from '../src/config/constants';
import { createDefaultGameState } from '../src/config/defaultState';
import { AdaptiveDifficultyController } from '../src/game/AdaptiveDifficultyController';
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
assert.equal(fastState.hpMultiplier, 1);
assert.ok(fastState.bossKillInterval < 1000);

fast.recordRegularSpawn(200);
const secondFast = fast.update(ADAPTIVE_DIFFICULTY_INTERVAL_MS, 0, 320);
assert.equal(secondFast?.pressure, 'fast');
assert.ok(fastState.hpMultiplier > 1);
assert.match(secondFast?.message ?? '', /체력/);
assert.equal(fast.isBossDue(fastState.bossKillInterval, false, 10), true);
fast.recordBossSpawn(fastState.bossKillInterval);
assert.equal(fast.isBossDue(fastState.bossKillInterval, false, 10), false);

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
const capped = new AdaptiveDifficultyController(capState, 0);
assert.equal(capped.nextBatchSize(990, 900), 10);
assert.equal(capped.nextBatchSize(1000, 900), 0);

const deathState = createInitialAdaptiveDifficultyState();
deathState.bossKillInterval = 500;
const afterDeath = new AdaptiveDifficultyController(deathState, 0);
assert.equal(afterDeath.reduceAfterDeath(), 0.9);
assert.equal(deathState.deathDifficultyMultiplier, 0.9);
assert.equal(afterDeath.effectiveHpMultiplier(), 0.9);
assert.equal(afterDeath.effectiveActiveTarget(), 72);
assert.equal(afterDeath.effectiveBossKillInterval(), 556);
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

console.log('Adaptive difficulty smoke test passed: scaling, death reduction, pause/resume, boss timing, 1000 cap, rune crowd chance, save migration');
