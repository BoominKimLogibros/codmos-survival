export const BOSS_SUCCESS_RADIUS = 112;
export const BOSS_SUCCESS_TICK_MS = 100;

export function bossSuccessDamage(level: number): number {
  return Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
}

export function isInsideBossSuccessRange(
  playerX: number,
  playerY: number,
  enemyX: number,
  enemyY: number,
  radius = BOSS_SUCCESS_RADIUS,
): boolean {
  const dx = enemyX - playerX;
  const dy = enemyY - playerY;
  return dx * dx + dy * dy <= radius * radius;
}
