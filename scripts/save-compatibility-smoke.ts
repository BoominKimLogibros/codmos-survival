import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { SAVE_FORMAT, SAVE_VERSION } from '../src/config/constants';
import { createDefaultGameState } from '../src/config/defaultState';
import {
  hashSavePayload,
  normalizeSaveState,
  readProfileSaveFile,
} from '../src/services/saveService';
import {
  getProfiles,
  resetProfileStoreForTests,
} from '../src/services/profileService';

const localStorageValues = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => localStorageValues.get(key) ?? null,
  setItem: (key: string, value: string) => { localStorageValues.set(key, value); },
  removeItem: (key: string) => { localStorageValues.delete(key); },
  clear: () => { localStorageValues.clear(); },
  key: (index: number) => [...localStorageValues.keys()][index] ?? null,
  get length() { return localStorageValues.size; },
} as Storage;
(globalThis as unknown as { window: { crypto: Crypto; localStorage: Storage } }).window = {
  crypto: globalThis.crypto,
  localStorage,
};

const legacyState = {
  gameTime: '317',
  killCount: 1373,
  player: { x: -497.58, y: 739.12 },
  stats: {
    level: '15',
    xp: 359,
    maxHp: 'broken',
    weapons: ['whip', 'removed-legacy-skill', 'bolt', 'bolt'],
  },
  weaponLevels: {
    whip: 3,
    bolt: '4',
    shield: 5,
    removedLegacySkill: 999,
  },
  ignoredLegacyField: { anything: true },
};

const migrated = normalizeSaveState(legacyState);
assert.equal(migrated.gameTime, 317);
assert.equal(migrated.killCount, 1373);
assert.equal(migrated.stats.level, 15);
assert.equal(migrated.stats.xp, 359);
assert.equal(migrated.stats.maxHp, 100);
assert.equal(migrated.stats.hp, 100);
assert.equal(migrated.stats.speed, 200);
assert.deepEqual(migrated.stats.weapons, ['whip', 'bolt', 'shield']);
assert.deepEqual(migrated.weaponLevels, {
  whip: 3,
  bolt: 4,
  aura: 1,
  explosion: 1,
  shield: 5,
});
assert.equal(migrated.progression.normalKillCount, 1373);
assert.equal(migrated.progression.bossGeneration, 1);
assert.equal(migrated.progression.adaptiveDifficulty.activeTarget, 80);

const profileStorageKey = 'codmos-survival-profiles-v1';
localStorage.setItem(profileStorageKey, JSON.stringify({
  version: 0,
  selectedProfileId: 'legacy-profile',
  profiles: [{
    id: 'legacy-profile',
    name: '예전 로컬 프로필',
    skin: 'removed-skin',
    gameState: legacyState,
  }],
}));
resetProfileStoreForTests();
const localProfiles = getProfiles();
assert.equal(localProfiles.length, 1);
assert.equal(localProfiles[0].name, '예전 로컬 프로필');
assert.equal(localProfiles[0].skin, 'basic');
assert.equal(localProfiles[0].state.stats.level, 15);
assert.equal(localProfiles[0].state.weaponLevels.shield, 5);
const persistedProfileStore = JSON.parse(localStorage.getItem(profileStorageKey) || '{}');
assert.equal(persistedProfileStore.version, 1);
assert.equal(persistedProfileStore.profiles[0].state.progression.bossGeneration, 1);

assert.deepEqual(normalizeSaveState(null), createDefaultGameState());
const clamped = normalizeSaveState({
  player: { x: 999999, y: -999999 },
  stats: { level: -20, weapons: ['unknown'] },
  weaponLevels: { whip: Number.POSITIVE_INFINITY },
  progression: { adaptiveDifficulty: { deathDifficultyMultiplier: 0 } },
});
assert.deepEqual(clamped.player, { x: 1024, y: -1024 });
assert.equal(clamped.stats.level, 1);
assert.deepEqual(clamped.stats.weapons, ['whip']);
assert.equal(clamped.weaponLevels.whip, 1);
assert.equal(clamped.progression.adaptiveDifficulty.deathDifficultyMultiplier, 1);

const payload = {
  gameState: legacyState,
  profile: { name: '구형 프로필', skin: 'basic' },
};
const signed = {
  format: SAVE_FORMAT,
  version: SAVE_VERSION,
  hashAlgorithm: 'SHA-256',
  payload,
  hash: await hashSavePayload(payload),
};
const makeFile = (value: unknown): File => {
  const content = JSON.stringify(value);
  return {
    size: Buffer.byteLength(content),
    text: async () => content,
  } as File;
};
const imported = await readProfileSaveFile(makeFile(signed));
assert.equal(imported.profile?.name, '구형 프로필');
assert.equal(imported.state.stats.level, 15);
assert.equal(imported.state.weaponLevels.shield, 5);

const tampered = structuredClone(signed);
tampered.payload.gameState.stats.level = '999';
await assert.rejects(readProfileSaveFile(makeFile(tampered)), /hash mismatch/i);

for (const filePath of process.argv.slice(2)) {
  const content = await readFile(filePath, 'utf8');
  const externalImport = await readProfileSaveFile({
    name: basename(filePath),
    size: Buffer.byteLength(content),
    text: async () => content,
  } as File);
  assert.ok(externalImport.state.stats.level >= 1);
  assert.ok(externalImport.state.stats.weapons.length >= 1);
  assert.ok(Number.isFinite(externalImport.state.progression.adaptiveDifficulty.activeTarget));
  console.log(
    `Legacy file imported: ${basename(filePath)} (level=${externalImport.state.stats.level}, kills=${externalImport.state.killCount})`,
  );
}

console.log('Save compatibility smoke test passed: missing defaults, legacy aliases, unknown fields, numeric strings, bounds, signature enforcement');
