import {
  RUNE_SPAWN_CHANCE,
  RUNE_SPAWN_ENEMY_BONUS_PER_100,
  RUNE_SPAWN_ENEMY_THRESHOLD,
  RUNE_SPAWN_MAX_CHANCE,
} from '../config/constants';

/**
 * Keeps the normal rune rate for a manageable crowd, then raises it smoothly
 * by 5 percentage points per additional 100 active enemies.
 */
export function getRuneSpawnChance(activeEnemyCount: number): number {
  const enemyCount = Number.isFinite(activeEnemyCount)
    ? Math.max(0, activeEnemyCount)
    : 0;
  const excessEnemies = Math.max(0, enemyCount - RUNE_SPAWN_ENEMY_THRESHOLD);
  const crowdBonus = (excessEnemies / 100) * RUNE_SPAWN_ENEMY_BONUS_PER_100;
  return Math.min(RUNE_SPAWN_MAX_CHANCE, RUNE_SPAWN_CHANCE + crowdBonus);
}
