import assert from 'node:assert/strict';
import { MAX_WEAPON_LEVEL } from '../src/config/constants';
import { createDefaultGameState } from '../src/config/defaultState';
import { applyLevelUpChoice, canUpgradeWeapon } from '../src/game/levelUp';
import {
  BOLT_MAX_COUNT,
  calculateWeaponRuntimeStats,
  createWeaponDefinitions,
  ORBIT_MAX_COUNT,
} from '../src/game/WeaponSystem';
import { normalizeSaveState } from '../src/services/saveService';

const definitions = createWeaponDefinitions();
assert.equal(Object.values(definitions).every((definition) => definition.maxLevel === null), true);

definitions.whip.level = 100;
const whip = calculateWeaponRuntimeStats(definitions.whip);
assert.equal(whip.damage, 916);
assert.equal(whip.cooldownMs, 720);
assert.equal(whip.range, 158);

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

definitions.shield.level = 35;
const orbitAtCap = calculateWeaponRuntimeStats(definitions.shield);
assert.equal(orbitAtCap.count, ORBIT_MAX_COUNT);
assert.equal(orbitAtCap.damage, 15);
assert.equal(orbitAtCap.radius, 184);
definitions.shield.level++;
const orbitAfterCap = calculateWeaponRuntimeStats(definitions.shield);
assert.equal(orbitAfterCap.count, ORBIT_MAX_COUNT);
assert.equal(orbitAfterCap.damage, 22);

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

console.log('Weapon progression smoke test passed: unlimited upgrades, 100-bolt cap, 0.1s aura, one bomb, 36-orbit cap, high-level save');
