import type { EnemyHealthBar } from '../objects/EnemyHealthBar';
import {
  ADAPTIVE_INITIAL_ACTIVE_TARGET,
  ADAPTIVE_INITIAL_SPAWN_BATCH,
  ADAPTIVE_INITIAL_SPAWN_INTERVAL_MS,
  BOSS_KILL_INTERVAL,
} from '../config/constants';

export type WeaponKey = 'whip' | 'bolt' | 'aura' | 'explosion' | 'shield';
export type WeaponType = 'melee' | 'projectile' | 'aura' | 'explosion' | 'orbit';
export type RegularEnemyType = 'basic' | 'fast' | 'tank';
export type EnemyType = RegularEnemyType | 'boss' | 'compressed';
export type PlayerDirection = 'front' | 'side' | 'back';
export type RuneType = 'multiAttack' | 'shield';

export interface MonsterFrames {
  idle: number;
  destroyed: number;
}

export interface WeaponDefinition {
  name: string;
  desc: string;
  damage: number;
  cooldown: number;
  level: number;
  /** null means the weapon can be upgraded indefinitely. */
  maxLevel: number | null;
  type: WeaponType;
  icon: string;
  count?: number;
  speed?: number;
  radius?: number;
}

export type WeaponDefinitions = Record<WeaponKey, WeaponDefinition>;

export interface WeaponRuntimeStats {
  damage: number;
  cooldownMs?: number;
  count?: number;
  range?: number;
  radius?: number;
  speed?: number;
  pierce?: number;
  hitIntervalMs?: number;
}

export interface WeaponTooltipStat {
  label: string;
  value: string;
}

export interface WeaponTooltipData {
  name: string;
  description: string;
  level: number;
  maxLevel: number | null;
  stats: WeaponTooltipStat[];
}

export interface PlayerStats {
  maxHp: number;
  hp: number;
  speed: number;
  level: number;
  xp: number;
  xpToNext: number;
  armor: number;
  magnet: number;
  recovery: number;
  weapons: WeaponKey[];
}

export interface AdaptiveDifficultyState {
  activeTarget: number;
  spawnBatchSize: number;
  spawnIntervalMs: number;
  hpMultiplier: number;
  bossKillInterval: number;
  lastBossSpawnKillCount: number;
  adjustmentCount: number;
  consecutiveFastWindows: number;
  consecutiveSlowWindows: number;
  spawnPaused: boolean;
  deathDifficultyMultiplier: number;
}

export interface RunProgress {
  gameTime: number;
  killCount: number;
  normalGeneration: number;
  normalSpawnedInGeneration: number;
  normalKillCount: number;
  lastCompressedRollMinute: number;
  bossGeneration: number;
  lastBossKillMilestone: number;
  lastRuneRollInterval: number;
  adaptiveDifficulty: AdaptiveDifficultyState;
}

export interface SaveProgression {
  normalGeneration: number;
  normalSpawnedInGeneration: number;
  normalKillCount: number;
  lastCompressedRollMinute: number;
  bossGeneration: number;
  lastBossKillMilestone: number;
  lastRuneRollInterval: number;
  adaptiveDifficulty: AdaptiveDifficultyState;
}

export interface GameSaveState {
  gameTime: number;
  killCount: number;
  player: { x: number; y: number };
  stats: PlayerStats;
  weaponLevels: Record<WeaponKey, number>;
  progression: SaveProgression;
}

export interface Profile {
  id: string;
  name: string;
  skin: string;
  state: GameSaveState;
  createdAt: string;
  updatedAt: string;
}

export interface GameSceneData {
  saveData?: GameSaveState | null;
  profileId?: string | null;
  profileSkin?: string;
  retryAssist?: boolean;
}

export interface LevelUpChoice {
  type: 'newWeapon' | 'upgradeWeapon' | 'stat';
  key?: WeaponKey;
  stat?: 'maxHp' | 'speed' | 'armor' | 'magnet' | 'recovery';
  name: string;
  desc: string;
  levelText?: string;
  icon?: string;
}

export interface EnemyDefinition {
  frames: MonsterFrames;
  hp: number;
  speed: number;
  damage: number;
  xp: number;
  scale: number;
}

export interface EnemyPresentation {
  sync(x: number, y: number, movingLeft: boolean): void;
  showDamageFeedback(): void;
  destroy(playDeathAnimation?: boolean): void;
}

export interface EnemySprite extends Phaser.Physics.Arcade.Sprite {
  enemyType: EnemyType;
  monsterFrames: MonsterFrames;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  xpValue: number;
  lastDmgT: number;
  hitRevision?: number;
  knockbackUntil?: number;
  normalGeneration: number;
  bossTier?: number;
  baseTint?: number;
  presentation?: EnemyPresentation | null;
  healthBar?: EnemyHealthBar | null;
  hpBar?: Phaser.GameObjects.Rectangle | null;
  hpBarBg?: Phaser.GameObjects.Rectangle | null;
  hpGrid?: Phaser.GameObjects.Graphics | null;
  hpBarWidth?: number;
  hpBarHeight?: number;
  hpBarYOffset?: number;
  hpSegmentCount?: number;
  hpVisibleGridStep?: number;
}

export interface DamageSprite extends Phaser.Physics.Arcade.Sprite {
  damage: number;
  pierce?: number;
}

export interface DropSprite extends Phaser.Physics.Arcade.Sprite {
  xpValue?: number;
}

export interface RuneSprite extends Phaser.Physics.Arcade.Sprite {
  runeType: RuneType;
}

export interface AudioEffects {
  coin: Phaser.Sound.BaseSound;
  fail: Phaser.Sound.BaseSound;
  jump: Phaser.Sound.BaseSound;
  explosion: Phaser.Sound.BaseSound;
  boing: Phaser.Sound.BaseSound;
  spring: Phaser.Sound.BaseSound;
  bomb: Phaser.Sound.BaseSound;
  giggle: Phaser.Sound.BaseSound;
  scream: Phaser.Sound.BaseSound;
  thump: Phaser.Sound.BaseSound;
  multiAttack: Phaser.Sound.BaseSound;
  shield: Phaser.Sound.BaseSound;
}

export function createInitialPlayerStats(): PlayerStats {
  return {
    maxHp: 100,
    hp: 100,
    speed: 200,
    level: 1,
    xp: 0,
    xpToNext: 10,
    armor: 0,
    magnet: 80,
    recovery: 0,
    weapons: ['whip'],
  };
}

export function createInitialRunProgress(): RunProgress {
  return {
    gameTime: 0,
    killCount: 0,
    normalGeneration: 1,
    normalSpawnedInGeneration: 0,
    normalKillCount: 0,
    lastCompressedRollMinute: 0,
    bossGeneration: 0,
    lastBossKillMilestone: 0,
    lastRuneRollInterval: 0,
    adaptiveDifficulty: createInitialAdaptiveDifficultyState(),
  };
}

export function createInitialAdaptiveDifficultyState(): AdaptiveDifficultyState {
  return {
    activeTarget: ADAPTIVE_INITIAL_ACTIVE_TARGET,
    spawnBatchSize: ADAPTIVE_INITIAL_SPAWN_BATCH,
    spawnIntervalMs: ADAPTIVE_INITIAL_SPAWN_INTERVAL_MS,
    hpMultiplier: 1,
    bossKillInterval: BOSS_KILL_INTERVAL,
    lastBossSpawnKillCount: 0,
    adjustmentCount: 0,
    consecutiveFastWindows: 0,
    consecutiveSlowWindows: 0,
    spawnPaused: false,
    deathDifficultyMultiplier: 1,
  };
}
