import { createInitialAdaptiveDifficultyState, type GameSaveState } from '../game/types';

export function createDefaultGameState(): GameSaveState {
  return {
    gameTime: 0,
    killCount: 0,
    player: { x: 0, y: 0 },
    stats: {
      maxHp: 100,
      hp: 100,
      speed: 200,
      level: 1,
      xp: 0,
      xpToNext: 10,
      armor: 0,
      magnet: 80,
      recovery: 0,
      weapons: ['whip'],
    },
    weaponLevels: {
      whip: 1,
      bolt: 1,
      aura: 1,
      explosion: 1,
      shield: 1,
    },
    progression: {
      normalGeneration: 1,
      normalSpawnedInGeneration: 0,
      normalKillCount: 0,
      lastCompressedRollMinute: 0,
      bossGeneration: 0,
      lastBossKillMilestone: 0,
      lastRuneRollInterval: 0,
      adaptiveDifficulty: createInitialAdaptiveDifficultyState(),
    },
  };
}
