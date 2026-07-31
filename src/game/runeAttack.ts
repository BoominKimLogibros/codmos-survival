import type { EnemyType } from './types';

export const MULTI_ATTACK_BOSS_DAMAGE_RATIO = 0.35;

interface RuneAttackTarget {
  enemyType: EnemyType;
  hp: number;
  maxHp: number;
}

/** Shared by single-player and the multiplayer host to keep rune damage identical. */
export function multiAttackDamage(target: RuneAttackTarget, playerLevel: number): number {
  const level = Number.isFinite(playerLevel) ? Math.max(1, Math.floor(playerLevel)) : 1;
  const baseDamage = Math.max(100, level * 20);
  if (target.enemyType !== 'boss') return Math.max(0, target.hp);
  const maxHp = Number.isFinite(target.maxHp) ? Math.max(1, target.maxHp) : 1;
  return Math.max(
    baseDamage,
    Math.ceil(maxHp * MULTI_ATTACK_BOSS_DAMAGE_RATIO),
  );
}
