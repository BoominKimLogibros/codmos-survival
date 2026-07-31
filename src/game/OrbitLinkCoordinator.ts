import type { PlayerController } from './PlayerController';
import {
  ORBIT_BASE_RADIUS,
  ORBIT_ROTATION_SPEED,
  type WeaponSystem,
} from './WeaponSystem';
import {
  ORBIT_KNOCKBACK_DURATION_MS,
  ORBIT_KNOCKBACK_STRENGTH,
  directionalKnockback,
} from './knockback';

export const ORBIT_LINK_ENTER_DISTANCE = ORBIT_BASE_RADIUS * 2;
export const ORBIT_LINK_EXIT_DISTANCE = Math.round(ORBIT_LINK_ENTER_DISTANCE * 1.2);
const SHARED_ORBIT_PHASE_CYCLE = Math.PI * 4;
const SHARED_ORBIT_MIN_OVERLAP = 1;

export interface OrbitPair {
  leftId: string;
  rightId: string;
}

export interface OrbitLinkPoint {
  id: string;
  x: number;
  y: number;
}

function wrap(value: number, maximum: number): number {
  return ((value % maximum) + maximum) % maximum;
}

/** Deterministic nearest-neighbour pairing; every player can belong to one pair only. */
export function selectNearestOrbitPairs(
  points: OrbitLinkPoint[],
  maximumDistance = ORBIT_LINK_ENTER_DISTANCE,
): OrbitPair[] {
  const candidates: Array<OrbitPair & { distance: number }> = [];
  for (let leftIndex = 0; leftIndex < points.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex++) {
      const left = points[leftIndex];
      const right = points[rightIndex];
      const distance = Math.hypot(right.x - left.x, right.y - left.y);
      if (distance <= maximumDistance) candidates.push({ leftId: left.id, rightId: right.id, distance });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance ||
    left.leftId.localeCompare(right.leftId) || left.rightId.localeCompare(right.rightId));
  const used = new Set<string>();
  const pairs: OrbitPair[] = [];
  candidates.forEach(({ leftId, rightId }) => {
    if (used.has(leftId) || used.has(rightId)) return;
    used.add(leftId);
    used.add(rightId);
    pairs.push({ leftId, rightId });
  });
  return pairs;
}

