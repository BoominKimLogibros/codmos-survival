import {
  ADAPTIVE_MAX_ENEMIES,
  ADAPTIVE_MAX_HP_MULTIPLIER,
  ADAPTIVE_MAX_SPAWN_BATCH,
  ADAPTIVE_MAX_SPAWN_INTERVAL_MS,
  ADAPTIVE_MIN_ACTIVE_TARGET,
  ADAPTIVE_MIN_BOSS_KILL_INTERVAL,
  ADAPTIVE_MIN_SPAWN_INTERVAL_MS,
  ARENA_PLAYABLE_HALF_SIZE,
  BOSS_KILL_INTERVAL,
  COMPRESSED_SPAWN_INTERVAL_SECONDS,
  MAX_SAVE_FILE_SIZE,
  RUNE_ROLL_INTERVAL_SECONDS,
  SAVE_FORMAT,
  SAVE_VERSION,
  SAVE_WEAPON_MAX_LEVELS,
} from '../config/constants';
import {
  createInitialAdaptiveDifficultyState,
  type GameSaveState,
  type WeaponKey,
} from '../game/types';
import { experienceToNextLevel } from '../game/progression';
import { createDefaultGameState } from '../config/defaultState';

export interface SaveProfileMetadata {
  name: string;
  skin: string;
}

export interface SavePayload {
  savedAt: string;
  state: GameSaveState;
  profile?: SaveProfileMetadata;
}

export interface SignedSaveFile {
  format: typeof SAVE_FORMAT;
  version: typeof SAVE_VERSION;
  hashAlgorithm: 'SHA-256';
  payload: SavePayload;
  hash: string;
}

interface UnknownRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const record = value as UnknownRecord;
  return '{' + Object.keys(value).sort().map((key) => (
    JSON.stringify(key) + ':' + stableStringify(record[key])
  )).join(',') + '}';
}

export async function hashSavePayload(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(payload));
  if (window.crypto && window.crypto.subtle) {
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return sha256Bytes(bytes);
}

