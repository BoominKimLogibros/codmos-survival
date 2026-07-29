import {
  ADAPTIVE_DIFFICULTY_INTERVAL_MS,
  ADAPTIVE_MAX_ENEMIES,
  ADAPTIVE_MAX_HP_MULTIPLIER,
  ADAPTIVE_MAX_SPAWN_BATCH,
  ADAPTIVE_MAX_SPAWN_INTERVAL_MS,
  ADAPTIVE_MIN_ACTIVE_TARGET,
  ADAPTIVE_MIN_BOSS_KILL_INTERVAL,
  ADAPTIVE_MIN_SPAWN_INTERVAL_MS,
  BOSS_KILL_INTERVAL,
} from '../config/constants';
import type { AdaptiveDifficultyState } from './types';

export type DifficultyPressure = 'overwhelmed' | 'steady' | 'fast';

export interface DifficultyAdjustment {
  pressure: DifficultyPressure;
  hpScaleRatio: number;
  message?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Adjusts enemy pressure from observed combat results instead of elapsed time.
 * It intentionally owns every regular-enemy difficulty knob so independent
 * time, generation, and retry multipliers cannot stack on top of each other.
 */
export class AdaptiveDifficultyController {
  private elapsedMs = 0;
  private spawnedInWindow = 0;
  private windowStartKills: number;
  private windowStartActive: number;

  constructor(
    readonly state: AdaptiveDifficultyState,
    normalKillCount: number,
    activeRegularEnemies = 0,
  ) {
    this.windowStartKills = normalKillCount;
    this.windowStartActive = activeRegularEnemies;
  }

  recordRegularSpawn(count: number): void {
    this.spawnedInWindow += Math.max(0, Math.trunc(count));
  }

  update(
    delta: number,
    activeRegularEnemies: number,
    normalKillCount: number,
  ): DifficultyAdjustment | null {
    this.elapsedMs += delta;
    if (this.elapsedMs < ADAPTIVE_DIFFICULTY_INTERVAL_MS) return null;
    this.elapsedMs %= ADAPTIVE_DIFFICULTY_INTERVAL_MS;

    const active = Math.max(0, activeRegularEnemies);
    const kills = Math.max(0, normalKillCount - this.windowStartKills);
    const available = Math.max(1, this.windowStartActive + this.spawnedInWindow);
    const clearance = clamp(kills / available, 0, 1);
    const activePressureLine = Math.max(20, Math.floor(this.effectiveActiveTarget() * 0.6));
    const wasPaused = this.state.spawnPaused;
    const oldHpMultiplier = this.state.hpMultiplier;

    let pressure: DifficultyPressure;
    if (
      (kills === 0 && available >= 12) ||
      (clearance < 0.18 && active >= activePressureLine)
    ) {
      pressure = 'overwhelmed';
      this.applyOverwhelmedAdjustment(active);
    } else if (
      kills >= 30 &&
      clearance >= 0.78 &&
      active <= Math.max(18, Math.floor(this.state.activeTarget * 0.35))
    ) {
      pressure = 'fast';
      this.applyFastAdjustment();
    } else {
      pressure = 'steady';
      this.applySteadyAdjustment(active, wasPaused);
    }

    this.state.adjustmentCount++;
    const adjustment: DifficultyAdjustment = {
      pressure,
      hpScaleRatio: this.state.hpMultiplier / oldHpMultiplier,
      message: this.messageFor(
        pressure,
        wasPaused,
        this.state.hpMultiplier / oldHpMultiplier,
      ),
    };

    this.windowStartKills = normalKillCount;
    this.windowStartActive = active;
    this.spawnedInWindow = 0;
    return adjustment;
  }

  canSpawn(totalActiveEnemies: number, activeRegularEnemies: number): boolean {
    return !this.state.spawnPaused &&
      totalActiveEnemies < ADAPTIVE_MAX_ENEMIES &&
      activeRegularEnemies < this.effectiveActiveTarget();
  }

  nextBatchSize(totalActiveEnemies: number, activeRegularEnemies: number): number {
    if (!this.canSpawn(totalActiveEnemies, activeRegularEnemies)) return 0;
    return Math.max(0, Math.min(
      this.state.spawnBatchSize,
      ADAPTIVE_MAX_ENEMIES - totalActiveEnemies,
      this.effectiveActiveTarget() - activeRegularEnemies,
    ));
  }

  isBossDue(normalKillCount: number, bossActive: boolean, totalActiveEnemies: number): boolean {
    if (bossActive || totalActiveEnemies >= ADAPTIVE_MAX_ENEMIES) return false;
    return normalKillCount - this.state.lastBossSpawnKillCount >= this.effectiveBossKillInterval();
  }

  recordBossSpawn(normalKillCount: number): void {
    this.state.lastBossSpawnKillCount = normalKillCount;
  }

  effectiveHpMultiplier(): number {
    return this.state.hpMultiplier * this.state.deathDifficultyMultiplier;
  }