function distanceBetween(left: WeaponSystem, right: WeaponSystem): number {
  const a = left.orbitOwnerPosition;
  const b = right.orbitOwnerPosition;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Returns a point on the outside boundary made by two overlapping orbit circles.
 *
 * The inside-facing arcs are deliberately skipped. The route follows the outer
 * arc around one player, changes circles at the lower intersection, follows the
 * other outer arc, then changes back at the upper intersection. This produces a
 * cloud-like outline instead of a figure-eight that crosses between players.
 */
export function sharedOuterOrbitPoint(
  left: { x: number; y: number },
  right: { x: number; y: number },
  phase: number,
): { x: number; y: number } {
  const actualDistance = Math.hypot(right.x - left.x, right.y - left.y);
  const directionX = actualDistance > 0.001 ? (right.x - left.x) / actualDistance : 1;
  const directionY = actualDistance > 0.001 ? (right.y - left.y) / actualDistance : 0;
  const perpendicularX = -directionY;
  const perpendicularY = directionX;

  // A linked pair remains connected briefly between the enter and exit
  // thresholds. Keep the two route circles slightly overlapping there so the
  // transition points stay above/below the centre line instead of collapsing
  // into a bridge through the players.
  const radius = Math.max(
    ORBIT_BASE_RADIUS,
    actualDistance / 2 + SHARED_ORBIT_MIN_OVERLAP,
  );
  const intersectionRatio = Math.min(1, Math.max(0, actualDistance / (radius * 2)));
  const intersectionAngle = Math.acos(intersectionRatio);
  const outerArcSweep = Math.PI * 2 - intersectionAngle * 2;
  const routeDistance = wrap(phase, SHARED_ORBIT_PHASE_CYCLE) /
    SHARED_ORBIT_PHASE_CYCLE * outerArcSweep * 2;
  const followsLeft = routeDistance < outerArcSweep;
  const angle = followsLeft
    ? intersectionAngle + routeDistance
    : Math.PI + intersectionAngle + (routeDistance - outerArcSweep);
  const center = followsLeft ? left : right;

  return {
    x: center.x + directionX * radius * Math.cos(angle) +
      perpendicularX * radius * Math.sin(angle),
    y: center.y + directionY * radius * Math.cos(angle) +
      perpendicularY * radius * Math.sin(angle),
  };
}

export function sharedOuterTrainPositions(
  left: { x: number; y: number },
  right: { x: number; y: number },
  count: number,
  phase = 0,
): Array<{ x: number; y: number }> {
  const trainLength = Math.min(16, Math.max(0, Math.floor(count)));
  return Array.from({ length: trainLength }, (_, index) => (
    sharedOuterOrbitPoint(
      left,
      right,
      phase + (index / trainLength) * SHARED_ORBIT_PHASE_CYCLE,
    )
  ));
}

/** Pairs nearby host-authoritative orbit weapons along one cloud-like outer boundary. */
export class OrbitLinkCoordinator {
  private readonly partners = new Map<string, string>();
  private phase = 0;

  constructor(
    private readonly players: Map<string, PlayerController>,
    private readonly weapons: Map<string, WeaponSystem>,
  ) {}

  update(delta: number): void {
    this.phase = Phaser.Math.Wrap(
      this.phase + Math.max(0, delta) * ORBIT_ROTATION_SPEED,
      0,
      SHARED_ORBIT_PHASE_CYCLE,
    );
    this.removeInvalidPairs();
    this.createNearestPairs();
    this.currentPairs().forEach((pair) => this.arrangePair(pair));
  }

  removePlayer(playerId: string): void {
    const partnerId = this.partners.get(playerId);
    this.partners.delete(playerId);
    if (partnerId) this.partners.delete(partnerId);
  }

  private isEligible(playerId: string): boolean {
    const player = this.players.get(playerId);
    const weapon = this.weapons.get(playerId);
    return Boolean(player && weapon && player.stats.hp > 0 && player.sprite.active && weapon.canLinkOrbit);
  }

  private removeInvalidPairs(): void {
    for (const pair of this.currentPairs()) {
      const left = this.weapons.get(pair.leftId);
      const right = this.weapons.get(pair.rightId);
      if (
        !left || !right ||
        !this.isEligible(pair.leftId) || !this.isEligible(pair.rightId) ||
        distanceBetween(left, right) > ORBIT_LINK_EXIT_DISTANCE
      ) this.removePlayer(pair.leftId);
    }
  }

  private createNearestPairs(): void {
    const available = [...this.weapons.keys()].filter((id) => (
      !this.partners.has(id) && this.isEligible(id)
    )).map((id) => ({ id, ...this.weapons.get(id)!.orbitOwnerPosition }));
    selectNearestOrbitPairs(available).forEach(({ leftId, rightId }) => {
      this.partners.set(leftId, rightId);
      this.partners.set(rightId, leftId);
    });
  }

  private currentPairs(): OrbitPair[] {
    const pairs: OrbitPair[] = [];
    const visited = new Set<string>();
    for (const [leftId, rightId] of this.partners) {
      if (visited.has(leftId) || visited.has(rightId)) continue;
      visited.add(leftId);
      visited.add(rightId);
      pairs.push({ leftId, rightId });
    }
    return pairs;
  }

  private arrangePair(pair: OrbitPair): void {
    const leftWeapon = this.weapons.get(pair.leftId);
    const rightWeapon = this.weapons.get(pair.rightId);
    if (!leftWeapon || !rightWeapon) return;
    const shields = [
      ...leftWeapon.getActiveOrbitShields(),
      ...rightWeapon.getActiveOrbitShields(),
    ];
    if (shields.length === 0) return;
    const left = leftWeapon.orbitOwnerPosition;
    const right = rightWeapon.orbitOwnerPosition;
    const positions = sharedOuterTrainPositions(left, right, shields.length, this.phase);
    const nextPositions = sharedOuterTrainPositions(
      left,
      right,
      shields.length,
      this.phase + 0.001,
    );
    shields.slice(0, positions.length).forEach((shield, index) => {
      shield.knockback = directionalKnockback(
        nextPositions[index].x - positions[index].x,
        nextPositions[index].y - positions[index].y,
        ORBIT_KNOCKBACK_STRENGTH,
        ORBIT_KNOCKBACK_DURATION_MS,
      );
      shield.setPosition(positions[index].x, positions[index].y)
        .setRotation(this.phase + (index / positions.length) * Math.PI * 4);
    });
  }
}
