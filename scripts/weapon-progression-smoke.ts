import assert from 'node:assert/strict';
import {
  MAX_WEAPON_LEVEL,
  RUNE_EMERGE_DELAY_MS,
  RUNE_EMERGE_DURATION_MS,
  RUNE_EMERGE_START_OFFSET_Y,
} from '../src/config/constants';
import { createDefaultGameState } from '../src/config/defaultState';
import { applyLevelUpChoice, canUpgradeWeapon } from '../src/game/levelUp';
import {
  BOLT_MAX_COUNT,
  applyWeaponDefinitionLevels,
  calculateWeaponRuntimeStats,
  createWeaponDefinitions,
  ORBIT_BASE_RADIUS,
  ORBIT_MAX_COUNT,
  ORBIT_ROTATION_SPEED,
} from '../src/game/WeaponSystem';
import {
  consumeDamageContact,
  consumeDamageSourceCooldown,
  pruneDamageContacts,
} from '../src/game/damageCooldown';
import {
  ORBIT_LINK_ENTER_DISTANCE,
  ORBIT_LINK_EXIT_DISTANCE,
  selectNearestOrbitPairs,
  sharedOuterOrbitPoint,
  sharedOuterTrainPositions,
} from '../src/game/OrbitLinkCoordinator';
import { joystickVectorToMask } from '../src/ui/TouchJoystick';
import { buildPlayerStatTooltipData } from '../src/ui/WeaponStatusHud';
import { calculateExitButtonPosition } from '../src/ui/gameHudLayout';
import { INPUT_DOWN, INPUT_LEFT, INPUT_RIGHT, INPUT_UP } from '../src/game/PlayerController';
import { normalizeSaveState } from '../src/services/saveService';
import { runeDropVisualState, runeTextureKey } from '../src/game/runeDrop';
import { MULTI_ATTACK_BOSS_DAMAGE_RATIO, multiAttackDamage } from '../src/game/runeAttack';
import {
  FLAG_ATTACK_DURATION_MS,
  FLAG_ATTACK_PEAK_HOLD_MS,
  FLAG_COLLISION_RADIUS,
  FLAG_DAMAGE_SAMPLE_COUNT,
  FLAG_PIVOT_OFFSET_Y,
  FLAG_TEXTURE_HEIGHT,
  FLAG_TEXTURE_WIDTH,
  flagContactPoint,
  flagDamagePoints,
  flagOriginX,
  flagSwingAngle,
  flagSwingDirection,
  flagSwingEffectAlpha,
} from '../src/objects/FlagPresentation';
import {
  EXPLOSION_KNOCKBACK_STRENGTH,
  FLAG_KNOCKBACK_STRENGTH,
  ORBIT_KNOCKBACK_STRENGTH,
  directionalKnockback,
  radialKnockback,
  shouldApplyKnockback,
} from '../src/game/knockback';
import {
  RUNE_ACTIVATION_TOTAL_MS,
  runeActivationTextureKey,
} from '../src/objects/RuneActivationPresentation';

const definitions = createWeaponDefinitions();
assert.equal(Object.values(definitions).every((definition) => definition.maxLevel === null), true);
assert.equal(definitions.whip.name, '깃발로 때리기');
assert.equal(definitions.whip.icon, 'flag');

