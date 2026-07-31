export type BossAttackStyle = 'slam' | 'strike' | 'heavy' | 'dash' | 'magic';
export type BossAttackPhase = 'chase' | 'windup' | 'attack' | 'recover';

export interface BossBehaviorProfile {
  name: string;
  trait: string;
  hpMultiplier: number;
  speedMultiplier: number;
  damageMultiplier: number;
  attackStyle: BossAttackStyle;
  attackAnimation: 'attack' | 'magic';
  hitAnimation: 'attacked' | 'stun';
  hitAnimationMs: number;
  triggerRange: number;
  hitRadius: number;
  windupMs: number;
  attackMs: number;
  recoveryMs: number;
  cooldownMs: number;
  maxTravel: number;
  telegraphColor: number;
}

export interface BossAttackVisualState {
  phase: BossAttackPhase;
  revision: number;
  progress: number;
  originX: number;
  originY: number;
  targetX: number;
  targetY: number;
  radius: number;
  style: BossAttackStyle;
}

/** One cycle of the shared summoning Spine followed by each boss's own spawn animation. */
export const BOSS_SUMMON_EFFECT_DURATION_MS = 1_333;
export const BOSS_SPAWN_ANIMATION_DURATION_MS = 667;
export const BOSS_ENTRY_DURATION_MS = (
  BOSS_SUMMON_EFFECT_DURATION_MS + BOSS_SPAWN_ANIMATION_DURATION_MS
);
export const BOSS_CONTACT_DAMAGE_MULTIPLIER = 0.25;
export const BOSS_CONTACT_INTERVAL_MS = 600;

export function bossContactDamage(baseDamage: number, armor: number): number {
  const contactDamage = Math.max(1, Math.round(
    Math.max(0, baseDamage) * BOSS_CONTACT_DAMAGE_MULTIPLIER,
  ));
  return Math.max(1, contactDamage - Math.max(0, armor));
}

export function bossEntryRemainingMs(spawnEndsAt: number | undefined, now: number): number {
  if (!Number.isFinite(spawnEndsAt)) return 0;
  return Math.max(0, Math.ceil((spawnEndsAt ?? 0) - now));
}

export function isBossEntering(spawnEndsAt: number | undefined, now: number): boolean {
  return bossEntryRemainingMs(spawnEndsAt, now) > 0;
}

export function bossAttackAnimationHasPriority(
  phase: BossAttackPhase | undefined,
): boolean {
  return phase === 'windup' || phase === 'attack';
}

/** Boss tiers cycle through these five Spine/image-matched archetypes. */
export const BOSS_BEHAVIOR_PROFILES: readonly BossBehaviorProfile[] = Object.freeze([
  {
    name: '화염 강타형',
    trait: '높은 체력 · 근접 범위 강타',
    hpMultiplier: 1.25,
    speedMultiplier: 0.9,
    damageMultiplier: 1.25,
    attackStyle: 'slam',
    attackAnimation: 'attack',
    hitAnimation: 'stun',
    hitAnimationMs: 667,
    triggerRange: 104,
    hitRadius: 90,
    windupMs: 620,
    attackMs: 130,
    recoveryMs: 480,
    cooldownMs: 1_100,
    maxTravel: 0,
    telegraphColor: 0xff9f43,
  },
  {
    name: '민첩 타격형',
    trait: '빠른 이동 · 짧고 잦은 공격',
    hpMultiplier: 0.95,
    speedMultiplier: 1.3,
    damageMultiplier: 0.9,
    attackStyle: 'strike',
    attackAnimation: 'attack',
    hitAnimation: 'stun',
    hitAnimationMs: 667,
    triggerRange: 86,
    hitRadius: 68,
    windupMs: 360,
    attackMs: 90,
    recoveryMs: 260,
    cooldownMs: 720,
    maxTravel: 0,
    telegraphColor: 0xffd166,
  },
  {
    name: '중장갑 파괴형',
    trait: '매우 높은 체력 · 느린 광역 강타',
    hpMultiplier: 1.8,
    speedMultiplier: 0.72,
    damageMultiplier: 1.5,
    attackStyle: 'heavy',
    attackAnimation: 'attack',
    hitAnimation: 'attacked',
    hitAnimationMs: 467,
    triggerRange: 122,
    hitRadius: 110,
    windupMs: 760,
    attackMs: 170,
    recoveryMs: 650,
    cooldownMs: 1_450,
    maxTravel: 0,
    telegraphColor: 0xff6b6b,
  },
  {
    name: '인라인 돌진형',
    trait: '매우 빠른 이동 · 직선 돌진',
    hpMultiplier: 0.9,
    speedMultiplier: 2.1,
    damageMultiplier: 1.1,
    attackStyle: 'dash',
    attackAnimation: 'attack',
    hitAnimation: 'attacked',
    hitAnimationMs: 667,
    triggerRange: 280,
    hitRadius: 46,
    windupMs: 480,
    attackMs: 320,
    recoveryMs: 300,
    cooldownMs: 900,
    maxTravel: 270,
    telegraphColor: 0x54a0ff,
  },
  {
    name: '빙결 마법형',
    trait: '원거리 예고 공격 · 넓은 폭발',
    hpMultiplier: 1.3,
    speedMultiplier: 0.88,
    damageMultiplier: 1.25,
    attackStyle: 'magic',
    attackAnimation: 'magic',
    hitAnimation: 'stun',
    hitAnimationMs: 667,
    triggerRange: 330,
    hitRadius: 94,
    windupMs: 1_000,
    attackMs: 180,
    recoveryMs: 550,
    cooldownMs: 1_250,
    maxTravel: 0,
    telegraphColor: 0x48dbfb,
  },
]);

export function bossProfileForTier(tier: number): BossBehaviorProfile {
  const normalizedTier = Math.max(1, Math.floor(Number.isFinite(tier) ? tier : 1));
  return BOSS_BEHAVIOR_PROFILES[(normalizedTier - 1) % BOSS_BEHAVIOR_PROFILES.length];
}

export function clampBossAttackTarget(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
  maxTravel: number,
): { x: number; y: number } {
  const dx = targetX - originX;
  const dy = targetY - originY;
  const distance = Math.hypot(dx, dy);
  if (distance <= maxTravel || distance === 0) return { x: targetX, y: targetY };
  const ratio = maxTravel / distance;
  return { x: originX + dx * ratio, y: originY + dy * ratio };
}

export function pointToSegmentDistanceSquared(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) {
    const dx = pointX - startX;
    const dy = pointY - startY;
    return dx * dx + dy * dy;
  }
  const projection = Math.max(0, Math.min(1, (
    (pointX - startX) * segmentX + (pointY - startY) * segmentY
  ) / lengthSquared));
  const nearestX = startX + segmentX * projection;
  const nearestY = startY + segmentY * projection;
  const dx = pointX - nearestX;
  const dy = pointY - nearestY;
  return dx * dx + dy * dy;
}

export function isPointInBossAttack(
  style: BossAttackStyle,
  pointX: number,
  pointY: number,
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
  radius: number,
): boolean {
  const distanceSquared = style === 'dash'
    ? pointToSegmentDistanceSquared(pointX, pointY, originX, originY, targetX, targetY)
    : (pointX - targetX) ** 2 + (pointY - targetY) ** 2;
  return distanceSquared <= radius * radius;
}
