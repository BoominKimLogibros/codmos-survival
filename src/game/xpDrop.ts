export type XpDropKind = 'regular' | 'boss';

export const BOSS_XP_REWARD_TEXTURE_KEY = 'bossXpReward';
export const BOSS_XP_REWARD_DISPLAY_WIDTH = 64;
export const BOSS_XP_REWARD_DISPLAY_HEIGHT = 58;
export const BOSS_XP_REWARD_PICKUP_SIZE = 44;

export function regularXpDropSize(value: number, maximum = 34): number {
  const safeValue = Math.max(1, value);
  return Math.max(22, Math.min(maximum, 20 + Math.log2(safeValue + 1) * 2));
}