definitions.whip.level = 1;
assert.equal(calculateWeaponRuntimeStats(definitions.whip).damage, 35);
definitions.whip.level = 100;
const whip = calculateWeaponRuntimeStats(definitions.whip);
assert.equal(whip.damage, 1223);
assert.equal(whip.cooldownMs, 720);
assert.equal(whip.range, 158);
assert.equal(FLAG_ATTACK_DURATION_MS, 165);
assert.equal(FLAG_ATTACK_PEAK_HOLD_MS, 35);
assert.equal(FLAG_TEXTURE_WIDTH, 72);
assert.equal(FLAG_TEXTURE_HEIGHT, 65);
assert.equal(flagSwingAngle(1, 0), -Math.PI / 2);
assert.equal(flagSwingAngle(-1, 0), Math.PI / 2);
assert.equal(flagSwingAngle(1, 1), 0);
assert.ok(Math.abs(flagSwingDirection(1, 0).x - 1) < 1e-10);
assert.ok(Math.abs(flagSwingDirection(1, 0).y) < 1e-10);
assert.ok(Math.abs(flagSwingDirection(1, 1).x) < 1e-10);
assert.equal(flagSwingDirection(1, 1).y, 1);
assert.ok(Math.abs(flagSwingDirection(-1, 0).x + 1) < 1e-10);
assert.ok(Math.abs(flagSwingDirection(-1, 0).y) < 1e-10);
assert.ok(Math.abs(flagSwingDirection(-1, 1).x) < 1e-10);
assert.equal(flagSwingDirection(-1, 1).y, 1);
assert.deepEqual(flagContactPoint(100, 200, 1, 62, 0), {
  x: 100,
  y: 200 + FLAG_PIVOT_OFFSET_Y - 62,
});
assert.deepEqual(flagContactPoint(100, 200, 1, 62, 1), {
  x: 162,
  y: 200 + FLAG_PIVOT_OFFSET_Y,
});
assert.deepEqual(flagContactPoint(100, 200, -1, 62, 1), {
  x: 38,
  y: 200 + FLAG_PIVOT_OFFSET_Y,
});
const rightFlagDamagePoints = flagDamagePoints(100, 200, 1, 158, 1);
assert.equal(rightFlagDamagePoints.length, FLAG_DAMAGE_SAMPLE_COUNT);
assert.ok(rightFlagDamagePoints[0].x - FLAG_COLLISION_RADIUS <= 100);
assert.ok(rightFlagDamagePoints.at(-1)!.x + FLAG_COLLISION_RADIUS >= 258);
rightFlagDamagePoints.slice(1).forEach((point, index) => {
  const previous = rightFlagDamagePoints[index];
  assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) <= FLAG_COLLISION_RADIUS * 2);
});
const leftFlagDamagePoints = flagDamagePoints(100, 200, -1, 158, 1);
rightFlagDamagePoints.forEach((point, index) => {
  assert.ok(Math.abs(point.x + leftFlagDamagePoints[index].x - 200) < 1e-10);
  assert.ok(Math.abs(point.y - leftFlagDamagePoints[index].y) < 1e-10);
});
assert.equal(flagOriginX(1) + flagOriginX(-1), 1);
assert.equal(flagSwingEffectAlpha(0), 0);
assert.equal(flagSwingEffectAlpha(0.18), 1);
assert.equal(flagSwingEffectAlpha(1), 0);
assert.ok(EXPLOSION_KNOCKBACK_STRENGTH > FLAG_KNOCKBACK_STRENGTH);
assert.ok(FLAG_KNOCKBACK_STRENGTH > ORBIT_KNOCKBACK_STRENGTH);
assert.deepEqual(directionalKnockback(3, 4, 100, 200), {
  directionX: 0.6, directionY: 0.8, strength: 100, durationMs: 200,
});
assert.deepEqual(radialKnockback(10, 10, 10, 30, 460, 340), {
  directionX: 0, directionY: 1, strength: 460, durationMs: 340,
});
assert.equal(shouldApplyKnockback(500, 460, 100, 90), false);
assert.equal(shouldApplyKnockback(500, 90, 100, 145), true);
assert.equal(shouldApplyKnockback(100, 460, 100, 90), true);

const importedDefinitions = createWeaponDefinitions();
applyWeaponDefinitionLevels(importedDefinitions, {
  whip: 17, bolt: 1, aura: 1, explosion: 1, shield: 1,
});
assert.equal(importedDefinitions.whip.level, 17);
assert.equal(importedDefinitions.whip.name, '깃발로 때리기');

const embeddedRune = runeDropVisualState(RUNE_EMERGE_DELAY_MS - 1);
assert.deepEqual(embeddedRune, { phase: 'embedded', offsetY: 0, available: false });
assert.equal(runeTextureKey(embeddedRune.phase), 'runeEmbedded');
const risingRune = runeDropVisualState(RUNE_EMERGE_DELAY_MS);
assert.deepEqual(risingRune, {
  phase: 'emerging', offsetY: RUNE_EMERGE_START_OFFSET_Y, available: false,
});
const emergedRune = runeDropVisualState(RUNE_EMERGE_DELAY_MS + RUNE_EMERGE_DURATION_MS);
assert.deepEqual(emergedRune, { phase: 'available', offsetY: 0, available: true });
assert.equal(runeTextureKey(emergedRune.phase), 'runeItem');
assert.equal(runeActivationTextureKey('multiAttack'), 'runeAttackActivation');
assert.equal(runeActivationTextureKey('shield'), 'runeDefenseActivation');
assert.equal(RUNE_ACTIVATION_TOTAL_MS, 600);
assert.equal(MULTI_ATTACK_BOSS_DAMAGE_RATIO, 0.35);
assert.equal(multiAttackDamage({
  enemyType: 'boss', hp: 1000, maxHp: 1000,
}, 1), 350);
assert.equal(multiAttackDamage({
  enemyType: 'boss', hp: 1000, maxHp: 1000,
}, 50), 1000);
assert.equal(multiAttackDamage({
  enemyType: 'basic', hp: 321, maxHp: 500,
}, 1), 321);

