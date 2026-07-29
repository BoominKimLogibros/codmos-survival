import type { PlayerController } from './PlayerController';
import { MAX_WEAPON_LEVEL, MELEE_HIT_INTERVAL_MS, WORLD_SIZE } from '../config/constants';
import { updateAuraPresentation } from '../objects/AuraPresentation';
import { ExplosionPresentation, type ExplosionVisualData } from '../objects/ExplosionPresentation';
import {
  createPlayerViewportBounds,
  EXPLOSION_FUSE_DURATION_MS,
  fallbackExplosionPoint,
  insetViewportBounds,
  selectVisibleExplosionTargets,
  type ExplosionTargetBounds,
} from './ExplosionTargeting';
import type {
  AudioEffects,
  DamageSprite,
  EnemySprite,
  WeaponDefinition,
  WeaponDefinitions,
  WeaponKey,
  WeaponRuntimeStats,
  WeaponTooltipData,
} from './types';

interface WeaponSystemOptions {
  getEnemies: () => EnemySprite[];
  damageEnemy: (enemy: EnemySprite, damage: number) => void;
  effects: AudioEffects;
  onExplosion?: (effect: ExplosionVisualData) => void;
  ownerCenteredExplosionViewport?: boolean;
}

const ORBIT_ORB_DISPLAY_SIZE = 36;
const ORBIT_ROTATION_SPEED = 0.003;
const ORBIT_PER_RING = 9;
const ORBIT_BASE_RADIUS = 70;
const ORBIT_RING_GAP = 38;
const BOLT_BURST_INTERVAL_MS = 45;
export const BOLT_MAX_COUNT = 100;
export const ORBIT_MAX_COUNT = 36;

export function calculateWeaponRuntimeStats(
  definition: WeaponDefinition,
): WeaponRuntimeStats {
  const upgrades = Math.max(0, definition.level - 1);
  switch (definition.type) {
    case 'melee':
      return {
        damage: definition.damage + 5 + upgrades * 9,
        cooldownMs: Math.max(720, definition.cooldown - Math.min(upgrades, 5) * 100),
        range: 62 + Math.min(upgrades, 6) * 16,
      };
    case 'projectile': {
      const count = Math.min(BOLT_MAX_COUNT, definition.count! + upgrades);
      const damageGrowthLevels = Math.max(0, definition.level - BOLT_MAX_COUNT);
      return {
        damage: definition.damage + 3 + damageGrowthLevels * 7,
        cooldownMs: Math.max(520, definition.cooldown - Math.min(upgrades, 6) * 75),
        count,
        speed: definition.speed! + 30 + Math.min(upgrades, 5) * 45,
        pierce: 1,
      };
    }
    case 'aura':
      return {
        damage: definition.damage + 2 + upgrades * 5,
        cooldownMs: 100,
        radius: definition.radius! + 15 + Math.min(upgrades, 6) * 15,
      };
    case 'explosion':
      return {
        damage: definition.damage + 10 + upgrades * 18,
        cooldownMs: Math.max(1600, definition.cooldown - Math.min(upgrades, 5) * 180),
        count: 1,
        radius: definition.radius! + 10 + upgrades * 3,
      };
    case 'orbit': {
      const count = Math.min(ORBIT_MAX_COUNT, definition.count! + upgrades);
      const damageGrowthLevels = Math.max(0, definition.level - (ORBIT_MAX_COUNT - definition.count! + 1));
      return {
        damage: definition.damage + 3 + damageGrowthLevels * 7,
        count,
        radius: ORBIT_BASE_RADIUS + (Math.ceil(count / ORBIT_PER_RING) - 1) * ORBIT_RING_GAP,
        hitIntervalMs: MELEE_HIT_INTERVAL_MS,
      };
    }
  }
}