  effectiveActiveTarget(): number {
    return clamp(
      Math.floor(this.state.activeTarget * this.state.deathDifficultyMultiplier),
      ADAPTIVE_MIN_ACTIVE_TARGET,
      ADAPTIVE_MAX_ENEMIES,
    );
  }

  effectiveBossKillInterval(): number {
    return Math.min(
      BOSS_KILL_INTERVAL,
      Math.ceil(this.state.bossKillInterval / this.state.deathDifficultyMultiplier),
    );
  }

  /** Applies one persistent 10% difficulty reduction and returns the HP ratio. */
  reduceAfterDeath(): number {
    const previous = this.state.deathDifficultyMultiplier;
    this.state.deathDifficultyMultiplier = Math.max(Number.MIN_VALUE, previous * 0.9);
    this.state.consecutiveFastWindows = 0;
    this.state.consecutiveSlowWindows = 0;
    return this.state.deathDifficultyMultiplier / previous;
  }

  private applyOverwhelmedAdjustment(active: number): void {
    this.state.consecutiveSlowWindows++;
    this.state.consecutiveFastWindows = 0;
    this.state.spawnPaused = true;
    this.state.spawnBatchSize = Math.max(1, this.state.spawnBatchSize - 1);
    this.state.spawnIntervalMs = Math.min(
      ADAPTIVE_MAX_SPAWN_INTERVAL_MS,
      Math.round(this.state.spawnIntervalMs * 1.2),
    );
    this.state.activeTarget = clamp(
      Math.min(
        Math.floor(this.state.activeTarget * 0.85),
        Math.max(ADAPTIVE_MIN_ACTIVE_TARGET, active),
      ),
      ADAPTIVE_MIN_ACTIVE_TARGET,
      ADAPTIVE_MAX_ENEMIES,
    );
    this.state.bossKillInterval = Math.min(
      BOSS_KILL_INTERVAL,
      this.state.bossKillInterval + 100,
    );

    // If reducing the spawn pressure for two minutes was not enough, ease HP
    // slightly as well. Existing enemies keep their current HP percentage.
    if (this.state.consecutiveSlowWindows >= 2 && this.state.hpMultiplier > 1) {
      this.state.hpMultiplier = Math.max(1, this.state.hpMultiplier * 0.96);
    }
  }

  private applyFastAdjustment(): void {
    this.state.consecutiveFastWindows++;
    this.state.consecutiveSlowWindows = 0;
    this.state.spawnPaused = false;
    const increaseCountThisMinute = this.state.adjustmentCount % 2 === 0;
    if (increaseCountThisMinute) {
      this.state.activeTarget = Math.min(ADAPTIVE_MAX_ENEMIES, this.state.activeTarget + 40);
      this.state.spawnBatchSize = Math.min(
        ADAPTIVE_MAX_SPAWN_BATCH,
        this.state.spawnBatchSize + 2,
      );
      this.state.spawnIntervalMs = Math.max(
        ADAPTIVE_MIN_SPAWN_INTERVAL_MS,
        Math.round(this.state.spawnIntervalMs * 0.9),
      );
    } else {
      this.state.hpMultiplier = Math.min(
        ADAPTIVE_MAX_HP_MULTIPLIER,
        this.state.hpMultiplier * 1.06,
      );
    }
    const bossAcceleration = 75 + Math.min(75, this.state.consecutiveFastWindows * 15);
    this.state.bossKillInterval = Math.max(
      ADAPTIVE_MIN_BOSS_KILL_INTERVAL,
      this.state.bossKillInterval - bossAcceleration,
    );
  }

  private applySteadyAdjustment(active: number, wasPaused: boolean): void {
    this.state.consecutiveFastWindows = 0;
    this.state.consecutiveSlowWindows = 0;
    this.state.spawnPaused = false;
    this.state.bossKillInterval = Math.min(
      BOSS_KILL_INTERVAL,
      this.state.bossKillInterval + 50,
    );

    // A flat or growing field means production is matching/exceeding the
    // player's clear speed. Keep supplying enemies, but do it more slowly.
    if (!wasPaused && active >= this.windowStartActive && this.spawnedInWindow > 0) {
      this.state.spawnBatchSize = Math.max(1, this.state.spawnBatchSize - 1);
      this.state.spawnIntervalMs = Math.min(
        ADAPTIVE_MAX_SPAWN_INTERVAL_MS,
        this.state.spawnIntervalMs + 150,
      );
    }
  }

  private messageFor(
    pressure: DifficultyPressure,
    wasPaused: boolean,
    hpScaleRatio: number,
  ): string | undefined {
    if (pressure === 'overwhelmed') {
      return wasPaused
        ? undefined
        : '자동 난이도 조정 · 현재 몬스터를 정리할 때까지 생성을 멈춥니다.';
    }
    if (wasPaused) return '자동 난이도 조정 · 몬스터 생성을 천천히 다시 시작합니다.';
    if (pressure !== 'fast') return undefined;
    return hpScaleRatio > 1
      ? '자동 난이도 조정 · 몬스터 체력이 조금 증가합니다.'
      : '자동 난이도 조정 · 몬스터 수가 조금 증가합니다.';
  }
}