definitions.bolt.level = 1;
assert.deepEqual(calculateWeaponRuntimeStats(definitions.bolt), {
  damage: 18, cooldownMs: 900, count: 1, speed: 430, pierce: 1,
});
definitions.bolt.level = BOLT_MAX_COUNT;
const boltAtCap = calculateWeaponRuntimeStats(definitions.bolt);
assert.equal(boltAtCap.count, 100);
assert.equal(boltAtCap.damage, 18);
definitions.bolt.level++;
const boltAfterCap = calculateWeaponRuntimeStats(definitions.bolt);
assert.equal(boltAfterCap.count, 100);
assert.equal(boltAfterCap.damage, 25);

definitions.aura.level = 100;
const aura = calculateWeaponRuntimeStats(definitions.aura);
assert.equal(aura.cooldownMs, 100);
assert.equal(aura.damage, 505);
assert.equal(aura.radius, 165);

definitions.explosion.level = 100;
const explosion = calculateWeaponRuntimeStats(definitions.explosion);
assert.equal(explosion.count, 1);
assert.equal(explosion.damage, 1832);
assert.equal(explosion.radius, 357);

definitions.shield.level = 1;
const firstOrbit = calculateWeaponRuntimeStats(definitions.shield);
assert.equal(firstOrbit.count, 1);
assert.equal(firstOrbit.hitIntervalMs, undefined);
definitions.shield.level = 8;
const orbitAtCap = calculateWeaponRuntimeStats(definitions.shield);
assert.equal(orbitAtCap.count, ORBIT_MAX_COUNT);
assert.equal(orbitAtCap.damage, 15);
assert.equal(orbitAtCap.radius, 70);
definitions.shield.level++;
const orbitAfterCap = calculateWeaponRuntimeStats(definitions.shield);
assert.equal(orbitAfterCap.count, ORBIT_MAX_COUNT);
assert.equal(orbitAfterCap.damage, 22);
assert.equal(ORBIT_ROTATION_SPEED, 0.0018);

const tooltipStats = createDefaultGameState().stats;
tooltipStats.hp = 125;
tooltipStats.maxHp = 140;
const maxHpTooltip = buildPlayerStatTooltipData(tooltipStats, 'maxHp');
assert.equal(maxHpTooltip.level, 2);
assert.equal(maxHpTooltip.levelLabel, '투자 Lv 2');
assert.deepEqual(maxHpTooltip.stats, [
  { label: '현재 HP', value: '125 / 140' },
  { label: '최종 수치', value: '140 HP' },
  { label: '기본 수치', value: '100 HP' },
  { label: 'Lv당 증가', value: '+20 HP' },
]);

const sourceHits = new Map<string, number>();
assert.equal(consumeDamageSourceCooldown(sourceHits, 'player-a:orbit', 0, 100), true);
assert.equal(consumeDamageSourceCooldown(sourceHits, 'player-a:orbit', 99, 100), false);
assert.equal(consumeDamageSourceCooldown(sourceHits, 'player-b:orbit', 50, 100), true);
assert.equal(consumeDamageSourceCooldown(sourceHits, 'player-a:whip', 50, 200), true);
assert.equal(consumeDamageSourceCooldown(sourceHits, 'player-a:orbit', 100, 100), true);

const contactHits = new Map<string, number>();
assert.equal(consumeDamageContact(contactHits, 'player-a:orbit:0', 0), true);
assert.equal(consumeDamageContact(contactHits, 'player-a:orbit:0', 0), false);
assert.equal(consumeDamageContact(contactHits, 'player-a:orbit:1', 0), true);
pruneDamageContacts(contactHits, 1);
assert.equal(consumeDamageContact(contactHits, 'player-a:orbit:0', 1), false);
pruneDamageContacts(contactHits, 2);
assert.equal(contactHits.has('player-a:orbit:1'), false);
pruneDamageContacts(contactHits, 3);
assert.equal(contactHits.has('player-a:orbit:0'), false);
assert.equal(consumeDamageContact(contactHits, 'player-a:orbit:0', 3), true);

