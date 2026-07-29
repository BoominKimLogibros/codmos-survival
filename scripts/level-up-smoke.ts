import assert from 'node:assert/strict';
import { advanceOneLevelIfReady, experienceToNextLevel } from '../src/game/progression';

// Regression fixture based on codmos-김부민2.codmos plus its tier-2 boss XP.
// The reward crosses two thresholds, so the game must show two sequential
// choices instead of trying to relaunch the same scene before it shuts down.
const stats = {
  level: 20,
  xp: 224 + 405,
  xpToNext: experienceToNextLevel(20),
};

assert.equal(stats.xpToNext, 197);
assert.equal(advanceOneLevelIfReady(stats), true);
assert.deepEqual(stats, { level: 21, xp: 432, xpToNext: 231 });
assert.equal(advanceOneLevelIfReady(stats), true);
assert.deepEqual(stats, { level: 22, xp: 201, xpToNext: 270 });
assert.equal(advanceOneLevelIfReady(stats), false);

const corrupted = { level: 20, xp: 500, xpToNext: 0 };
assert.equal(advanceOneLevelIfReady(corrupted), false);

console.log('Level-up smoke test passed: imported profile, boss XP cascade, one-choice-per-level guard');
