export const EXPLOSION_FUSE_DURATION_MS = 1000;

export interface ExplosionPoint {
  x: number;
  y: number;
}

export interface ExplosionTargetBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function createPlayerViewportBounds(
  playerX: number,
  playerY: number,
  viewportWidth: number,
  viewportHeight: number,
  worldSize: number,
  padding: number,
): ExplosionTargetBounds {
  const safeWorldSize = Math.max(64, worldSize);
  const width = Math.min(safeWorldSize, Math.max(64, viewportWidth));
  const height = Math.min(safeWorldSize, Math.max(64, viewportHeight));
  const halfWorld = safeWorldSize / 2;
  const viewportLeft = clamp(playerX - width / 2, -halfWorld, halfWorld - width);
  const viewportTop = clamp(playerY - height / 2, -halfWorld, halfWorld - height);
  const insetX = Math.min(Math.max(0, padding), Math.max(0, width / 2 - 24));
  const insetY = Math.min(Math.max(0, padding), Math.max(0, height / 2 - 24));
  return {
    left: viewportLeft + insetX,
    right: viewportLeft + width - insetX,
    top: viewportTop + insetY,
    bottom: viewportTop + height - insetY,
  };
}

export function insetViewportBounds(
  bounds: ExplosionTargetBounds,
  padding: number,
): ExplosionTargetBounds {
  const width = Math.max(0, bounds.right - bounds.left);
  const height = Math.max(0, bounds.bottom - bounds.top);
  const insetX = Math.min(Math.max(0, padding), Math.max(0, width / 2 - 24));
  const insetY = Math.min(Math.max(0, padding), Math.max(0, height / 2 - 24));
  return {
    left: bounds.left + insetX,
    right: bounds.right - insetX,
    top: bounds.top + insetY,
    bottom: bounds.bottom - insetY,
  };
}

export function isPointInExplosionBounds(
  point: ExplosionPoint,
  bounds: ExplosionTargetBounds,
): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= bounds.left && point.x <= bounds.right &&
    point.y >= bounds.top && point.y <= bounds.bottom;
}

/** Picks visible enemy clusters first and spreads multiple bombs where possible. */
export function selectVisibleExplosionTargets<T extends ExplosionPoint>(
  targets: readonly T[],
  bounds: ExplosionTargetBounds,
  radius: number,
  count: number,
  origin: ExplosionPoint,
): T[] {
  const visible = targets.filter((target) => isPointInExplosionBounds(target, bounds));
  const remaining = [...visible];
  const selected: T[] = [];
  const radiusSquared = Math.max(1, radius * radius);
  const spreadSquared = radiusSquared * 1.44;

  while (selected.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -1;
    let bestOriginDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((candidate, index) => {
      const score = visible.reduce((total, target) => (
        total + (squaredDistance(candidate, target) <= radiusSquared ? 1 : 0)
      ), 0);
      const originDistance = squaredDistance(candidate, origin);
      if (score > bestScore || (score === bestScore && originDistance < bestOriginDistance)) {
        bestIndex = index;
        bestScore = score;
        bestOriginDistance = originDistance;
      }
    });
    const [best] = remaining.splice(bestIndex, 1);
    selected.push(best);
    for (let index = remaining.length - 1; index >= 0; index--) {
      if (squaredDistance(best, remaining[index]) < spreadSquared) remaining.splice(index, 1);
    }
  }
  return selected;
}

export function fallbackExplosionPoint(
  bounds: ExplosionTargetBounds,
  origin: ExplosionPoint,
  index: number,
  count: number,
  facingRight: boolean,
): ExplosionPoint {
  const direction = facingRight ? 0 : Math.PI;
  const offset = (index - (count - 1) / 2) * 0.52;
  const distance = Math.min(
    Math.max(48, bounds.right - bounds.left),
    Math.max(48, bounds.bottom - bounds.top),
  ) * 0.28;
  return {
    x: clamp(origin.x + Math.cos(direction + offset) * distance, bounds.left, bounds.right),
    y: clamp(origin.y + Math.sin(direction + offset) * distance, bounds.top, bounds.bottom),
  };
}

function squaredDistance(first: ExplosionPoint, second: ExplosionPoint): number {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return (minimum + maximum) / 2;
  return Math.max(minimum, Math.min(maximum, value));
}