assert.equal(ORBIT_LINK_ENTER_DISTANCE, 140);
assert.equal(ORBIT_LINK_EXIT_DISTANCE, 168);
assert.deepEqual(selectNearestOrbitPairs([
  { id: 'a', x: 0, y: 0 },
  { id: 'b', x: 100, y: 0 },
  { id: 'c', x: 104, y: 0 },
  { id: 'd', x: 300, y: 0 },
]), [{ leftId: 'b', rightId: 'c' }]);
assert.deepEqual(selectNearestOrbitPairs([
  { id: 'a', x: 0, y: 0 },
  { id: 'b', x: 141, y: 0 },
]), []);
const sharedLeft = { x: 0, y: 20 };
const sharedRight = { x: 120, y: 20 };
const upperIntersection = sharedOuterOrbitPoint(sharedLeft, sharedRight, 0);
const lowerIntersection = sharedOuterOrbitPoint(sharedLeft, sharedRight, Math.PI * 2);
assert.ok(Math.abs(upperIntersection.x - 60) < 1e-8);
assert.ok(upperIntersection.y > 20);
assert.ok(Math.abs(lowerIntersection.x - 60) < 1e-8);
assert.ok(lowerIntersection.y < 20);
const train = sharedOuterTrainPositions(sharedLeft, sharedRight, 20);
assert.equal(train.length, 16);
assert.equal(train.some((point) => (
  point.x > sharedLeft.x && point.x < sharedRight.x && Math.abs(point.y - sharedLeft.y) < 1e-8
)), false);
train.forEach((point) => {
  const leftDistance = Math.hypot(point.x - sharedLeft.x, point.y - sharedLeft.y);
  const rightDistance = Math.hypot(point.x - sharedRight.x, point.y - sharedRight.y);
  assert.ok(Math.abs(leftDistance - ORBIT_BASE_RADIUS) < 1e-8 ||
    Math.abs(rightDistance - ORBIT_BASE_RADIUS) < 1e-8);
  assert.ok(leftDistance >= ORBIT_BASE_RADIUS - 1e-8);
  assert.ok(rightDistance >= ORBIT_BASE_RADIUS - 1e-8);
});
const hysteresisPoint = sharedOuterOrbitPoint({ x: 0, y: 0 }, { x: 160, y: 0 }, 0);
assert.ok(hysteresisPoint.y > 0);
assert.ok(hysteresisPoint.x > 0 && hysteresisPoint.x < 160);

assert.equal(joystickVectorToMask(3, 2), 0);
assert.equal(joystickVectorToMask(30, 0), INPUT_RIGHT);
assert.equal(joystickVectorToMask(-30, 0), INPUT_LEFT);
assert.equal(joystickVectorToMask(0, -30), INPUT_UP);
assert.equal(joystickVectorToMask(24, 24), INPUT_RIGHT | INPUT_DOWN);
assert.deepEqual(calculateExitButtonPosition(1280, 800, false), { x: 1210, y: 765 });
assert.deepEqual(calculateExitButtonPosition(720, 540, false), { x: 650, y: 505 });
assert.deepEqual(calculateExitButtonPosition(1280, 800, true), { x: 1210, y: 642 });
assert.deepEqual(calculateExitButtonPosition(Number.NaN, Number.NaN, false), { x: 54, y: 21 });

definitions.whip.level = 5;
assert.equal(canUpgradeWeapon(definitions.whip), true);
const player = createDefaultGameState().stats;
applyLevelUpChoice(player, definitions, {
  type: 'upgradeWeapon', key: 'whip', name: '', desc: '',
});
assert.equal(definitions.whip.level, 6);
definitions.whip.level = MAX_WEAPON_LEVEL;
assert.equal(canUpgradeWeapon(definitions.whip), false);

const highLevelSave = createDefaultGameState();
highLevelSave.weaponLevels = {
  whip: 500,
  bolt: 101,
  aura: 250,
  explosion: 100,
  shield: 36,
};
assert.deepEqual(normalizeSaveState(highLevelSave).weaponLevels, highLevelSave.weaponLevels);

console.log('Weapon progression smoke test passed: directional flag/orbit knockback, strong radial explosion knockback, no bolt/aura knockback, full flag damage sweep, 35% boss rune strike, compatibility and swing arc, rune emergence, 8-orbit cap, per-orb contact hits, shared outer orbit, joystick directions, high-level save');
