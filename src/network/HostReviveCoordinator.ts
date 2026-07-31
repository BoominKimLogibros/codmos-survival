import type { PlayerController } from '../game/PlayerController';
import { REVIVE_DURATION_MS, REVIVE_RADIUS } from '../game/revive';
import { DeathMarker } from '../objects/DeathMarker';
import { ReviveMarker } from '../objects/ReviveMarker';
import type { NetReviveState } from './gameProtocol';

interface ActiveRevive {
  playerId: string;
  playerName: string;
  x: number;
  y: number;
  chargeMs: number;
  chargingPlayerId?: string;
  marker?: ReviveMarker;
}

/** Runs resurrection progress only from positions simulated by the host. */
export class HostReviveCoordinator {
  private readonly active = new Map<string, ActiveRevive>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly players: Map<string, PlayerController>,
    private readonly canRevive: (playerId: string) => boolean,
    private readonly onRevived: (
      playerId: string,
      reviverPlayerId: string,
      position: { x: number; y: number },
    ) => void,
  ) {}

  registerDeath(playerId: string, playerName: string, x: number, y: number): void {
    if (this.active.has(playerId)) return;
    new DeathMarker(this.scene, x, y);
    this.active.set(playerId, {
      playerId,
      playerName,
      x,
      y,
      chargeMs: 0,
    });
  }

  remove(playerId: string): void {
    const revive = this.active.get(playerId);
    revive?.marker?.destroy();
    this.active.delete(playerId);
  }

  update(delta: number): void {
    const increment = Math.min(Math.max(0, delta), 250);
    for (const revive of [...this.active.values()]) {
      const reviverId = this.findReviver(revive);
      if (!reviverId) {
        revive.chargeMs = 0;
        revive.chargingPlayerId = undefined;
        revive.marker?.destroy();
        revive.marker = undefined;
        continue;
      }
      if (revive.chargingPlayerId && revive.chargingPlayerId !== reviverId) {
        revive.chargeMs = 0;
      }
      revive.chargingPlayerId = reviverId;
      revive.marker ??= new ReviveMarker(
        this.scene,
        revive.x,
        revive.y,
        revive.playerName,
      );
      revive.chargeMs = Math.min(REVIVE_DURATION_MS, revive.chargeMs + increment);
      revive.marker?.setProgress(
        revive.chargeMs / REVIVE_DURATION_MS,
        true,
        revive.playerName,
      );
      if (revive.chargeMs < REVIVE_DURATION_MS) continue;

      this.active.delete(revive.playerId);
      revive.marker?.destroy();
      this.onRevived(revive.playerId, reviverId, { x: revive.x, y: revive.y });
    }
  }

  snapshot(): NetReviveState[] {
    return [...this.active.values()].map((revive) => ({
      playerId: revive.playerId,
      x: Math.round(revive.x * 10) / 10,
      y: Math.round(revive.y * 10) / 10,
      chargeRatio: Math.round((revive.chargeMs / REVIVE_DURATION_MS) * 1000) / 1000,
      chargingPlayerId: revive.chargingPlayerId,
    }));
  }

  destroy(): void {
    this.active.forEach((revive) => revive.marker?.destroy());
    this.active.clear();
  }

  private findReviver(revive: ActiveRevive): string | undefined {
    const currentId = revive.chargingPlayerId;
    if (currentId && this.isInRange(currentId, revive)) return currentId;

    let nearestId: string | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [playerId] of this.players) {
      if (playerId === revive.playerId || !this.isInRange(playerId, revive)) continue;
      const player = this.players.get(playerId)!;
      const distance = Phaser.Math.Distance.Squared(player.sprite.x, player.sprite.y, revive.x, revive.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = playerId;
      }
    }
    return nearestId;
  }

  private isInRange(playerId: string, revive: ActiveRevive): boolean {
    const player = this.players.get(playerId);
    if (!player || !this.canRevive(playerId) || player.stats.hp <= 0 || !player.sprite.active) return false;
    return Phaser.Math.Distance.Squared(player.sprite.x, player.sprite.y, revive.x, revive.y)
      <= REVIVE_RADIUS * REVIVE_RADIUS;
  }
}
