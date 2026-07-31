import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOSS_SUCCESS_RADIUS,
  BOSS_SUCCESS_TICK_MS,
  bossSuccessDamage,
  isInsideBossSuccessRange,
} from '../src/game/playerSuccess';

assert.equal(BOSS_SUCCESS_TICK_MS, 100);
assert.equal(BOSS_SUCCESS_RADIUS, 112);
assert.equal(bossSuccessDamage(1), 1);
assert.equal(bossSuccessDamage(50.9), 50);
assert.equal(bossSuccessDamage(Number.NaN), 1);
assert.equal(isInsideBossSuccessRange(0, 0, BOSS_SUCCESS_RADIUS, 0), true);
assert.equal(isInsideBossSuccessRange(0, 0, BOSS_SUCCESS_RADIUS + 0.01, 0), false);
assert.equal(isInsideBossSuccessRange(12, -8, 12, -8), true);

const frontSpine = JSON.parse(readFileSync(
  join(process.cwd(), 'public/assets/characters/player-front.json'),
  'utf8',
)) as { animations?: Record<string, unknown> };
assert.ok(frontSpine.animations?.success, 'front player Spine must provide success animation');

console.log('Player success smoke test passed: 100ms level damage, exact radius, and Spine animation');
