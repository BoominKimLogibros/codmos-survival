const AURA_BASE_DIAMETER = 100;
const AURA_FADE_CYCLE_MS = 1800;
const AURA_MIN_ALPHA = 0.16;
const AURA_MAX_ALPHA = 0.5;

/** Keeps the aura asset aligned with its gameplay radius and softly fades it in/out. */
export function updateAuraPresentation(
  sprite: Phaser.GameObjects.Image,
  x: number,
  y: number,
  scale: number,
  timeMs: number,
): void {
  const fadeRatio = (Math.sin(timeMs * Math.PI * 2 / AURA_FADE_CYCLE_MS) + 1) / 2;
  const alpha = Phaser.Math.Linear(AURA_MIN_ALPHA, AURA_MAX_ALPHA, fadeRatio);
  const diameter = AURA_BASE_DIAMETER * scale;
  sprite
    .setPosition(x, y)
    .setDisplaySize(diameter, diameter)
    .setAlpha(alpha)
    .setVisible(true);
}
