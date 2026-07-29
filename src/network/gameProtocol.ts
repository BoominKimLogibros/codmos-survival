import type { EnemyType, GameSaveState, LevelUpChoice, RuneType, WeaponKey } from '../game/types';

export interface NetPlayerState {
  id: string;
  name: string;
  skin: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  speed: number;
  level: number;
  xp: number;
  xpToNext: number;
  alive: boolean;
  connected: boolean;
  shield: number;
  hitRevision: number;
}

export interface NetEnemyState {
  id: string;
  type: EnemyType;
  frame: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  scale: number;
  bossTier: number;
  hitRevision: number;
}

export interface CombatEffectPayload {
  type: 'explosion';
  startX: number;
  startY: number;
  x: number;
  y: number;
  radius: number;
  flightDurationMs: number;
  fuseDurationMs: number;
}

export interface NetObjectState {
  id: string;
  texture: string;
  frame?: string | number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  rotation?: number;
  scale?: number;
  kind: 'projectile' | 'xp' | 'health';
}

export interface NetRuneState {
  id: string;
  type: RuneType;
  x: number;
  y: number;
  chargingPlayerId?: string;
  chargeRatio: number;
}

/** Persistent weapon presentation that is not represented by a physics sprite. */
export interface NetAuraState {
  playerId: string;
  x: number;
  y: number;
  scale: number;
}

/** Host-authoritative tombstone and its current resurrection charge. */
export interface NetReviveState {
  playerId: string;
  x: number;
  y: number;
  chargeRatio: number;
  chargingPlayerId?: string;
}

export interface WorldSnapshot {
  serverTime: number;
  tick: number;
  keyframe: boolean;
  progress: {
    gameTime: number;
    killCount: number;
    normalGeneration: number;
    bossGeneration: number;
  };
  players: NetPlayerState[];
  enemies: NetEnemyState[];
  objects: NetObjectState[];
  runes: NetRuneState[];
  auras: NetAuraState[];
  revives: NetReviveState[];
  removedEnemies: string[];
  removedObjects: string[];
  removedRunes: string[];
}

export interface LevelOfferPayload {
  offerId: string;
  playerId: string;
  choices: LevelUpChoice[];
  expiresAt: number;
}

export interface RuneChallengePayload {
  challengeId: string;
  playerId: string;
  runeType: RuneType;
  sequence: number[];
  retryAt: number;
}

export interface PlayerCheckpointPayload {
  profileId: string;
  state: GameSaveState;
}

export interface WeaponLevelsPayload {
  playerId: string;
  levels: Record<WeaponKey, number>;
}
