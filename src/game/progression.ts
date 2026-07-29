/**
 * Experience required to advance from the supplied level.
 *
 * The previous 1.3 exponential curve jumped from 393 XP at level 15 to
 * 1,124 XP at level 19. A gentler 1.17 curve keeps later upgrades attainable
 * while still increasing the requirement every level.
 */
export function experienceToNextLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  return Math.max(10, Math.floor(10 * Math.pow(1.17, safeLevel - 1)));
}

/** Consumes exactly one level so each upgrade gets its own UI selection. */
export function advanceOneLevelIfReady(
  stats: Pick<PlayerStats, 'level' | 'xp' | 'xpToNext'>,
): boolean {
  if (
    !Number.isFinite(stats.xp) ||
    !Number.isFinite(stats.xpToNext) ||
    stats.xpToNext <= 0 ||
    stats.xp < stats.xpToNext
  ) return false;
  stats.xp -= stats.xpToNext;
  stats.level++;
  stats.xpToNext = experienceToNextLevel(stats.level);
  return true;
}
import type { PlayerStats } from './types';
