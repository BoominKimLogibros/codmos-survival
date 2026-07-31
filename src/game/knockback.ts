import type { EnemyKnockback } from './types';

export const FLAG_KNOCKBACK_STRENGTH = 145;
export const FLAG_KNOCKBACK_DURATION_MS = 160;
export const ORBIT_KNOCKBACK_STRENGTH = 90;
export const ORBIT_KNOCKBACK_DURATION_MS = 120;
export const EXPLOSION_KNOCKBACK_STRENGTH = 460;
export const EXPLOSION_KNOCKBACK_DURATION_MS = 340;

export function directionalKnockback(
  directionX: number,
  directionY: number,
  strength: number,
  durationMs: number,
): EnemyKnockback {
  const length = Math.hypot(directionX, directionY);
  const normalizedX = length > 0.0001 ? directionX / length : 1;
  const normalizedY = length > 0.0001 ? directionY / length : 0;
  return {
    directionX: normalizedX,
    directionY: normalizedY,
    strength: Math.max(0, strength),
    durationMs: Math.max(0, durationMs),
  };
}

export function radialKnockback(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
  strength: number,
  durationMs: number,
): EnemyKnockback {
  return directionalKnockback(
    targetX - originX,
    targetY - originY,
    strength,
    durationMs,
  );
}

export function shouldApplyKnockback(
  currentUntil: number,
  currentStrength: number,
  now: number,
  nextStrength: number,
): boolean {
  return currentUntil <= now || nextStrength >= currentStrength;
}