export function createWeaponDefinitions(): WeaponDefinitions {
  return {
    whip: {
      name: '채찍', desc: '레벨마다 피해가 계속 증가합니다', damage: 20, cooldown: 1200,
      level: 1, maxLevel: null, type: 'melee', icon: 'whipIcon',
    },
    bolt: {
      name: '번개', desc: '전기 화살을 연사하며 100발 이후 피해가 증가합니다', damage: 15, cooldown: 900,
      level: 1, maxLevel: null, type: 'projectile', icon: 'lightning', count: 1, speed: 400,
    },
    aura: {
      name: '성스러운 오라', desc: '0.1초마다 공격하며 피해가 계속 증가합니다', damage: 8, cooldown: 100,
      level: 1, maxLevel: null, type: 'aura', icon: 'aura', radius: 60,
    },
    explosion: {
      name: '폭탄', desc: '화면 안으로 날아가 착지 1초 후 범위 피해를 줍니다', damage: 40, cooldown: 2500,
      level: 1, maxLevel: null, type: 'explosion', icon: 'dynamite', radius: 50,
    },
    shield: {
      name: '회전 구체', desc: '최대 36개까지 늘어나고 이후 피해가 증가합니다', damage: 12, cooldown: 300,
      level: 1, maxLevel: null, type: 'orbit', icon: 'orbitOrb', count: 2,
    },
  };
}

function seconds(milliseconds: number): string {
  return `${milliseconds / 1000}초`;
}

/** Owns weapon definitions, cooldowns, projectiles, and attack visuals. */
export class WeaponSystem {
  readonly definitions: WeaponDefinitions = createWeaponDefinitions();

  readonly projectiles: Phaser.Physics.Arcade.Group;
  readonly meleeHits: Phaser.Physics.Arcade.Group;