// SHA-256 fallback for contexts where Web Crypto is unavailable (for example,
// some local-file browser environments).
function sha256Bytes(bytes: Uint8Array): string {
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const data = new DataView(padded.buffer);
  data.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  data.setUint32(paddedLength - 4, bitLength >>> 0);
  const words = new Uint32Array(64);
  const rotateRight = (value: number, amount: number): number => (
    (value >>> amount) | (value << (32 - amount))
  );

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = data.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotateRight(words[i - 15], 7) ^ rotateRight(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rotateRight(words[i - 2], 17) ^ rotateRight(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + k[i] + words[i]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

async function parseSaveFile(file: File): Promise<SavePayload> {
  if (file.size <= 0 || file.size > MAX_SAVE_FILE_SIZE) throw new Error('Invalid save file size');
  const parsed: unknown = JSON.parse(await file.text());
  const parsedVersion = isRecord(parsed) ? parsed.version : undefined;
  if (
    !isRecord(parsed) || parsed.format !== SAVE_FORMAT ||
    typeof parsedVersion !== 'number' || !Number.isInteger(parsedVersion) ||
    parsedVersion < 1 || parsedVersion > SAVE_VERSION ||
    parsed.hashAlgorithm !== 'SHA-256' || !isRecord(parsed.payload) ||
    typeof parsed.hash !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.hash)
  ) {
    throw new Error('Invalid save file format');
  }

  const actualHash = await hashSavePayload(parsed.payload);
  if (actualHash !== parsed.hash) throw new Error('Save file hash mismatch');
  return parsed.payload as unknown as SavePayload;
}

export async function readProfileSaveFile(
  file: File,
): Promise<{ state: GameSaveState; profile: SaveProfileMetadata | null }> {
  const payload = await parseSaveFile(file);
  const rawPayload = payload as unknown as UnknownRecord;
  const rawProfile = isRecord(rawPayload.profile) ? rawPayload.profile : null;
  // Older signed exports used gameState/saveData or placed state fields directly
  // inside payload. The signature is still checked before this compatibility path.
  const rawState = rawPayload.state ?? rawPayload.gameState ?? rawPayload.saveData ?? rawPayload;
  return {
    state: normalizeSaveState(rawState),
    profile: rawProfile ? {
      name: typeof rawProfile.name === 'string' ? rawProfile.name : '',
      skin: typeof rawProfile.skin === 'string' ? rawProfile.skin : 'basic',
    } : null,
  };
}

// Backward-compatible state-only reader for older call sites.
export async function readSaveFile(file: File): Promise<GameSaveState> {
  return (await readProfileSaveFile(file)).state;
}

export async function createSignedSaveFile(
  state: GameSaveState,
  profile: SaveProfileMetadata | null = null,
): Promise<SignedSaveFile> {
  const payload: SavePayload = {
    savedAt: new Date().toISOString(),
    state: normalizeSaveState(state),
  };
  if (profile) {
    payload.profile = {
      name: String(profile.name || '').trim().slice(0, 20),
      skin: String(profile.skin || 'basic'),
    };
  }
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    hashAlgorithm: 'SHA-256',
    payload,
    hash: await hashSavePayload(payload),
  };
}

export function normalizeSaveState(rawState: unknown): GameSaveState {
  const defaults = createDefaultGameState();
  const root = isRecord(rawState) ? rawState : {};
  const readNumberOr = (
    value: unknown,
    fallback: number,
    min: number,
    max: number,
    integer = false,
  ): number => {
    const candidate = typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
    if (!Number.isFinite(candidate)) return fallback;
    const normalized = integer ? Math.trunc(candidate) : candidate;
    return Math.min(max, Math.max(min, normalized));
  };
  const allowedWeapons = Object.keys(SAVE_WEAPON_MAX_LEVELS) as WeaponKey[];
  const rawStats = isRecord(root.stats) ? root.stats : {};
  const rawWeaponLevels = isRecord(root.weaponLevels) ? root.weaponLevels : {};
  const weaponLevels = {} as Record<WeaponKey, number>;
  allowedWeapons.forEach((key) => {
    weaponLevels[key] = readNumberOr(
      rawWeaponLevels[key],
      defaults.weaponLevels[key],
      1,
      SAVE_WEAPON_MAX_LEVELS[key],
      true,
    );
  });
  const listedWeapons = Array.isArray(rawStats.weapons)
    ? [...new Set(rawStats.weapons)]
      .filter((key): key is WeaponKey => (
        typeof key === 'string' && allowedWeapons.includes(key as WeaponKey)
      ))
      .slice(0, allowedWeapons.length)
    : [];
  const inferredWeapons = allowedWeapons.filter((key) => weaponLevels[key] > 1);
  const weapons = [...new Set<WeaponKey>([
    ...(listedWeapons.length > 0 ? listedWeapons : defaults.stats.weapons),
    ...inferredWeapons,
  ])].slice(0, allowedWeapons.length);

  const maxHp = readNumberOr(rawStats.maxHp, defaults.stats.maxHp, 1, 100000);
  const rawPlayer = isRecord(root.player) ? root.player : {};
  const halfWorld = ARENA_PLAYABLE_HALF_SIZE;
  const rawProgression = isRecord(root.progression) ? root.progression : {};
  const gameTime = readNumberOr(
    root.gameTime ?? root.time,
    defaults.gameTime,
    0,
    1000000000,
    true,
  );
  const killCount = readNumberOr(root.killCount, defaults.killCount, 0, 1000000000, true);
  const savedNormalKillCount = readNumberOr(
    rawProgression.normalKillCount ?? root.killCount,
    killCount,
    0,
    1000000000,
    true,
  );
  // Total kills are the reliable baseline in legacy/imported saves. Keep any
  // more precise regular-monster count from newer saves when it is higher.
  const normalKillCount = Math.max(savedNormalKillCount, killCount);
  const inferredBossKillMilestone = Math.floor(normalKillCount / BOSS_KILL_INTERVAL);
  const inferredBossGeneration = Math.min(1000, inferredBossKillMilestone);
  const inferredCompressedRollMinute = Math.floor(gameTime / COMPRESSED_SPAWN_INTERVAL_SECONDS);
  const inferredRuneRollInterval = Math.floor(gameTime / RUNE_ROLL_INTERVAL_SECONDS);
  const savedBossGeneration = readNumberOr(
    rawProgression.bossGeneration,
    inferredBossGeneration,
    0,
    1000,
    true,
  );
  const bossGeneration = Math.max(savedBossGeneration, inferredBossGeneration);
  const savedNormalGeneration = readNumberOr(
    rawProgression.normalGeneration,
    defaults.progression.normalGeneration,
    1,
    1000,
    true,
  );
  // A reached boss tier means all earlier tiers belong to the resumed
  // difficulty. Clamp legacy profiles where the old boss reward path advanced
  // the normal generation twice for one boss kill.
  const normalGeneration = Math.min(
    Math.max(savedNormalGeneration, Math.max(1, bossGeneration)),
    Math.max(1, bossGeneration + 1),
  );
  const rawAdaptiveDifficulty = isRecord(rawProgression.adaptiveDifficulty)
    ? rawProgression.adaptiveDifficulty
    : {};
  const defaultAdaptiveDifficulty = createInitialAdaptiveDifficultyState();
  const legacyLastBossSpawnKillCount = Math.min(
    normalKillCount,
    bossGeneration * BOSS_KILL_INTERVAL,
  );
  const rawSpawnPaused = rawAdaptiveDifficulty.spawnPaused;
  const rawDeathMultiplierCandidate = readNumberOr(
    rawAdaptiveDifficulty.deathDifficultyMultiplier,
    defaultAdaptiveDifficulty.deathDifficultyMultiplier,
    -1,
    1,
  );
  const deathDifficultyMultiplier = rawDeathMultiplierCandidate > 0
    ? rawDeathMultiplierCandidate
    : defaultAdaptiveDifficulty.deathDifficultyMultiplier;
  const adaptiveDifficulty = {
    activeTarget: readNumberOr(
      rawAdaptiveDifficulty.activeTarget,
      defaultAdaptiveDifficulty.activeTarget,
      ADAPTIVE_MIN_ACTIVE_TARGET,
      ADAPTIVE_MAX_ENEMIES,
      true,
    ),
    spawnBatchSize: readNumberOr(
      rawAdaptiveDifficulty.spawnBatchSize,
      defaultAdaptiveDifficulty.spawnBatchSize,
      1,
      ADAPTIVE_MAX_SPAWN_BATCH,
      true,
    ),
    spawnIntervalMs: readNumberOr(
      rawAdaptiveDifficulty.spawnIntervalMs,
      defaultAdaptiveDifficulty.spawnIntervalMs,
      ADAPTIVE_MIN_SPAWN_INTERVAL_MS,
      ADAPTIVE_MAX_SPAWN_INTERVAL_MS,
      true,
    ),
    hpMultiplier: readNumberOr(
      rawAdaptiveDifficulty.hpMultiplier,
      defaultAdaptiveDifficulty.hpMultiplier,
      1,
      ADAPTIVE_MAX_HP_MULTIPLIER,
    ),
    bossKillInterval: readNumberOr(
      rawAdaptiveDifficulty.bossKillInterval,
      defaultAdaptiveDifficulty.bossKillInterval,
      ADAPTIVE_MIN_BOSS_KILL_INTERVAL,
      BOSS_KILL_INTERVAL,
      true,
    ),
    lastBossSpawnKillCount: readNumberOr(
      rawAdaptiveDifficulty.lastBossSpawnKillCount,
      legacyLastBossSpawnKillCount,
      0,
      normalKillCount,
      true,
    ),
    adjustmentCount: readNumberOr(
      rawAdaptiveDifficulty.adjustmentCount,
      defaultAdaptiveDifficulty.adjustmentCount,
      0,
      1000000000,
      true,
    ),
    consecutiveFastWindows: readNumberOr(
      rawAdaptiveDifficulty.consecutiveFastWindows,
      defaultAdaptiveDifficulty.consecutiveFastWindows,
      0,
      1000000,
      true,
    ),
    consecutiveSlowWindows: readNumberOr(
      rawAdaptiveDifficulty.consecutiveSlowWindows,
      defaultAdaptiveDifficulty.consecutiveSlowWindows,
      0,
      1000000,
      true,
    ),
    spawnPaused: typeof rawSpawnPaused === 'boolean'
      ? rawSpawnPaused
      : defaultAdaptiveDifficulty.spawnPaused,
    deathDifficultyMultiplier,
  };
  const playerLevel = readNumberOr(rawStats.level, defaults.stats.level, 1, 1000000, true);

  return {
    gameTime,
    killCount,
    player: {
      x: readNumberOr(rawPlayer.x, defaults.player.x, -halfWorld, halfWorld),
      y: readNumberOr(rawPlayer.y, defaults.player.y, -halfWorld, halfWorld),
    },
    stats: {
      maxHp,
      hp: readNumberOr(rawStats.hp, Math.min(defaults.stats.hp, maxHp), 0, maxHp),
      speed: readNumberOr(rawStats.speed, defaults.stats.speed, 1, 10000),
      level: playerLevel,
      xp: readNumberOr(rawStats.xp, defaults.stats.xp, 0, 1000000000),
      xpToNext: experienceToNextLevel(playerLevel),
      armor: readNumberOr(rawStats.armor, defaults.stats.armor, 0, 100000),
      magnet: readNumberOr(rawStats.magnet, defaults.stats.magnet, 0, 100000),
      recovery: readNumberOr(rawStats.recovery, defaults.stats.recovery, 0, 100000),
      weapons,
    },
    weaponLevels,
    progression: {
      normalGeneration,
      normalSpawnedInGeneration: readNumberOr(
        rawProgression.normalSpawnedInGeneration,
        defaults.progression.normalSpawnedInGeneration,
        0,
        1000000000,
        true,
      ),
      normalKillCount,
      lastCompressedRollMinute: Math.max(
        readNumberOr(
          rawProgression.lastCompressedRollMinute,
          inferredCompressedRollMinute,
          0,
          1000000000,
          true,
        ),
        inferredCompressedRollMinute,
      ),
      bossGeneration,
      lastBossKillMilestone: Math.max(
        readNumberOr(
          rawProgression.lastBossKillMilestone,
          inferredBossKillMilestone,
          0,
          1000000,
          true,
        ),
        inferredBossKillMilestone,
      ),
      lastRuneRollInterval: Math.max(
        readNumberOr(
          rawProgression.lastRuneRollInterval,
          inferredRuneRollInterval,
          0,
          1000000000,
          true,
        ),
        inferredRuneRollInterval,
      ),
      adaptiveDifficulty,
    },
  };
}
