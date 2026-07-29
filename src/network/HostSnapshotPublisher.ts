import type { EnemySystem } from '../game/EnemySystem';
import type { PlayerController } from '../game/PlayerController';
import type { WeaponSystem } from '../game/WeaponSystem';
import type { DropSprite, EnemySprite, RunProgress } from '../game/types';
import type { RoomMember } from './types';
import type { HostRuneCoordinator } from './HostRuneCoordinator';
import type {
  NetAuraState,
  NetEnemyState,
  NetObjectState,
  NetPlayerState,
  NetReviveState,
  NetRuneState,
  WorldSnapshot,
} from './gameProtocol';

interface DeltaCache {
  enemyHashes: Map<string, string>;
  objectHashes: Map<string, string>;
  runeHashes: Map<string, string>;
  lastKeyframeAt: number;
}

export const HOST_SNAPSHOT_LIMITS = Object.freeze({
  worldEveryTicks: 2,
  interestRadius: 1_100,
  enemies: 200,
  objects: 120,
});

export class HostSnapshotPublisher {
  private readonly ids = new WeakMap<object, string>();
  private readonly caches = new Map<string, DeltaCache>();
  private nextId = 1;
  private tick = 0;

  constructor(
    private readonly players: Map<string, PlayerController>,
    private readonly members: () => RoomMember[],
    private readonly enemySystem: EnemySystem,
    private readonly weapons: Map<string, WeaponSystem>,
    private readonly runes: HostRuneCoordinator,
    private readonly progress: RunProgress,
    private readonly revives: () => NetReviveState[],
    private readonly shieldCharges: (playerId: string) => number,
    private readonly send: (targetPlayerId: string, snapshot: WorldSnapshot) => void,
  ) {}

  publish(): void {
    this.tick++;
    const now = Date.now();
    const includeWorld = this.tick % HOST_SNAPSHOT_LIMITS.worldEveryTicks === 1;
    for (const member of this.members()) {
      if (member.isHost || member.connection === 'left') continue;
      const target = this.players.get(member.playerId);
      if (!target) continue;
      const keyframe = includeWorld &&
        now - (this.cache(member.playerId).lastKeyframeAt || 0) >= 2_000;
      this.send(
        member.playerId,
        this.buildSnapshot(member.playerId, target, keyframe, includeWorld, now),
      );
    }
  }

  playerStates(): NetPlayerState[] {
    const members = this.members();
    return members.map((member) => {
      const player = this.players.get(member.playerId);
      const body = player?.sprite.body as Phaser.Physics.Arcade.Body | null;
      return {
        id: member.playerId,
        name: member.name,
        skin: member.skin,
        x: player?.sprite.x ?? 0,
        y: player?.sprite.y ?? 0,
        vx: body?.velocity.x ?? 0,
        vy: body?.velocity.y ?? 0,
        hp: player?.stats.hp ?? member.hp,
        maxHp: player?.stats.maxHp ?? member.maxHp,
        speed: player?.stats.speed ?? 200,
        level: player?.stats.level ?? member.level,
        xp: player?.stats.xp ?? 0,
        xpToNext: player?.stats.xpToNext ?? 10,
        alive: Boolean(player && player.stats.hp > 0 && player.sprite.active),
        connected: member.connection === 'connected',
        shield: this.shieldCharges(member.playerId),
        hitRevision: player?.hitRevision ?? 0,
      };
    });
  }