  private readonly cooldowns: Record<WeaponKey, number> = {
    whip: 0,
    bolt: 0,
    aura: 0,
    explosion: 0,
    shield: 0,
  };
  private readonly orbitShields: DamageSprite[] = [];
  private boltBurstTimer?: Phaser.Time.TimerEvent;
  private explosionActive = false;
  private orbitRotation = 0;
  private readonly auraSprite: Phaser.GameObjects.Image;
  private ownerActive = true;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: PlayerController,
    private readonly options: WeaponSystemOptions,
  ) {
    this.projectiles = scene.physics.add.group({ maxSize: 300 });
    this.meleeHits = scene.physics.add.group();
    this.auraSprite = scene.add.image(0, 0, 'aura').setAlpha(0).setDepth(4).setVisible(false);
  }

  update(delta: number): void {
    if (!this.ownerActive) return;
    this.player.stats.weapons.forEach((key) => {
      const definition = this.definitions[key];
      const runtime = calculateWeaponRuntimeStats(definition);
      if (definition.type === 'orbit') return;
      if (key === 'bolt' && this.boltBurstTimer) return;
      const cooldownMs = runtime.cooldownMs!;
      if (key === 'explosion' && this.explosionActive) {
        this.cooldowns.explosion = Math.min(
          this.cooldowns.explosion + delta,
          cooldownMs,
        );
        return;
      }
      this.cooldowns[key] = Math.min(
        this.cooldowns[key] + delta,
        cooldownMs * 1.5,
      );
      if (this.cooldowns[key] >= cooldownMs) {
        this.cooldowns[key] -= cooldownMs;
        this.fire(definition);
      }
    });

    if (this.player.stats.weapons.includes('aura')) {
      const aura = this.definitions.aura;
      const runtime = calculateWeaponRuntimeStats(aura);
      updateAuraPresentation(
        this.auraSprite,
        this.player.sprite.x,
        this.player.sprite.y,
        runtime.radius! / 50,
        this.scene.time.now,
      );
    } else {
      this.auraSprite.setVisible(false);
    }
    this.updateOrbits(delta);
  }

  applySavedLevels(levels: Record<WeaponKey, number>): void {
    (Object.keys(this.definitions) as WeaponKey[]).forEach((key) => {
      const level = levels[key];
      this.definitions[key].level = Number.isFinite(level)
        ? Phaser.Math.Clamp(Math.floor(level), 1, MAX_WEAPON_LEVEL)
        : 1;
    });
    if (this.player.stats.weapons.includes('shield')) {
      this.ensureOrbits(this.definitions.shield);
    }
  }

  getLevels(): Record<WeaponKey, number> {
    return Object.fromEntries(
      (Object.keys(this.definitions) as WeaponKey[]).map((key) => [key, this.definitions[key].level]),
    ) as Record<WeaponKey, number>;
  }

  getAuraVisualState(): { x: number; y: number; scale: number } | null {
    if (!this.ownerActive || !this.player.stats.weapons.includes('aura')) return null;
    const runtime = calculateWeaponRuntimeStats(this.definitions.aura);
    return {
      x: this.player.sprite.x,
      y: this.player.sprite.y,
      scale: runtime.radius! / 50,
    };
  }

  setOwnerActive(active: boolean): void {
    this.ownerActive = active;
    if (!active) {
      this.auraSprite.setVisible(false);
      this.cancelBoltBurst();
    }
    this.orbitShields.forEach((shield) => {
      shield.setActive(active).setVisible(active);
      const body = shield.body as Phaser.Physics.Arcade.Body | null;
      if (body) body.enable = active;
    });
    if (active && this.player.stats.weapons.includes('shield')) {
      this.arrangeOrbitShields(this.definitions.shield);
    }
  }

  getTooltipData(key: WeaponKey): WeaponTooltipData {
    const definition = this.definitions[key];
    const runtime = calculateWeaponRuntimeStats(definition);
    const common = {
      name: definition.name,
      description: definition.desc,
      level: definition.level,
      maxLevel: definition.maxLevel,
    };

    switch (definition.type) {
      case 'melee':
        return {
          ...common,
          stats: [
            { label: '타격 피해', value: `${runtime.damage}` },
            { label: '공격 주기', value: seconds(runtime.cooldownMs!) },
            { label: '공격 거리', value: `${runtime.range}` },
          ],
        };
      case 'projectile':
        return {
          ...common,
          stats: [
            { label: '투사체 피해', value: `${runtime.damage}` },
            { label: '연사 수', value: `${runtime.count}발 / 최대 ${BOLT_MAX_COUNT}발` },
            { label: '연사 간격', value: seconds(BOLT_BURST_INTERVAL_MS) },
            { label: '연사 후 대기', value: seconds(runtime.cooldownMs!) },
            { label: '투사체 속도', value: `${runtime.speed}` },
          ],
        };
      case 'aura':
        return {
          ...common,
          stats: [
            { label: '지속 피해', value: `${runtime.damage}` },
            { label: '피해 주기', value: seconds(runtime.cooldownMs!) },
            { label: '효과 반경', value: `${runtime.radius}` },
          ],
        };
      case 'explosion':
        return {
          ...common,
          stats: [
            { label: '폭발 피해', value: `${runtime.damage}` },
            { label: '폭발 수', value: `${runtime.count}개` },
            { label: '공격 주기', value: seconds(runtime.cooldownMs!) },
            { label: '폭발 반경', value: `${runtime.radius}` },
          ],
        };
      case 'orbit':
        return {
          ...common,
          stats: [
            { label: '접촉 피해', value: `${runtime.damage}` },
            { label: '구체 수', value: `${runtime.count}개 / 최대 ${ORBIT_MAX_COUNT}개` },
            { label: '공전 반경', value: `${runtime.radius}` },
            { label: '피해 간격', value: seconds(runtime.hitIntervalMs!) },
          ],
        };
    }
  }

  refreshWeapon(key: WeaponKey): void {
    const definition = this.definitions[key];
    if (definition.type === 'orbit' && this.player.stats.weapons.includes(key)) {
      this.ensureOrbits(definition);
    }
  }

  private fire(definition: WeaponDefinition): void {
    switch (definition.type) {
      case 'melee': this.fireWhip(definition); break;
      case 'projectile': this.fireBolt(definition); break;
      case 'aura': this.fireAura(definition); break;
      case 'explosion': this.fireExplosion(definition); break;
      case 'orbit': this.ensureOrbits(definition); break;
    }
  }

  private fireWhip(definition: WeaponDefinition): void {
    const direction = this.player.isFacingRight ? 1 : -1;
    const runtime = calculateWeaponRuntimeStats(definition);
    const range = runtime.range!;
    const slashScale = 0.7 + Math.min(definition.level, 8) * 0.1;
    const hit = this.scene.physics.add.sprite(
      this.player.sprite.x + direction * range,
      this.player.sprite.y,
      'whipSlash',
    ) as DamageSprite;
    hit.setDepth(6).setAlpha(0.95).setScale(slashScale);
    if (direction < 0) hit.setFlipX(true);
    const body = hit.body as Phaser.Physics.Arcade.Body;
    body.setSize(160, 80);
    body.setOffset(0, 0);
    hit.damage = runtime.damage;
    this.meleeHits.add(hit);
    this.options.effects.spring.play();
    hit.setAngle(direction > 0 ? -15 : 15);
    this.scene.tweens.add({
      targets: hit,
      angle: direction > 0 ? 15 : -15,
      alpha: { from: 0.95, to: 0 },
      scaleX: slashScale * 1.3,
      scaleY: slashScale * 0.6,
      duration: 350,
      ease: 'Cubic.easeOut',
      onComplete: () => hit.destroy(),
    });
  }

  private fireBolt(definition: WeaponDefinition): void {
    if (this.boltBurstTimer || !this.ownerActive || this.options.getEnemies().length === 0) return;
    const runtime = calculateWeaponRuntimeStats(definition);
    let remaining = runtime.count!;
    const fireNext = (): void => {
      if (!this.ownerActive || this.player.stats.hp <= 0) {
        this.cancelBoltBurst();
        return;
      }
      const target = this.nearestEnemies(1)[0];
      if (target) this.fireSingleBolt(target, runtime, definition.level);
      remaining--;
      if (remaining <= 0) {
        this.boltBurstTimer = undefined;
        this.cooldowns.bolt = 0;
      }
    };
    this.options.effects.boing.play();
    fireNext();
    if (remaining <= 0) return;
    this.boltBurstTimer = this.scene.time.addEvent({
      delay: BOLT_BURST_INTERVAL_MS,
      repeat: remaining - 1,
      callback: fireNext,
    });
  }

  private fireSingleBolt(
    enemy: EnemySprite,
    runtime: WeaponRuntimeStats,
    weaponLevel: number,
  ): void {
    if (!enemy.active) return;
    const angle = Phaser.Math.Angle.Between(
      this.player.sprite.x,
      this.player.sprite.y,
      enemy.x,
      enemy.y,
    );
    const bolt = this.projectiles.create(
      this.player.sprite.x,
      this.player.sprite.y,
      'lightning',
    ) as DamageSprite | null;
    if (!bolt) return;
    bolt.setDepth(6);
    bolt.damage = runtime.damage;
    bolt.pierce = runtime.pierce;
    bolt.setScale(0.15 + Math.min(weaponLevel, 6) * 0.02);
    this.scene.physics.velocityFromRotation(
      angle,
      runtime.speed!,
      (bolt.body as Phaser.Physics.Arcade.Body).velocity,
    );
    bolt.setRotation(angle);
    this.scene.time.delayedCall(2000, () => {
      if (bolt.active) bolt.destroy();
    });
  }

  private cancelBoltBurst(): void {
    this.boltBurstTimer?.remove(false);
    this.boltBurstTimer = undefined;
    this.cooldowns.bolt = 0;
  }

  private fireAura(definition: WeaponDefinition): void {
    const runtime = calculateWeaponRuntimeStats(definition);
    const radiusSquared = runtime.radius! * runtime.radius!;
    this.options.getEnemies().forEach((enemy) => {
      if (Phaser.Math.Distance.Squared(
        this.player.sprite.x,
        this.player.sprite.y,
        enemy.x,
        enemy.y,
      ) <= radiusSquared) {
        this.options.damageEnemy(enemy, runtime.damage);
      }
    });
  }

  private fireExplosion(definition: WeaponDefinition): void {
    if (this.explosionActive) return;
    const enemies = this.options.getEnemies();
    const runtime = calculateWeaponRuntimeStats(definition);
    const count = runtime.count!;
    const radius = runtime.radius!;
    const startX = this.player.sprite.x;
    const startY = this.player.sprite.y;
    const bounds = this.explosionTargetBounds(radius);
    const visibleTargets = selectVisibleExplosionTargets(
      enemies,
      bounds,
      radius,
      count,
      { x: startX, y: startY },
    );
    const targetPoints = visibleTargets.map((target) => ({ x: target.x, y: target.y }));
    while (targetPoints.length < count) {
      targetPoints.push(fallbackExplosionPoint(
        bounds,
        { x: startX, y: startY },
        targetPoints.length,
        count,
        this.player.isFacingRight,
      ));
    }
    if (targetPoints.length > 0) this.options.effects.bomb.play();
    this.explosionActive = true;

    targetPoints.forEach(({ x: targetX, y: targetY }) => {
      const startX = this.player.sprite.x;
      const startY = this.player.sprite.y;
      const flightDurationMs = Phaser.Math.Clamp(
        320 + Phaser.Math.Distance.Between(startX, startY, targetX, targetY) * 0.45,
        380,
        720,
      );
      const effect: ExplosionVisualData = {
        startX,
        startY,
        x: targetX,
        y: targetY,
        radius,
        flightDurationMs,
        fuseDurationMs: EXPLOSION_FUSE_DURATION_MS,
      };
      ExplosionPresentation.play(this.scene, effect, () => {
        this.explosionActive = false;
        this.options.getEnemies().forEach((enemy) => {
          if (Phaser.Math.Distance.Between(targetX, targetY, enemy.x, enemy.y) <= radius) {
            this.options.damageEnemy(enemy, runtime.damage);
          }
        });
        this.options.effects.explosion.play();
      });
      this.options.onExplosion?.(effect);
    });
  }

  private explosionTargetBounds(radius: number): ExplosionTargetBounds {
    const camera = this.scene.cameras.main;
    const padding = radius + 28;
    if (this.options.ownerCenteredExplosionViewport) {
      return createPlayerViewportBounds(
        this.player.sprite.x,
        this.player.sprite.y,
        camera.width / Math.max(0.01, camera.zoom),
        camera.height / Math.max(0.01, camera.zoom),
        WORLD_SIZE,
        padding,
      );
    }
    const view = camera.worldView;
    return insetViewportBounds({
      left: view.x,
      right: view.right,
      top: view.y,
      bottom: view.bottom,
    }, padding);
  }

  private ensureOrbits(definition: WeaponDefinition): void {
    const runtime = calculateWeaponRuntimeStats(definition);
    while (this.orbitShields.length < runtime.count!) {
      const shield = this.scene.physics.add.sprite(
        this.player.sprite.x,
        this.player.sprite.y,
        'orbitOrb',
      ) as DamageSprite;
      shield.setDepth(6).setDisplaySize(ORBIT_ORB_DISPLAY_SIZE, ORBIT_ORB_DISPLAY_SIZE);
      (shield.body as Phaser.Physics.Arcade.Body).setCircle(27, 5, 5);
      shield.damage = runtime.damage;
      this.meleeHits.add(shield);
      this.orbitShields.push(shield);
    }
    // Existing orbit sprites survive level-ups, so refresh their damage as
    // well as adding/rearranging the newly unlocked sprites.
    this.orbitShields.forEach((shield) => {
      shield.damage = runtime.damage;
    });
    this.arrangeOrbitShields(definition);
  }

  private updateOrbits(delta: number): void {
    const definition = this.definitions.shield;
    this.orbitRotation = Phaser.Math.Angle.Wrap(
      this.orbitRotation + delta * ORBIT_ROTATION_SPEED,
    );
    this.arrangeOrbitShields(definition);
  }

  private arrangeOrbitShields(definition: WeaponDefinition): void {
    const runtime = calculateWeaponRuntimeStats(definition);
    const activeShields = this.orbitShields.filter((shield) => shield.active);
    const count = activeShields.length;
    activeShields.forEach((shield, index) => {
      const ring = Math.floor(index / ORBIT_PER_RING);
      const indexInRing = index % ORBIT_PER_RING;
      const ringStart = ring * ORBIT_PER_RING;
      const ringCount = Math.min(ORBIT_PER_RING, count - ringStart);
      const radius = ORBIT_BASE_RADIUS + ring * ORBIT_RING_GAP;
      const angle = this.orbitRotation * (1 + ring * 0.08) +
        (indexInRing / ringCount) * Math.PI * 2 +
        (ring % 2) * (Math.PI / Math.max(1, ringCount));
      shield.setPosition(
        this.player.sprite.x + Math.cos(angle) * radius,
        this.player.sprite.y + Math.sin(angle) * radius,
      );
      shield.setRotation(this.orbitRotation * 2 + angle);
      shield.damage = runtime.damage;
    });
  }

  private nearestEnemies(count: number): EnemySprite[] {
    const playerX = this.player.sprite.x;
    const playerY = this.player.sprite.y;
    const nearest: Array<{ enemy: EnemySprite; distance: number }> = [];
    this.options.getEnemies().forEach((enemy) => {
      const distance = Phaser.Math.Distance.Squared(playerX, playerY, enemy.x, enemy.y);
      if (nearest.length < count) {
        nearest.push({ enemy, distance });
        nearest.sort((left, right) => left.distance - right.distance);
        return;
      }
      if (distance >= nearest[nearest.length - 1].distance) return;
      nearest[nearest.length - 1] = { enemy, distance };
      nearest.sort((left, right) => left.distance - right.distance);
    });
    return nearest.map(({ enemy }) => enemy);
  }
}
