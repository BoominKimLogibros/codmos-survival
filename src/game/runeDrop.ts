import {
  RUNE_EMERGE_DELAY_MS,
  RUNE_EMERGE_DURATION_MS,
  RUNE_EMERGE_START_OFFSET_Y,
} from '../config/constants';

export type RuneDropPhase = 'embedded' | 'emerging' | 'available';

export interface RuneDropVisualState {
  phase: RuneDropPhase;
  offsetY: number;
  available: boolean;
}

/** Returns the shared single-player/host presentation state for a spawned rune. */
export function runeDropVisualState(elapsedMs: number): RuneDropVisualState {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < RUNE_EMERGE_DELAY_MS) {
    return { phase: 'embedded', offsetY: 0, available: false };
  }

  const progress = Math.min(
    1,
    (elapsed - RUNE_EMERGE_DELAY_MS) / RUNE_EMERGE_DURATION_MS,
  );
  const easedProgress = 1 - (1 - progress) ** 3;
  return {
    phase: progress < 1 ? 'emerging' : 'available',
    offsetY: RUNE_EMERGE_START_OFFSET_Y * (1 - easedProgress),
    available: progress >= 1,
  };
}

export function runeTextureKey(phase: RuneDropPhase): 'runeEmbedded' | 'runeItem' {
  return phase === 'embedded' ? 'runeEmbedded' : 'runeItem';
}
