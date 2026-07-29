import assert from 'node:assert/strict';
import {
  createPlayerViewportBounds,
  EXPLOSION_FUSE_DURATION_MS,
  fallbackExplosionPoint,
  isPointInExplosionBounds,
  selectVisibleExplosionTargets,
} from '../src/game/ExplosionTargeting';

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

console.log('Explosion smoke test passed: visible bounds, clustered target, offscreen rejection, 1s fuse');
