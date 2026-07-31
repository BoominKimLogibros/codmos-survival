import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MONSTER_PORTAL_DURATION_MS,
  MONSTER_PORTAL_EMERGE_DURATION_MS,
  isMonsterEnteringPortal,
  monsterPortalRemainingMs,
} from '../src/game/enemySpawn';

assert.equal(MONSTER_PORTAL_DURATION_MS, 1_333);
assert.equal(MONSTER_PORTAL_EMERGE_DURATION_MS, 500);
assert.equal(monsterPortalRemainingMs(2_000, 1_200), 800);
assert.equal(monsterPortalRemainingMs(2_000, 2_001), 0);
assert.equal(isMonsterEnteringPortal(2_000, 1_999), true);
assert.equal(isMonsterEnteringPortal(2_000, 2_000), false);

const effectDirectory = join(process.cwd(), 'public/assets/effects');
const portalJson = JSON.parse(
  readFileSync(join(effectDirectory, 'monster-portal.json'), 'utf8'),
) as { animations?: Record<string, unknown> };
assert.ok(portalJson.animations?.idle_round);
assert.ok(portalJson.animations?.idle_square);
const portalAtlas = readFileSync(join(effectDirectory, 'monster-portal.atlas'), 'utf8');
assert.equal(portalAtlas.trimStart().split(/\r?\n/, 1)[0], 'monster-portal.png');

console.log('Enemy spawn smoke test passed: portal timing, combat gate helpers, and local Spine assets');
