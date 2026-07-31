import {
  ADAPTIVE_DIFFICULTY_INTERVAL_MS,
  ADAPTIVE_MAX_ENEMIES,
  ADAPTIVE_MAX_HP_MULTIPLIER,
  ADAPTIVE_MAX_CONCURRENT_BOSSES,
  ADAPTIVE_MAX_SPAWN_BATCH,
  ADAPTIVE_MAX_SPAWN_INTERVAL_MS,
  ADAPTIVE_MIN_ACTIVE_TARGET,
  ADAPTIVE_MIN_BOSS_KILL_INTERVAL,
  ADAPTIVE_MIN_SPAWN_INTERVAL_MS,
  ADAPTIVE_FAST_WINDOWS_PER_EXTRA_BOSS,
  BOSS_KILL_INTERVAL,
} from '../config/constants';
import type { AdaptiveDifficultyState } from './types';

export type DifficultyPressure = 'overwhelmed' | 'steady' | 'fast';
export type DifficultyGrowthTier = 'slight' | 'medium' | 'large' | 'extreme';

export interface DifficultyGrowthProfile {
  level: number;
  enhancementLevel: number;
}

export interface DifficultyGrowthAdjustment extends DifficultyGrowthProfile {
  tier: DifficultyGrowthTier;
  effectiveLevel: number;
  hpScaleRatio: number;
  message: string;
}

interface DifficultyGrowthConfig {
  label: string;
  minimumHpMultiplier: number;
  minimumActiveTarget: number;
  minimumSpawnBatch: number;
  maximumSpawnIntervalMs: number;
  maximumBossKillInterval: number;
  fastHpMultiplier: number;
  fastActiveIncrease: number;
  fastBatchIncrease: number;
  fastSpawnIntervalRatio: number;
  fastBossAccelerationRatio: number;
}

const DIFFICULTY_GROWTH_CONFIG: Record<DifficultyGrowthTier, DifficultyGrowthConfig> = {
  slight: {
    label: '소폭 상향',
    minimumHpMultiplier: 1.1,
    minimumActiveTarget: 90,
    minimumSpawnBatch: 3,
    maximumSpawnIntervalMs: 1400,
    maximumBossKillInterval: 950,
    fastHpMultiplier: 1.1,
    fastActiveIncrease: 40,
    fastBatchIncrease: 2,
    fastSpawnIntervalRatio: 0.9,
    fastBossAccelerationRatio: 1,
  },
  medium: {
    label: '중간 상향',
    minimumHpMultiplier: 1.35,
    minimumActiveTarget: 110,
    minimumSpawnBatch: 5,
    maximumSpawnIntervalMs: 1200,
    maximumBossKillInterval: 850,
    fastHpMultiplier: 1.16,
    fastActiveIncrease: 60,
    fastBatchIncrease: 3,
    fastSpawnIntervalRatio: 0.85,
    fastBossAccelerationRatio: 1.2,
  },
  large: {
    label: '큰 상향',
    minimumHpMultiplier: 1.8,
    minimumActiveTarget: 145,
    minimumSpawnBatch: 7,
    maximumSpawnIntervalMs: 900,
    maximumBossKillInterval: 650,
    fastHpMultiplier: 1.24,
    fastActiveIncrease: 90,
    fastBatchIncrease: 4,
    fastSpawnIntervalRatio: 0.78,
    fastBossAccelerationRatio: 1.5,
  },
  extreme: {
    label: '매우 큰 상향',
    minimumHpMultiplier: 2.6,
    minimumActiveTarget: 200,
    minimumSpawnBatch: 10,
    maximumSpawnIntervalMs: 650,
    maximumBossKillInterval: 450,
    fastHpMultiplier: 1.35,
    fastActiveIncrease: 130,
    fastBatchIncrease: 6,
    fastSpawnIntervalRatio: 0.68,
    fastBossAccelerationRatio: 2,
  },
};

function safeGrowthValue(value: number, minimum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : minimum;
}

export function difficultyEffectiveLevel(profile: DifficultyGrowthProfile): number {
  return safeGrowthValue(profile.level, 1) + safeGrowthValue(profile.enhancementLevel, 0);
}

export function classifyDifficultyGrowth(profile: DifficultyGrowthProfile): DifficultyGrowthTier {
  const effectiveLevel = difficultyEffectiveLevel(profile);
  if (effectiveLevel >= 50) return 'extreme';
  if (effectiveLevel >= 25) return 'large';
  if (effectiveLevel >= 10) return 'medium';
  return 'slight';
}

export function strongestDifficultyGrowthProfile(
  profiles: DifficultyGrowthProfile[],
): DifficultyGrowthProfile {
  return profiles.reduce<DifficultyGrowthProfile>((strongest, profile) => {
    const strongestEffective = difficultyEffectiveLevel(strongest);
    const profileEffective = difficultyEffectiveLevel(profile);
    if (profileEffective !== strongestEffective) {
      return profileEffective > strongestEffective ? profile : strongest;
    }
    return safeGrowthValue(profile.enhancementLevel, 0) >
      safeGrowthValue(strongest.enhancementLevel, 0) ? profile : strongest;
  }, { level: 1, enhancementLevel: 0 });
}

