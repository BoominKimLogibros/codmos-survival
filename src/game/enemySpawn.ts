export const MONSTER_PORTAL_DURATION_MS = 1_333;
export const MONSTER_PORTAL_EMERGE_DURATION_MS = 500;

export function monsterPortalRemainingMs(spawnEndsAt: number | undefined, now: number): number {
  if (!Number.isFinite(spawnEndsAt)) return 0;
  return Math.max(0, Math.ceil((spawnEndsAt ?? 0) - now));
}

export function isMonsterEnteringPortal(
  spawnEndsAt: number | undefined,
  now: number,
): boolean {
  return monsterPortalRemainingMs(spawnEndsAt, now) > 0;
}
