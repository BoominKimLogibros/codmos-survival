import { MAX_WEAPON_LEVEL } from '../config/constants';
import type { GameSaveState, PlayerStats, WeaponKey } from './types';

/** Experience required to advance from the supplied level. */
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

export type PenalizedPlayerStat = 'maxHp' | 'speed' | 'armor' | 'magnet' | 'recovery';

export interface DeathPenaltyResult {
  levelBefore: number;
  levelAfter: number;
  stat?: PenalizedPlayerStat;
}

export const PLAYER_STAT_RULES: Record<PenalizedPlayerStat, {
  minimum: number;
  amount: number;
}> = {
  maxHp: { minimum: 100, amount: 20 },
  speed: { minimum: 200, amount: 15 },
  armor: { minimum: 0, amount: 2 },
  magnet: { minimum: 80, amount: 30 },
  recovery: { minimum: 0, amount: 0.5 },
};

export const PLAYER_STAT_LABELS: Record<PenalizedPlayerStat, string> = {
  maxHp: '최대 HP',
  speed: '이동속도',
  armor: '방어력',
  magnet: '자석',
  recovery: '회복',
};

export function calculatePlayerStatLevel(
  stats: PlayerStats,
  stat: PenalizedPlayerStat,
): number {
  const rule = PLAYER_STAT_RULES[stat];
  return Math.max(0, Math.floor((stats[stat] - rule.minimum) / rule.amount + 1e-8));
}

function randomIndex(length: number, random: () => number): number {
  return Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
}

export function clampXpAfterLevelLoss(stats: Pick<PlayerStats, 'level' | 'xp' | 'xpToNext'>): void {
  stats.xpToNext = experienceToNextLevel(stats.level);
  stats.xp = Math.min(Math.max(0, stats.xp), Math.max(0, stats.xpToNext - 1));
}

export function applyDeathPenalty(
  stats: PlayerStats,
  random: () => number = Math.random,
): DeathPenaltyResult {
  const levelBefore = stats.level;
  stats.level = Math.max(1, Math.floor(stats.level) - 1);
  clampXpAfterLevelLoss(stats);

  const candidates = (Object.keys(PLAYER_STAT_RULES) as PenalizedPlayerStat[])
    .filter((key) => stats[key] > PLAYER_STAT_RULES[key].minimum);
  const stat = candidates.length > 0 ? candidates[randomIndex(candidates.length, random)] : undefined;
  if (stat) {
    const rule = PLAYER_STAT_RULES[stat];
    stats[stat] = Math.max(rule.minimum, stats[stat] - rule.amount);
    if (stat === 'maxHp') stats.hp = Math.min(stats.hp, stats.maxHp);
  }
  return { levelBefore, levelAfter: stats.level, stat };
}

export function calculateEnhancementLevel(
  state: Pick<GameSaveState, 'stats' | 'weaponLevels'>,
): number {
  return state.stats.weapons.reduce((sum, key) => (
    sum + Math.max(0, Math.floor(state.weaponLevels[key] ?? 1) - 1)
  ), 0);
}

export function calculateEffectiveUnlockLevel(
  state: Pick<GameSaveState, 'stats' | 'weaponLevels'>,
): number {
  return Math.max(1, Math.floor(state.stats.level)) + calculateEnhancementLevel(state);
}

export interface SkillTradeResult {
  attempted: boolean;
  success: boolean;
  chancePercent: number;
  selectedSkill: WeaponKey;
  penaltySkill?: WeaponKey;
  penaltyStat?: PenalizedPlayerStat;
  penaltyLevelAfter?: number;
  levelBefore: number;
  levelAfter: number;
  reason?: 'level-too-low' | 'skill-not-learned' | 'skill-at-cap' | 'no-penalty-candidate';
}

export type SkillTradePenaltyCandidate =
  | { type: 'skill'; key: WeaponKey; level: number }
  | { type: 'stat'; key: PenalizedPlayerStat; level: number };

export function getSkillTradePenaltyCandidates(
  state: Pick<GameSaveState, 'stats' | 'weaponLevels'>,
  selectedSkill: WeaponKey,
): SkillTradePenaltyCandidate[] {
  const skillCandidates: SkillTradePenaltyCandidate[] = state.stats.weapons
    .filter((key) => key !== selectedSkill && state.weaponLevels[key] > 0)
    .map((key) => ({ type: 'skill', key, level: state.weaponLevels[key] }));
  const statCandidates: SkillTradePenaltyCandidate[] = (
    Object.keys(PLAYER_STAT_RULES) as PenalizedPlayerStat[]
  ).map((key) => ({ type: 'stat' as const, key, level: calculatePlayerStatLevel(state.stats, key) }))
    .filter((candidate) => candidate.level > 0);
  return [...skillCandidates, ...statCandidates];
}

export function applySkillTrade(
  state: GameSaveState,
  selectedSkill: WeaponKey,
  random: () => number = Math.random,
): SkillTradeResult {
  const levelBefore = Math.max(1, Math.floor(state.stats.level));
  const chancePercent = Math.min(100, levelBefore);
  const base = {
    success: false,
    chancePercent,
    selectedSkill,
    levelBefore,
    levelAfter: levelBefore,
  };
  if (levelBefore <= 1) return { ...base, attempted: false, reason: 'level-too-low' };
  if (!state.stats.weapons.includes(selectedSkill)) {
    return { ...base, attempted: false, reason: 'skill-not-learned' };
  }
  if (state.weaponLevels[selectedSkill] >= MAX_WEAPON_LEVEL) {
    return { ...base, attempted: false, reason: 'skill-at-cap' };
  }
  const penaltyCandidates = getSkillTradePenaltyCandidates(state, selectedSkill);
  if (penaltyCandidates.length === 0) {
    return { ...base, attempted: false, reason: 'no-penalty-candidate' };
  }

  const success = random() * 100 < chancePercent;
  state.stats.level = levelBefore - 1;
  clampXpAfterLevelLoss(state.stats);
  if (success) state.weaponLevels[selectedSkill]++;

  const penalty = penaltyCandidates[randomIndex(penaltyCandidates.length, random)];
  let penaltySkill: WeaponKey | undefined;
  let penaltyStat: PenalizedPlayerStat | undefined;
  let penaltyLevelAfter: number | undefined;
  if (penalty.type === 'skill') {
    penaltySkill = penalty.key;
    state.weaponLevels[penalty.key] = Math.max(0, state.weaponLevels[penalty.key] - 1);
    penaltyLevelAfter = state.weaponLevels[penalty.key];
    if (penaltyLevelAfter === 0) {
      state.stats.weapons = state.stats.weapons.filter((key) => key !== penalty.key);
    }
  } else {
    penaltyStat = penalty.key;
    const rule = PLAYER_STAT_RULES[penalty.key];
    state.stats[penalty.key] = Math.max(
      rule.minimum,
      state.stats[penalty.key] - rule.amount,
    );
    if (penalty.key === 'maxHp') state.stats.hp = Math.min(state.stats.hp, state.stats.maxHp);
    penaltyLevelAfter = calculatePlayerStatLevel(state.stats, penalty.key);
  }

  return {
    attempted: true,
    success,
    chancePercent,
    selectedSkill,
    penaltySkill,
    penaltyStat,
    penaltyLevelAfter,
    levelBefore,
    levelAfter: state.stats.level,
  };
}
