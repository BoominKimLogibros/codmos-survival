import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  ARENA_PLAYABLE_HALF_SIZE,
  ARENA_WALL_INSET,
  SAVE_FORMAT,
  SAVE_VERSION,
} from '../src/config/constants';
import { createDefaultGameState } from '../src/config/defaultState';
import {
  hashSavePayload,
  normalizeSaveState,
  readProfileSaveFile,
} from '../src/services/saveService';
import {
  createProfile,
  getProfile,
  getProfiles,
  resetProfileStoreForTests,
  tradeProfileSkill,
  updateProfileState,
} from '../src/services/profileService';
import {
  applyDeathPenalty,
  applySkillTrade,
  calculateEffectiveUnlockLevel,
  calculateEnhancementLevel,
  calculatePlayerStatLevel,
  experienceToNextLevel,
  getSkillTradePenaltyCandidates,
} from '../src/game/progression';

const localStorageValues = new Map<string, string>();
let localStorageWrites = 0;
const localStorage = {
  getItem: (key: string) => localStorageValues.get(key) ?? null,
  setItem: (key: string, value: string) => { localStorageWrites++; localStorageValues.set(key, value); },
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

const penalized = createDefaultGameState();
Object.assign(penalized.stats, {
  level: 10, xp: 99_999, xpToNext: 99_999,
  maxHp: 140, hp: 130, speed: 230, armor: 4, magnet: 110, recovery: 0.5,
});
const deathPenalty = applyDeathPenalty(penalized.stats, () => 0);
assert.deepEqual(deathPenalty, { levelBefore: 10, levelAfter: 9, stat: 'maxHp' });
assert.equal(penalized.stats.maxHp, 120);
assert.equal(penalized.stats.hp, 120);
assert.equal(penalized.stats.xpToNext, experienceToNextLevel(9));
assert.equal(penalized.stats.xp, experienceToNextLevel(9) - 1);
const minimumStats = createDefaultGameState().stats;
assert.equal(calculatePlayerStatLevel(minimumStats, 'maxHp'), 0);
assert.equal(calculatePlayerStatLevel(minimumStats, 'speed'), 0);
assert.equal(calculatePlayerStatLevel(minimumStats, 'armor'), 0);
assert.equal(calculatePlayerStatLevel(minimumStats, 'magnet'), 0);
assert.equal(calculatePlayerStatLevel(minimumStats, 'recovery'), 0);
assert.deepEqual(applyDeathPenalty(minimumStats, () => 0), {
  levelBefore: 1, levelAfter: 1, stat: undefined,
});

function tradeState(level: number) {
  const state = createDefaultGameState();
  state.stats.level = level;
  state.stats.xpToNext = experienceToNextLevel(level);
  state.stats.weapons = ['whip', 'bolt'];
  state.weaponLevels.whip = 1;
  state.weaponLevels.bolt = 2;
  return state;
}

const levelTwoSuccess = tradeState(2);
const successTwo = applySkillTrade(levelTwoSuccess, 'whip', (() => {
  const values = [0.019, 0];
  return () => values.shift() ?? 0;
})());
assert.equal(successTwo.chancePercent, 2);
assert.equal(successTwo.success, true);
assert.equal(levelTwoSuccess.stats.level, 1);
assert.equal(levelTwoSuccess.weaponLevels.whip, 2);
assert.equal(levelTwoSuccess.weaponLevels.bolt, 1);
assert.equal(successTwo.penaltySkill, 'bolt');

const levelTwoFailure = tradeState(2);
const failureTwo = applySkillTrade(levelTwoFailure, 'whip', () => 0.02);
assert.equal(failureTwo.success, false);
assert.equal(levelTwoFailure.stats.level, 1);
assert.equal(levelTwoFailure.weaponLevels.whip, 1);

const levelOneSkillPenalty = tradeState(2);
levelOneSkillPenalty.weaponLevels.bolt = 1;
assert.deepEqual(getSkillTradePenaltyCandidates(levelOneSkillPenalty, 'whip'), [
  { type: 'skill', key: 'bolt', level: 1 },
]);
const levelZeroResult = applySkillTrade(levelOneSkillPenalty, 'whip', (() => {
  const values = [0.5, 0];
  return () => values.shift() ?? 0;
})());
assert.equal(levelZeroResult.attempted, true);
assert.equal(levelZeroResult.penaltySkill, 'bolt');
assert.equal(levelZeroResult.penaltyLevelAfter, 0);
assert.equal(levelOneSkillPenalty.weaponLevels.bolt, 0);
assert.deepEqual(levelOneSkillPenalty.stats.weapons, ['whip']);

const statPenaltyState = createDefaultGameState();
statPenaltyState.stats.level = 2;
statPenaltyState.stats.maxHp = 120;
statPenaltyState.stats.hp = 120;
assert.deepEqual(getSkillTradePenaltyCandidates(statPenaltyState, 'whip'), [
  { type: 'stat', key: 'maxHp', level: 1 },
]);
const statPenaltyResult = applySkillTrade(statPenaltyState, 'whip', (() => {
  const values = [0.5, 0];
  return () => values.shift() ?? 0;
})());
assert.equal(statPenaltyResult.penaltyStat, 'maxHp');
assert.equal(statPenaltyResult.penaltyLevelAfter, 0);
assert.equal(statPenaltyState.stats.maxHp, 100);
assert.equal(statPenaltyState.stats.hp, 100);

const noPenaltyState = createDefaultGameState();
noPenaltyState.stats.level = 2;
const noPenaltyResult = applySkillTrade(noPenaltyState, 'whip', () => {
  throw new Error('후보가 없으면 RNG를 사용하면 안 됩니다.');
});
assert.equal(noPenaltyResult.attempted, false);
assert.equal(noPenaltyResult.reason, 'no-penalty-candidate');
assert.equal(noPenaltyState.stats.level, 2);

const levelOneBlocked = tradeState(1);
assert.equal(applySkillTrade(levelOneBlocked, 'whip', () => 0).reason, 'level-too-low');
assert.equal(levelOneBlocked.stats.level, 1);

const levelFiftySuccess = applySkillTrade(tradeState(50), 'whip', () => 0.499);
const levelFiftyFailure = applySkillTrade(tradeState(50), 'whip', () => 0.5);
assert.equal(levelFiftySuccess.chancePercent, 50);
assert.equal(levelFiftySuccess.success, true);
assert.equal(levelFiftyFailure.success, false);
const levelHundred = applySkillTrade(tradeState(100), 'whip', () => 0.999999);
assert.equal(levelHundred.chancePercent, 100);
assert.equal(levelHundred.success, true);

const unlockState = createDefaultGameState();
unlockState.stats.level = 20;
unlockState.stats.weapons = ['whip', 'bolt', 'shield'];
unlockState.weaponLevels = { whip: 7, bolt: 4, aura: 1, explosion: 1, shield: 2 };
assert.equal(calculateEnhancementLevel(unlockState), 10);
assert.equal(calculateEffectiveUnlockLevel(unlockState), 30);
const skinProfile = createProfile({ name: '합산 스킨', skin: 'bookmon', state: unlockState });
assert.equal(skinProfile.skin, 'bookmon');
const reducedUnlockState = structuredClone(unlockState);
reducedUnlockState.stats.level = 20;
reducedUnlockState.weaponLevels = { whip: 1, bolt: 1, aura: 1, explosion: 1, shield: 1 };
updateProfileState(skinProfile.id, reducedUnlockState);
assert.equal(getProfile(skinProfile.id)?.skin, 'basic');

const atomicTradeState = tradeState(50);
const atomicProfile = createProfile({ name: '원자적 교환', state: atomicTradeState });
const writesBeforeTrade = localStorageWrites;
const atomicResult = tradeProfileSkill(atomicProfile.id, 'whip', (() => {
  const values = [0.1, 0];
  return () => values.shift() ?? 0;
})());
assert.equal(localStorageWrites, writesBeforeTrade + 1);
assert.equal(atomicResult?.success, true);
assert.equal(getProfile(atomicProfile.id)?.state.stats.level, 49);
assert.equal(getProfile(atomicProfile.id)?.state.weaponLevels.whip, 2);
assert.equal(getProfile(atomicProfile.id)?.state.weaponLevels.bolt, 1);

const zeroSkillProfileState = tradeState(2);
zeroSkillProfileState.weaponLevels.bolt = 1;
const zeroSkillProfile = createProfile({ name: 'Lv0 스킬', state: zeroSkillProfileState });
const zeroSkillProfileResult = tradeProfileSkill(zeroSkillProfile.id, 'whip', (() => {
  const values = [0.5, 0];
  return () => values.shift() ?? 0;
})());
assert.equal(zeroSkillProfileResult?.penaltyLevelAfter, 0);
assert.equal(getProfile(zeroSkillProfile.id)?.state.stats.weapons.includes('bolt'), false);

assert.deepEqual(normalizeSaveState(null), createDefaultGameState());
const clamped = normalizeSaveState({
  player: { x: 999999, y: -999999 },
  stats: { level: -20, weapons: ['unknown'] },
  weaponLevels: { whip: Number.POSITIVE_INFINITY },
  progression: { adaptiveDifficulty: { deathDifficultyMultiplier: 0 } },
});
assert.equal(ARENA_WALL_INSET, 256);
assert.deepEqual(clamped.player, {
  x: ARENA_PLAYABLE_HALF_SIZE,
  y: -ARENA_PLAYABLE_HALF_SIZE,
});
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
