import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOSS_ENTRY_DURATION_MS,
  BOSS_CONTACT_DAMAGE_MULTIPLIER,
  BOSS_CONTACT_INTERVAL_MS,
  BOSS_SPAWN_ANIMATION_DURATION_MS,
  BOSS_SUMMON_EFFECT_DURATION_MS,
  BOSS_BEHAVIOR_PROFILES,
  bossEntryRemainingMs,
  bossAttackAnimationHasPriority,
  bossContactDamage,
  bossProfileForTier,
  clampBossAttackTarget,
  isPointInBossAttack,
  isBossEntering,
  pointToSegmentDistanceSquared,
} from '../src/game/bossBehavior';
import {
  BOSS_XP_REWARD_DISPLAY_HEIGHT,
  BOSS_XP_REWARD_DISPLAY_WIDTH,
  BOSS_XP_REWARD_PICKUP_SIZE,
  BOSS_XP_REWARD_TEXTURE_KEY,
  regularXpDropSize,
} from '../src/game/xpDrop';

assert.equal(BOSS_BEHAVIOR_PROFILES.length, 5);
assert.equal(BOSS_SUMMON_EFFECT_DURATION_MS, 1_333);
assert.equal(BOSS_SPAWN_ANIMATION_DURATION_MS, 667);
assert.equal(BOSS_ENTRY_DURATION_MS, 2_000);
assert.equal(BOSS_CONTACT_DAMAGE_MULTIPLIER, 0.25);
assert.equal(BOSS_CONTACT_INTERVAL_MS, 600);
assert.equal(bossContactDamage(30, 2), 6);
assert.equal(bossContactDamage(3, 99), 1);
assert.equal(bossEntryRemainingMs(3_000, 1_750), 1_250);
assert.equal(bossEntryRemainingMs(1_000, 1_001), 0);
assert.equal(isBossEntering(3_000, 2_999), true);
assert.equal(isBossEntering(3_000, 3_000), false);
assert.equal(bossAttackAnimationHasPriority('chase'), false);
assert.equal(bossAttackAnimationHasPriority('windup'), true);
assert.equal(bossAttackAnimationHasPriority('attack'), true);
assert.equal(bossAttackAnimationHasPriority('recover'), false);
assert.equal(bossProfileForTier(1).attackStyle, 'slam');
assert.equal(bossProfileForTier(2).attackStyle, 'strike');
assert.equal(bossProfileForTier(3).hpMultiplier, 1.8);
assert.equal(bossProfileForTier(4).name, '인라인 돌진형');
assert.equal(bossProfileForTier(4).speedMultiplier, 2.1);
assert.equal(bossProfileForTier(4).attackStyle, 'dash');
assert.equal(bossProfileForTier(5).attackAnimation, 'magic');
assert.equal(bossProfileForTier(6), bossProfileForTier(1));

assert.deepEqual(clampBossAttackTarget(0, 0, 30, 40, 20), { x: 12, y: 16 });
assert.deepEqual(clampBossAttackTarget(0, 0, 3, 4, 20), { x: 3, y: 4 });
assert.equal(pointToSegmentDistanceSquared(5, 4, 0, 0, 10, 0), 16);
assert.equal(pointToSegmentDistanceSquared(-3, 4, 0, 0, 10, 0), 25);
assert.equal(isPointInBossAttack('dash', 5, 4, 0, 0, 10, 0, 4), true);
assert.equal(isPointInBossAttack('dash', 5, 5, 0, 0, 10, 0, 4), false);
assert.equal(isPointInBossAttack('magic', 54, 50, 0, 0, 50, 50, 4), true);
assert.equal(isPointInBossAttack('heavy', 55, 50, 0, 0, 50, 50, 4), false);
assert.equal(BOSS_XP_REWARD_TEXTURE_KEY, 'bossXpReward');
assert.deepEqual(
  [BOSS_XP_REWARD_DISPLAY_WIDTH, BOSS_XP_REWARD_DISPLAY_HEIGHT],
  [64, 58],
);
assert.equal(BOSS_XP_REWARD_PICKUP_SIZE, 44);
assert.equal(regularXpDropSize(1), 22);
assert.ok(regularXpDropSize(10_000) <= 34);

const bossAssetDirectory = join(process.cwd(), 'public/assets/bosses');
[
  'dokkaebi-fire-slam.json',
  'dokkaebi-agile-striker.json',
  'dokkaebi-heavy-armored.json',
  'dokkaebi-inline-dasher.json',
  'dokkaebi-frost-mage.json',
].forEach((filename) => {
  const spine = JSON.parse(readFileSync(join(bossAssetDirectory, filename), 'utf8')) as {
    animations?: Record<string, unknown>;
  };
  assert.ok(spine.animations?.spawn, `${filename} must provide a spawn animation`);
  assert.ok(spine.animations?.idle, `${filename} must provide an idle movement animation`);
});
const summonAtlas = readFileSync(
  join(process.cwd(), 'public/assets/effects/boss-spawn.atlas'),
  'utf8',
);
assert.equal(summonAtlas.trimStart().split(/\r?\n/, 1)[0], 'boss-spawn.png');

console.log('Boss behavior smoke test passed: summon/spawn gate, five archetypes, inline speed, attack geometry, dedicated XP reward bundle');
