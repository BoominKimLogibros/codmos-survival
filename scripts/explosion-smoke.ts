import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createPlayerViewportBounds,
  EXPLOSION_FUSE_DURATION_MS,
  fallbackExplosionPoint,
  isPointInExplosionBounds,
  selectVisibleExplosionTargets,
} from '../src/game/ExplosionTargeting';
import { isCombatEffectPayload } from '../src/network/gameProtocol';

const bounds = createPlayerViewportBounds(0, 0, 800, 600, 2048, 88);
assert.deepEqual(bounds, { left: -312, right: 312, top: -212, bottom: 212 });

const enemies = [
  { id: 'cluster-a', x: 90, y: 10 },
  { id: 'cluster-b', x: 110, y: 8 },
  { id: 'spread', x: -220, y: 20 },
  { id: 'offscreen', x: 700, y: 0 },
];
const selected = selectVisibleExplosionTargets(enemies, bounds, 60, 2, { x: 0, y: 0 });
assert.equal(selected.length, 2);
assert.equal(selected[0].id, 'cluster-a');
assert.equal(selected.some((target) => target.id === 'offscreen'), false);
assert.equal(selected.every((target) => isPointInExplosionBounds(target, bounds)), true);

const edgeBounds = createPlayerViewportBounds(1000, 900, 800, 600, 2048, 80);
const fallback = fallbackExplosionPoint(edgeBounds, { x: 1000, y: 900 }, 0, 1, true);
assert.equal(isPointInExplosionBounds(fallback, edgeBounds), true);
assert.equal(EXPLOSION_FUSE_DURATION_MS, 1000);

const networkEffect = {
  type: 'explosion',
  startX: 10,
  startY: 20,
  x: 140,
  y: 160,
  radius: 72,
  flightDurationMs: 500,
  fuseDurationMs: 1000,
};
assert.equal(isCombatEffectPayload(networkEffect), true);
assert.equal(isCombatEffectPayload({ ...networkEffect, x: Number.NaN }), false);
assert.equal(isCombatEffectPayload({ ...networkEffect, radius: 0 }), false);
assert.equal(isCombatEffectPayload({ type: 'explosion' }), false);

const spineJson = JSON.parse(readFileSync(
  'public/assets/effects/explosion-spine.json',
  'utf8',
)) as { animations?: Record<string, unknown>; slots?: Array<{ name?: string }> };
assert.deepEqual(Object.keys(spineJson.animations ?? {}), ['animation']);
assert.deepEqual(spineJson.slots?.map(({ name }) => name), [
  'dust01', 'dust02', 'dust03', 'dust04', 'dust05',
  'dust06', 'dust07', 'dust08', 'dust09',
]);
const spineAtlas = readFileSync('public/assets/effects/explosion-spine.atlas', 'utf8');
assert.match(spineAtlas, /explosion-spine\.png/);
for (let frame = 1; frame <= 9; frame++) {
  assert.match(spineAtlas, new RegExp(`dust0${frame}\\n`));
}
const spinePng = readFileSync('public/assets/effects/explosion-spine.png');
assert.equal(spinePng.readUInt32BE(16), 476);
assert.equal(spinePng.readUInt32BE(20), 884);

console.log('Explosion smoke test passed: targeting, 1s fuse, UDP payload, 9-frame Spine asset');