  private buildSnapshot(
    targetId: string,
    target: PlayerController,
    keyframe: boolean,
    includeWorld: boolean,
    now: number,
  ): WorldSnapshot {
    const inRange = (x: number, y: number) => Phaser.Math.Distance.Squared(x, y, target.sprite.x, target.sprite.y)
      <= HOST_SNAPSHOT_LIMITS.interestRadius * HOST_SNAPSHOT_LIMITS.interestRadius;
    const distanceToTarget = (x: number, y: number) => Phaser.Math.Distance.Squared(
      x,
      y,
      target.sprite.x,
      target.sprite.y,
    );
    const enemies = includeWorld
      ? this.enemySystem.getActiveEnemies()
        .filter((enemy) => inRange(enemy.x, enemy.y))
        .sort((left, right) => (
          distanceToTarget(left.x, left.y) - distanceToTarget(right.x, right.y)
        ))
        .slice(0, HOST_SNAPSHOT_LIMITS.enemies)
        .map((enemy) => this.enemyState(enemy))
      : [];
    const objects: NetObjectState[] = [];
    if (includeWorld) {
      for (const weapon of this.weapons.values()) {
        (weapon.projectiles.getChildren() as Phaser.Physics.Arcade.Sprite[])
          .filter((object) => object.active && inRange(object.x, object.y))
          .forEach((object) => objects.push(this.objectState(object, 'projectile')));
        (weapon.meleeHits.getChildren() as Phaser.Physics.Arcade.Sprite[])
          .filter((object) => object.active && inRange(object.x, object.y))
          .forEach((object) => objects.push(this.objectState(object, 'projectile')));
      }
      (this.enemySystem.xpGems.getChildren() as DropSprite[])
        .filter((object) => object.active && inRange(object.x, object.y))
        .forEach((object) => objects.push(this.objectState(object, 'xp')));
      (this.enemySystem.healthOrbs.getChildren() as DropSprite[])
        .filter((object) => object.active && inRange(object.x, object.y))
        .forEach((object) => objects.push(this.objectState(object, 'health')));
      objects.sort((left, right) => (
        distanceToTarget(left.x, left.y) - distanceToTarget(right.x, right.y)
      ));
      objects.length = Math.min(objects.length, HOST_SNAPSHOT_LIMITS.objects);
    }
    const runes = includeWorld
      ? this.runes.snapshot().filter((rune) => inRange(rune.x, rune.y))
      : [];
    const auras: NetAuraState[] = [];
    for (const [playerId, weapon] of this.weapons) {
      const aura = weapon.getAuraVisualState();
      if (aura) auras.push({ playerId, ...aura });
    }
    const cache = this.cache(targetId);
    const emptyDelta = { changed: [], removed: [] };
    const enemyDelta = includeWorld
      ? this.delta(cache.enemyHashes, enemies, keyframe)
      : emptyDelta;
    const objectDelta = includeWorld
      ? this.delta(cache.objectHashes, objects, keyframe)
      : emptyDelta;
    const runeDelta = includeWorld
      ? this.delta(cache.runeHashes, runes, keyframe)
      : emptyDelta;
    if (keyframe) cache.lastKeyframeAt = now;
    return {
      serverTime: now,
      tick: this.tick,
      keyframe,
      progress: {
        gameTime: this.progress.gameTime,
        killCount: this.progress.killCount,
        normalGeneration: this.progress.normalGeneration,
        bossGeneration: this.progress.bossGeneration,
      },
      players: this.playerStates(),
      enemies: enemyDelta.changed,
      objects: objectDelta.changed,
      runes: runeDelta.changed,
      auras,
      revives: this.revives(),
      removedEnemies: enemyDelta.removed,
      removedObjects: objectDelta.removed,
      removedRunes: runeDelta.removed,
    };
  }

  private enemyState(enemy: EnemySprite): NetEnemyState {
    const body = enemy.body as Phaser.Physics.Arcade.Body;
    return {
      id: this.id(enemy, 'e'),
      type: enemy.enemyType,
      frame: enemy.monsterFrames?.idle ?? 0,
      x: Math.round(enemy.x * 10) / 10,
      y: Math.round(enemy.y * 10) / 10,
      vx: Math.round(body.velocity.x),
      vy: Math.round(body.velocity.y),
      hp: Math.max(0, Math.ceil(enemy.hp)),
      maxHp: enemy.maxHp,
      scale: Math.abs(enemy.scaleX) || 0.3,
      bossTier: enemy.bossTier ?? 0,
      hitRevision: enemy.hitRevision ?? 0,
    };
  }

  private objectState(
    object: Phaser.Physics.Arcade.Sprite,
    kind: NetObjectState['kind'],
  ): NetObjectState {
    const body = object.body as Phaser.Physics.Arcade.Body | null;
    return {
      id: this.id(object, kind.charAt(0)),
      texture: object.texture.key,
      frame: object.frame.name,
      x: Math.round(object.x * 10) / 10,
      y: Math.round(object.y * 10) / 10,
      vx: Math.round(body?.velocity.x ?? 0),
      vy: Math.round(body?.velocity.y ?? 0),
      rotation: Math.round(object.rotation * 100) / 100,
      scale: Math.abs(object.scaleX),
      kind,
    };
  }

  private delta<T extends { id: string }>(
    previous: Map<string, string>,
    current: T[],
    keyframe: boolean,
  ): { changed: T[]; removed: string[] } {
    const next = new Map<string, string>();
    const changed: T[] = [];
    current.forEach((item) => {
      const hash = JSON.stringify(item);
      next.set(item.id, hash);
      if (keyframe || previous.get(item.id) !== hash) changed.push(item);
    });
    const removed = [...previous.keys()].filter((id) => !next.has(id));
    previous.clear();
    next.forEach((hash, id) => previous.set(id, hash));
    return { changed, removed };
  }

  private cache(playerId: string): DeltaCache {
    let cache = this.caches.get(playerId);
    if (!cache) {
      cache = { enemyHashes: new Map(), objectHashes: new Map(), runeHashes: new Map(), lastKeyframeAt: 0 };
      this.caches.set(playerId, cache);
    }
    return cache;
  }

  private id(object: object, prefix: string): string {
    let id = this.ids.get(object);
    if (!id) { id = `${prefix}${this.nextId++}`; this.ids.set(object, id); }
    return id;
  }
}
