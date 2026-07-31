export const FLAG_ATTACK_TEXTURE_KEY = 'flagAttack';
export const FLAG_TEXTURE_WIDTH = 72;
export const FLAG_TEXTURE_HEIGHT = 65;
export const FLAG_HANDLE_PIXEL_X = 15;
export const FLAG_POLE_PIXEL_Y = 25;
export const FLAG_PIVOT_OFFSET_Y = -14;
export const FLAG_COLLISION_RADIUS = 22;
export const FLAG_DAMAGE_SAMPLE_COUNT = 4;
export const FLAG_ATTACK_DURATION_MS = 165;
export const FLAG_ATTACK_PEAK_HOLD_MS = 35;
export const FLAG_SWING_EFFECT_KEY = 'flagSwingEffect';
export const FLAG_SWING_EFFECT_SIZE = 96;
export const FLAG_SWING_EFFECT_PIVOT_X = 16;
export const FLAG_SWING_EFFECT_PIVOT_Y = 80;
export const FLAG_SWING_EFFECT_RADIUS = 62;

export function flagAttackProgress(progress: number): number {
  return Math.max(0, Math.min(1, progress));
}

export function flagSwingAngle(direction: 1 | -1, progress: number): number {
  const startAngle = direction > 0 ? -Math.PI / 2 : Math.PI / 2;
  const remaining = 1 - flagAttackProgress(progress);
  return remaining === 0 ? 0 : startAngle * remaining;
}

/** Unit tangent of the visible 12-to-3 / 12-to-9 downward swing. */
export function flagSwingDirection(
  direction: 1 | -1,
  progress: number,
): { x: number; y: number } {
  const angle = flagSwingAngle(direction, progress) + (direction < 0 ? Math.PI : 0);
  return direction > 0
    ? { x: -Math.sin(angle), y: Math.cos(angle) }
    : { x: Math.sin(angle), y: -Math.cos(angle) };
}

export function flagContactPoint(
  playerX: number,
  playerY: number,
  direction: 1 | -1,
  range: number,
  progress: number,
): { x: number; y: number } {
  const angle = flagSwingAngle(direction, progress) + (direction < 0 ? Math.PI : 0);
  return {
    x: playerX + Math.cos(angle) * range,
    y: playerY + FLAG_PIVOT_OFFSET_Y + Math.sin(angle) * range,
  };
}

/**
 * Samples an overlapping capsule-like damage area from the player's hand to
 * the flag tip. Arcade bodies do not rotate, so several circles keep the
 * damage area aligned with the visible flag throughout the swing.
 */
export function flagDamagePoints(
  playerX: number,
  playerY: number,
  direction: 1 | -1,
  range: number,
  progress: number,
): Array<{ x: number; y: number }> {
  const pivotY = playerY + FLAG_PIVOT_OFFSET_Y;
  const contact = flagContactPoint(playerX, playerY, direction, range, progress);
  return Array.from({ length: FLAG_DAMAGE_SAMPLE_COUNT }, (_, index) => {
    const ratio = (index + 0.5) / FLAG_DAMAGE_SAMPLE_COUNT;
    return {
      x: playerX + (contact.x - playerX) * ratio,
      y: pivotY + (contact.y - pivotY) * ratio,
    };
  });
}

export function flagOriginX(direction: 1 | -1): number {
  const rightOrigin = FLAG_HANDLE_PIXEL_X / FLAG_TEXTURE_WIDTH;
  return direction > 0 ? rightOrigin : 1 - rightOrigin;
}

export function flagEffectOriginX(direction: 1 | -1): number {
  const rightOrigin = FLAG_SWING_EFFECT_PIVOT_X / FLAG_SWING_EFFECT_SIZE;
  return direction > 0 ? rightOrigin : 1 - rightOrigin;
}

export function flagSwingEffectAlpha(progress: number): number {
  const clamped = flagAttackProgress(progress);
  if (clamped <= 0.18) return clamped / 0.18;
  return Math.max(0, (1 - clamped) / 0.82);
}

/** Creates a separate yellow quarter-circle trail behind the swinging flag. */
export function createFlagSwingEffectTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(FLAG_SWING_EFFECT_KEY)) return;
  const graphics = scene.add.graphics();
  const startAngle = -Math.PI / 2;
  const endAngle = 0;
  graphics.lineStyle(15, 0xf59e0b, 0.2);
  graphics.beginPath();
  graphics.arc(
    FLAG_SWING_EFFECT_PIVOT_X,
    FLAG_SWING_EFFECT_PIVOT_Y,
    FLAG_SWING_EFFECT_RADIUS,
    startAngle,
    endAngle,
  );
  graphics.strokePath();
  graphics.lineStyle(8, 0xffc928, 0.72);
  graphics.beginPath();
  graphics.arc(
    FLAG_SWING_EFFECT_PIVOT_X,
    FLAG_SWING_EFFECT_PIVOT_Y,
    FLAG_SWING_EFFECT_RADIUS,
    startAngle + 0.08,
    endAngle - 0.04,
  );
  graphics.strokePath();
  graphics.lineStyle(3, 0xfff2a6, 0.96);
  graphics.beginPath();
  graphics.arc(
    FLAG_SWING_EFFECT_PIVOT_X,
    FLAG_SWING_EFFECT_PIVOT_Y,
    FLAG_SWING_EFFECT_RADIUS - 7,
    startAngle + 0.18,
    endAngle - 0.08,
  );
  graphics.strokePath();
  graphics.fillStyle(0xfff8cc, 0.95);
  graphics.fillTriangle(74, 72, 90, 80, 73, 87);
  graphics.generateTexture(
    FLAG_SWING_EFFECT_KEY,
    FLAG_SWING_EFFECT_SIZE,
    FLAG_SWING_EFFECT_SIZE,
  );
  graphics.destroy();
}
