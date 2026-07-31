import type { PenalizedPlayerStat } from '../game/progression';

export const PLAYER_STAT_KEYS: readonly PenalizedPlayerStat[] = [
  'maxHp',
  'armor',
  'speed',
  'magnet',
  'recovery',
];

export const PLAYER_STAT_ICONS: Record<PenalizedPlayerStat, string> = {
  maxHp: 'statMaxHpIcon',
  armor: 'statArmorIcon',
  speed: 'statMoveSpeedIcon',
  magnet: 'statMagnetIcon',
  recovery: 'statRecoveryIcon',
};