export interface DifficultyAdjustment {
  pressure: DifficultyPressure;
  hpScaleRatio: number;
  bossCount: number;
  message?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function scaleHealthPreservingRatio(
  hp: number,
  maxHp: number,
  scaleRatio: number,
): { hp: number; maxHp: number } {
  const ratio = clamp(hp / Math.max(1, maxHp), 0, 1);
  const nextMaxHp = Math.max(1, Math.floor(maxHp * scaleRatio));
  return { maxHp: nextMaxHp, hp: Math.max(1, Math.ceil(nextMaxHp * ratio)) };
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
  private growthTier: DifficultyGrowthTier | null = null;

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

  syncPlayerGrowth(profile: DifficultyGrowthProfile): DifficultyGrowthAdjustment | null {
    const level = safeGrowthValue(profile.level, 1);
    const enhancementLevel = safeGrowthValue(profile.enhancementLevel, 0);
    const normalized = { level, enhancementLevel };
    const tier = classifyDifficultyGrowth(normalized);
    if (tier === this.growthTier) return null;
    this.growthTier = tier;

    const config = DIFFICULTY_GROWTH_CONFIG[tier];
    const previousHpMultiplier = this.state.hpMultiplier;
    this.state.hpMultiplier = Math.min(
      ADAPTIVE_MAX_HP_MULTIPLIER,
      Math.max(this.state.hpMultiplier, config.minimumHpMultiplier),
    );
    this.state.activeTarget = Math.min(
      ADAPTIVE_MAX_ENEMIES,
      Math.max(this.state.activeTarget, config.minimumActiveTarget),
    );
    this.state.spawnBatchSize = Math.min(
      ADAPTIVE_MAX_SPAWN_BATCH,
      Math.max(this.state.spawnBatchSize, config.minimumSpawnBatch),
    );
    this.state.spawnIntervalMs = Math.max(
      ADAPTIVE_MIN_SPAWN_INTERVAL_MS,
      Math.min(this.state.spawnIntervalMs, config.maximumSpawnIntervalMs),
    );
    this.state.bossKillInterval = Math.max(
      ADAPTIVE_MIN_BOSS_KILL_INTERVAL,
      Math.min(this.state.bossKillInterval, config.maximumBossKillInterval),
    );
    const effectiveLevel = difficultyEffectiveLevel(normalized);
    return {
      ...normalized,
      tier,
      effectiveLevel,
      hpScaleRatio: this.state.hpMultiplier / previousHpMultiplier,
      message: `성장 난이도 · Lv.${level} + 강화 Lv.${enhancementLevel} = ${effectiveLevel} · ${config.label}`,
    };
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
    const oldBossCount = this.effectiveBossCount();

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
      bossCount: this.effectiveBossCount(),
      message: this.messageFor(
        pressure,
        wasPaused,
        this.state.hpMultiplier / oldHpMultiplier,
        oldBossCount,
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

  effectiveBossCount(): number {
    return clamp(
      1 + Math.floor(
        this.state.consecutiveFastWindows / ADAPTIVE_FAST_WINDOWS_PER_EXTRA_BOSS,
      ),
      1,
      ADAPTIVE_MAX_CONCURRENT_BOSSES,
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
    const config = DIFFICULTY_GROWTH_CONFIG[this.growthTier ?? 'slight'];
    this.state.consecutiveFastWindows++;
    this.state.consecutiveSlowWindows = 0;
    this.state.spawnPaused = false;
    this.state.hpMultiplier = Math.min(
      ADAPTIVE_MAX_HP_MULTIPLIER,
      this.state.hpMultiplier * config.fastHpMultiplier,
    );
    const increaseCountThisMinute = this.state.adjustmentCount % 2 === 0;
    if (increaseCountThisMinute) {
      this.state.activeTarget = Math.min(
        ADAPTIVE_MAX_ENEMIES,
        this.state.activeTarget + config.fastActiveIncrease,
      );
      this.state.spawnBatchSize = Math.min(
        ADAPTIVE_MAX_SPAWN_BATCH,
        this.state.spawnBatchSize + config.fastBatchIncrease,
      );
      this.state.spawnIntervalMs = Math.max(
        ADAPTIVE_MIN_SPAWN_INTERVAL_MS,
        Math.round(this.state.spawnIntervalMs * config.fastSpawnIntervalRatio),
      );
    }
    const bossAcceleration = Math.round(
      (75 + Math.min(75, this.state.consecutiveFastWindows * 15)) *
      config.fastBossAccelerationRatio,
    );
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
    oldBossCount: number,
  ): string | undefined {
    if (pressure === 'overwhelmed') {
      return wasPaused
        ? undefined
        : '자동 난이도 조정 · 현재 몬스터를 정리할 때까지 생성을 멈춥니다.';
    }
    if (wasPaused) return '자동 난이도 조정 · 몬스터 생성을 천천히 다시 시작합니다.';
    if (pressure !== 'fast') return undefined;
    const bossCount = this.effectiveBossCount();
    if (bossCount > oldBossCount) {
      return `자동 난이도 조정 · 쉬운 상태가 반복되어 다음 보스가 동시에 ${bossCount}마리 등장합니다.`;
    }
    const growthLabel = DIFFICULTY_GROWTH_CONFIG[this.growthTier ?? 'slight'].label;
    return hpScaleRatio > 1
      ? `자동 난이도 조정 · ${growthLabel}으로 몬스터 체력이 증가합니다.`
      : `자동 난이도 조정 · ${growthLabel}으로 몬스터 수가 증가합니다.`;
  }
}
