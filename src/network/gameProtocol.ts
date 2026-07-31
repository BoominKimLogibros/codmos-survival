import type { EnemyType, GameSaveState, LevelUpChoice, RuneType, WeaponKey } from '../game/types';
import type { BossAttackVisualState } from '../game/bossBehavior';

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
  success: boolean;
  successRevision: number;
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
  portalSpawnEndsAt?: number;
  bossSpawnRemainingMs?: number;
  bossAttack?: BossAttackVisualState;
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

export function isCombatEffectPayload(value: unknown): value is CombatEffectPayload {
  if (!value || typeof value !== 'object') return false;
  const effect = value as Partial<CombatEffectPayload>;
  return effect.type === 'explosion' && [
    effect.startX,
    effect.startY,
    effect.x,
    effect.y,
    effect.radius,
    effect.flightDurationMs,
    effect.fuseDurationMs,
  ].every((item) => typeof item === 'number' && Number.isFinite(item)) &&
    effect.radius! > 0 &&
    effect.flightDurationMs! >= 0 &&
    effect.fuseDurationMs! >= 0;
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
  scaleY?: number;
  flipX?: boolean;
  originX?: number;
  originY?: number;
  alpha?: number;
  depth?: number;
  kind: 'projectile' | 'xp' | 'health';
}

export interface NetRuneState {
  id: string;
  type: RuneType;
  x: number;
  y: number;
  phase: 'embedded' | 'emerging' | 'available';
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

export type RuneStateEvent =
  | { event: 'challenge'; challenge: RuneChallengePayload }
  | { event: 'progress'; challengeId: string; attempt: number; index: number }
  | { event: 'retry'; challengeId: string; attempt: number; retryAt: number }
  | { event: 'complete'; challengeId: string; attempt: number; index: number; cancelled?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isRuneStateEvent(value: unknown): value is RuneStateEvent {
  if (!isRecord(value) || typeof value.event !== 'string') return false;
  if (value.event === 'challenge') {
    const challenge = value.challenge;
    return isRecord(challenge) &&
      typeof challenge.challengeId === 'string' && challenge.challengeId.length > 0 &&
      typeof challenge.playerId === 'string' && challenge.playerId.length > 0 &&
      (challenge.runeType === 'multiAttack' || challenge.runeType === 'shield') &&
      Array.isArray(challenge.sequence) && challenge.sequence.length > 0 && challenge.sequence.length <= 16 &&
      challenge.sequence.every((direction) => Number.isInteger(direction) && direction >= 0 && direction <= 3) &&
      typeof challenge.retryAt === 'number' && Number.isFinite(challenge.retryAt);
  }
  if (typeof value.challengeId !== 'string' || value.challengeId.length === 0) return false;
  if (!Number.isInteger(value.attempt) || Number(value.attempt) < 0) return false;
  if (value.event === 'progress') {
    return Number.isInteger(value.index) && Number(value.index) >= 1 && Number(value.index) <= 16;
  }
  if (value.event === 'retry') {
    return typeof value.retryAt === 'number' && Number.isFinite(value.retryAt);
  }
  return value.event === 'complete' &&
    Number.isInteger(value.index) && Number(value.index) >= 0 && Number(value.index) <= 16 &&
    (value.cancelled === undefined || typeof value.cancelled === 'boolean');
}

export function createRuntimeId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid === 'function') {
    try { return randomUuid.call(globalThis.crypto); } catch { /* fallback below */ }
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export interface PlayerCheckpointPayload {
  profileId: string;
  state: GameSaveState;
}

export interface WeaponLevelsPayload {
  playerId: string;
  levels: Record<WeaponKey, number>;
}
