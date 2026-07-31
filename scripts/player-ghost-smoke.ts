import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { playerGhostAnimation } from '../src/game/playerGhost';
import { REVIVE_DURATION_MS, REVIVE_RADIUS, shouldShowReviveMarker } from '../src/game/revive';
import {
  DEATH_MARKER_DROP_DURATION_MS,
  DEATH_MARKER_FADE_DURATION_MS,
} from '../src/objects/DeathMarker';

assert.deepEqual(playerGhostAnimation('death'), { name: 'failure', loop: false });
assert.deepEqual(playerGhostAnimation('departure'), { name: 'idle', loop: true });
assert.equal(REVIVE_DURATION_MS, 10_000);
assert.equal(REVIVE_RADIUS, 68);
assert.equal(shouldShowReviveMarker(undefined), false);
assert.equal(shouldShowReviveMarker('player-2'), true);
assert.equal(DEATH_MARKER_DROP_DURATION_MS, 520);
assert.equal(DEATH_MARKER_FADE_DURATION_MS, 460);

const frontSpine = JSON.parse(readFileSync(
  join(process.cwd(), 'public/assets/characters/player-front.json'),
  'utf8',
)) as { animations?: Record<string, unknown> };
assert.ok(frontSpine.animations?.failure, 'front player Spine must provide failure animation');

console.log('Player ghost smoke test passed: opaque failure pose, one-shot tombstone, and 10s prayer revive rules');
