import {
  ADAPTIVE_MAX_ENEMIES,
  BOSS_EVOLUTION_MULTIPLIER,
  BOSS_XP_REWARD_BASE,
  BOSS_XP_REWARD_MULTIPLIER,
  COMPRESSED_ATTACK_MULTIPLIER,
  COMPRESSED_EQUIVALENT_MONSTERS,
  COMPRESSED_SIZE_MULTIPLIER,
  COMPRESSED_SPAWN_CHANCE,
  COMPRESSED_SPAWN_INTERVAL_SECONDS,
  MELEE_HIT_INTERVAL_MS,
  MONSTER_FRAMES,
  SHIELD_KNOCKBACK_DURATION_MS,
  SHIELD_KNOCKBACK_SPEED,
  TILE_SIZE,
  WORLD_SIZE,
} from '../config/constants';
import { createEnemySprite } from '../objects/Enemy';
import { EnemyHealthBar } from '../objects/EnemyHealthBar';
import { BossPresentation } from '../objects/BossPresentation';
import { uiTextStyle } from '../ui/theme';
import type { AudioManager } from './AudioManager';
import type { PlayerController } from './PlayerController';
import type { WeaponSystem } from './WeaponSystem';
import { AdaptiveDifficultyController } from './AdaptiveDifficultyController';
import type {
  DamageSprite,
  DropSprite,
  EnemyDefinition,
  EnemySprite,
  EnemyType,
  MonsterFrames,
  RegularEnemyType,
  RunProgress,
} from './types';

interface EnemySystemOptions {
  showToast: (message: string, isError?: boolean) => void;
  onLevelUp: (player: PlayerController) => void;
  onPlayerDeath: (player: PlayerController) => void;
  isGameOver: () => boolean;
  tryBlockPlayerHit: (player: PlayerController, enemy: EnemySprite) => boolean;
  getPlayers?: () => PlayerController[];
  onSharedXp?: (value: number, collector: PlayerController) => void;
}

interface RuntimeTintSprite {
  setTint(color: number): RuntimeTintSprite;
  setTintFill?: (color: number) => RuntimeTintSprite;
  setTintMode?: (mode: number) => RuntimeTintSprite;
}

interface RuntimeTintModes {
  FILL?: number;
  MULTIPLY?: number;
}

function getRuntimeTintModes(): RuntimeTintModes | undefined {
  return (Phaser as unknown as { TintModes?: RuntimeTintModes }).TintModes;
}

function applyWhiteHitTint(enemy: EnemySprite): void {
  const target = enemy as unknown as RuntimeTintSprite;
  const fillMode = getRuntimeTintModes()?.FILL;
  if (fillMode !== undefined && typeof target.setTintMode === 'function') {
    target.setTint(0xffffff);
    target.setTintMode(fillMode);
  } else if (typeof target.setTintFill === 'function') {
    target.setTintFill(0xffffff);
  } else {
    target.setTint(0xffffff);
  }
}

function restoreEnemyTint(enemy: EnemySprite): void {
  if (!enemy.baseTint) {
    enemy.clearTint();
    return;
  }
  const target = enemy as unknown as RuntimeTintSprite;
  target.setTint(enemy.baseTint);
  const multiplyMode = getRuntimeTintModes()?.MULTIPLY;
  if (multiplyMode !== undefined && typeof target.setTintMode === 'function') {
    target.setTintMode(multiplyMode);
  }
}

const REGULAR_ENEMY_TYPES = new Set<EnemyType>(['basic', 'fast', 'tank']);
const MAX_ACTIVE_XP_DROPS = 800;
const MAX_ACTIVE_HEALTH_DROPS = 120;
const MAX_HIT_FEEDBACK_PER_SECOND = 60;
const MAX_DEATH_EFFECTS_PER_SECOND = 40;
const CAMERA_EFFECT_MARGIN = 120;

/** Owns enemy creation, progression, AI, combat resolution, and drops. */
export class EnemySystem {
  readonly enemies: Phaser.Physics.Arcade.Group;
  readonly xpGems: Phaser.Physics.Arcade.Group;
  readonly healthOrbs: Phaser.Physics.Arcade.Group;

  private readonly definitions: Record<RegularEnemyType | 'boss', EnemyDefinition> = {
    basic: { frames: MONSTER_FRAMES.cyber1, hp: 20, speed: 60, damage: 10, xp: 1, scale: 0.3 },
    fast: { frames: MONSTER_FRAMES.cyber2, hp: 10, speed: 120, damage: 8, xp: 2, scale: 0.25 },
    tank: { frames: MONSTER_FRAMES.sea1, hp: 60, speed: 40, damage: 15, xp: 3, scale: 0.4 },
    boss: { frames: MONSTER_FRAMES.space3, hp: 300, speed: 35, damage: 30, xp: 20, scale: 0.6 },
  };

  private readonly variants: Record<RegularEnemyType | 'boss', MonsterFrames[]> = {
    basic: [MONSTER_FRAMES.cyber1, MONSTER_FRAMES.cyber2, MONSTER_FRAMES.cyber3],
    fast: [MONSTER_FRAMES.sea2, MONSTER_FRAMES.sea3],
    tank: [MONSTER_FRAMES.sea1, MONSTER_FRAMES.space1, MONSTER_FRAMES.space2],
    boss: [MONSTER_FRAMES.space3],
  };

  private spawnTimer = 0;
  private readonly difficulty: AdaptiveDifficultyController;
  private hitFeedbackWindowAt = 0;
  private hitFeedbackCount = 0;
  private deathEffectWindowAt = 0;
  private deathEffectCount = 0;
  private readonly connectedPlayers = new WeakSet<PlayerController>();
  private readonly connectedWeapons = new WeakSet<WeaponSystem>();
  private environmentEnemiesConnected = false;
  private waterEnemiesConnected = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: PlayerController,
    private readonly audio: AudioManager,
    private readonly progress: RunProgress,
    private readonly options: EnemySystemOptions,
  ) {
    this.enemies = scene.physics.add.group();
    this.xpGems = scene.physics.add.group();
    this.healthOrbs = scene.physics.add.group();
    this.difficulty = new AdaptiveDifficultyController(
      progress.adaptiveDifficulty,
      progress.normalKillCount,
    );
  }

  connectCombat(
    weapons: WeaponSystem | WeaponSystem[],
    environmentColliders?: Phaser.Types.Physics.Arcade.ArcadeColliderType | null,
    waterLayer?: Phaser.Tilemaps.TilemapLayer | null,
  ): void {
    const players = this.players();
    const weaponSystems = Array.isArray(weapons) ? weapons : [weapons];
    const newPlayers = players.filter((player) => !this.connectedPlayers.has(player));
    const newWeaponSystems = weaponSystems.filter((weapon) => !this.connectedWeapons.has(weapon));
    newPlayers.forEach((player) => {
      this.scene.physics.add.overlap(
        player.sprite,
        this.enemies,
        (_player, enemy) => this.onEnemyHit(player, enemy as EnemySprite),
      );
      this.scene.physics.add.overlap(
        player.sprite,
        this.xpGems,
        (_player, gem) => this.onXpCollected(player, gem as DropSprite),
      );
      this.scene.physics.add.overlap(
        player.sprite,
        this.healthOrbs,
        (_player, orb) => this.onHealthCollected(player, orb as DropSprite),
      );
      this.connectedPlayers.add(player);
    });
    newWeaponSystems.forEach((weaponSystem) => {
      this.scene.physics.add.overlap(
        weaponSystem.projectiles,
        this.enemies,
        (projectile, enemy) => this.onProjectileHit(
          projectile as DamageSprite,
          enemy as EnemySprite,
        ),
      );
      this.scene.physics.add.overlap(
        weaponSystem.meleeHits,
        this.enemies,
        (hitbox, enemy) => this.onMeleeHit(hitbox as DamageSprite, enemy as EnemySprite),
      );
      this.connectedWeapons.add(weaponSystem);
    });

    if (environmentColliders) {
      newPlayers.forEach((player) => this.scene.physics.add.collider(player.sprite, environmentColliders));
      if (!this.environmentEnemiesConnected) {
        this.scene.physics.add.collider(this.enemies, environmentColliders);
        this.environmentEnemiesConnected = true;
      }
      newWeaponSystems.forEach((weaponSystem) => {
        this.scene.physics.add.collider(weaponSystem.projectiles, environmentColliders, (projectile) => {
          (projectile as Phaser.GameObjects.GameObject).destroy();
        });
      });
    }
    if (waterLayer) {
      newPlayers.forEach((player) => this.scene.physics.add.collider(player.sprite, waterLayer));
      if (!this.waterEnemiesConnected) {
        this.scene.physics.add.collider(this.enemies, waterLayer);
        this.waterEnemiesConnected = true;
      }
      newWeaponSystems.forEach((weaponSystem) => {
        this.scene.physics.add.collider(weaponSystem.projectiles, waterLayer, (projectile) => {
          (projectile as Phaser.GameObjects.GameObject).destroy();
        });
      });
    }
  }

  update(delta: number): void {
    this.updateSpawning(delta);
    this.updateAi();
    this.updateMagnet();
    this.cleanup();
  }

  getActiveEnemies(): EnemySprite[] {
    return (this.enemies.getChildren() as EnemySprite[]).filter((enemy) => enemy.active);
  }

  reduceDifficultyAfterDeath(): number {
    const hpScaleRatio = this.difficulty.reduceAfterDeath();
    if (hpScaleRatio < 1) this.rescaleEnemyHp(hpScaleRatio, false);
    return this.progress.adaptiveDifficulty.deathDifficultyMultiplier;
  }

  resumeFromSavedProgress(delayMs = 0): boolean {
    const completedBossCount = Math.max(0, this.progress.normalGeneration - 1);
    const pendingBossTier = this.progress.bossGeneration;
    if (
      pendingBossTier <= completedBossCount ||
      this.getActiveEnemies().some((enemy) => enemy.enemyType === 'boss')
    ) {
      return false;
    }
    if (delayMs > 0) {
      this.scene.time.delayedCall(delayMs, () => {
        const completed = Math.max(0, this.progress.normalGeneration - 1);
        if (
          pendingBossTier > completed &&
          !this.getActiveEnemies().some((enemy) => enemy.enemyType === 'boss')
        ) {
          this.spawnBoss(pendingBossTier, true);
        }
      });
      return true;
    }
    this.spawnBoss(pendingBossTier, true);
    return true;
  }

  damageEnemy(enemy: EnemySprite, damage: number): void {
    if (!enemy.active) return;
    enemy.hp -= damage;
    enemy.hitRevision = (enemy.hitRevision ?? 0) + 1;
    if (this.isWithinCamera(enemy.x, enemy.y) && this.consumeHitFeedbackBudget()) {
      enemy.presentation?.showDamageFeedback();
      applyWhiteHitTint(enemy);
      this.scene.time.delayedCall(80, () => {
        if (!enemy.active) return;
        restoreEnemyTint(enemy);
      });
      this.showFloatingText(enemy.x, enemy.y - 10, damage, '#d4d7de');
    }
    if (enemy.hp <= 0) this.killEnemy(enemy);
  }

  private updateSpawning(delta: number): void {
    const regularCount = this.activeRegularEnemyCount();
    const adjustment = this.difficulty.update(
      delta,
      regularCount,
      this.progress.normalKillCount,
    );
    if (adjustment) {
      if (adjustment.hpScaleRatio !== 1) this.rescaleRegularEnemyHp(adjustment.hpScaleRatio);
      if (adjustment.message) this.options.showToast(adjustment.message);
    }

    const totalCount = this.enemies.countActive();
    const interval = this.progress.adaptiveDifficulty.spawnIntervalMs;
    this.spawnTimer = Math.min(this.spawnTimer + delta, interval);
    if (
      this.spawnTimer >= interval &&
      this.difficulty.canSpawn(totalCount, regularCount)
    ) {
      this.spawnTimer = 0;
      const spawned = this.spawnWave(totalCount, regularCount);
      this.difficulty.recordRegularSpawn(spawned);
    }
    this.rollCompressedEnemySpawn();
    this.trySpawnBossForKills();
  }

  private rollCompressedEnemySpawn(): boolean {
    const currentMinute = Math.floor(
      this.progress.gameTime / COMPRESSED_SPAWN_INTERVAL_SECONDS,
    );
    if (currentMinute <= this.progress.lastCompressedRollMinute) return false;
    this.progress.lastCompressedRollMinute = currentMinute;
    if (Math.random() >= COMPRESSED_SPAWN_CHANCE) return false;
    if (this.enemies.countActive() >= ADAPTIVE_MAX_ENEMIES) return false;
    this.spawnCompressedEnemy();
    return true;
  }

  private advanceNormalGeneration(): void {
    this.progress.normalGeneration++;
    this.progress.normalSpawnedInGeneration = 0;
  }

  private trySpawnBossForKills(): boolean {
    const activeEnemies = this.getActiveEnemies();
    if (!this.difficulty.isBossDue(
      this.progress.normalKillCount,
      activeEnemies.some((enemy) => enemy.enemyType === 'boss'),
      activeEnemies.length,
    )) return false;
    this.difficulty.recordBossSpawn(this.progress.normalKillCount);
    this.progress.lastBossKillMilestone = Math.max(
      this.progress.lastBossKillMilestone,
      this.progress.bossGeneration + 1,
    );
    this.spawnBoss();
    return true;
  }

  private getWorldEdgeSpawnPosition(angle: number): { x: number; y: number } {
    const halfWorld = WORLD_SIZE / 2;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const distanceToWorldEdge = halfWorld / Math.max(
      Math.abs(directionX),
      Math.abs(directionY),
    );
    const outsideMargin = Phaser.Math.FloatBetween(TILE_SIZE * 0.75, TILE_SIZE * 1.75);
    const distance = distanceToWorldEdge + outsideMargin;
    return { x: directionX * distance, y: directionY * distance };
  }

  private spawnWave(totalCount: number, regularCount: number): number {
    let enemyType: RegularEnemyType = 'basic';
    const roll = Math.random();
    if (roll < 0.15) enemyType = 'tank';
    else if (roll < 0.35) enemyType = 'fast';

    const definition = this.definitions[enemyType];
    const effectiveHpMultiplier = this.difficulty.effectiveHpMultiplier();
    const batchSize = this.difficulty.nextBatchSize(totalCount, regularCount);
    if (batchSize <= 0) return 0;
    const sectorAngle = (Math.PI * 2) / batchSize;
    const waveRotation = Phaser.Math.FloatBetween(0, Math.PI * 2);

    for (let index = 0; index < batchSize; index++) {
      const spawnAngle = waveRotation + sectorAngle * index + Phaser.Math.FloatBetween(
        -sectorAngle * 0.18,
        sectorAngle * 0.18,
      );
      const position = this.getWorldEdgeSpawnPosition(spawnAngle);
      const frames = Phaser.Utils.Array.GetRandom(this.variants[enemyType]);
      const enemy = createEnemySprite(this.scene, this.enemies, {
        ...position,
        frames,
        scale: definition.scale,
        enemyType,
        collideWorldBounds: false,
      });
      enemy.normalGeneration = this.progress.normalGeneration;
      enemy.maxHp = Math.max(1, Math.floor(definition.hp * effectiveHpMultiplier));
      enemy.hp = enemy.maxHp;
      const baseSpeed = definition.speed + Phaser.Math.Between(-10, 10);
      enemy.speed = baseSpeed;
      enemy.damage = definition.damage;
      enemy.xpValue = Math.max(1, Math.floor(
        definition.xp * Math.sqrt(effectiveHpMultiplier),
      ));
      enemy.lastDmgT = 0;
      this.createHealthBar(enemy);
      this.progress.normalSpawnedInGeneration++;
    }
    return batchSize;
  }

  private spawnBoss(
    tier = this.progress.bossGeneration + 1,
    isResumedBoss = false,
  ): void {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const halfWorld = WORLD_SIZE / 2 - TILE_SIZE;
    const targetPlayer = this.livingPlayers()[0] ?? this.player;
    const x = Phaser.Math.Clamp(
      targetPlayer.sprite.x + Math.cos(angle) * 500,
      -halfWorld,
      halfWorld,
    );
    const y = Phaser.Math.Clamp(
      targetPlayer.sprite.y + Math.sin(angle) * 500,
      -halfWorld,
      halfWorld,
    );
    const definition = this.definitions.boss;
    const power = Math.pow(BOSS_EVOLUTION_MULTIPLIER, tier - 1);
    const boss = createEnemySprite(this.scene, this.enemies, {
      x,
      y,
      frames: definition.frames,
      scale: definition.scale,
      enemyType: 'boss',
      bodyRadius: 50,
    });
    boss.bossTier = tier;
    boss.maxHp = Math.max(1, Math.floor(
      definition.hp * power * this.progress.adaptiveDifficulty.deathDifficultyMultiplier,
    ));
    boss.hp = boss.maxHp;
    boss.speed = definition.speed;
    // Boss tiers increase durability only. Keeping contact damage fixed prevents
    // a resumed high-tier boss from defeating the player in a single hit.
    boss.damage = definition.damage;
    boss.xpValue = Math.max(
      BOSS_XP_REWARD_BASE,
      Math.floor(BOSS_XP_REWARD_BASE * Math.pow(BOSS_XP_REWARD_MULTIPLIER, tier - 1)),
    );
    boss.lastDmgT = 0;
    boss.normalGeneration = this.progress.normalGeneration;
    boss.presentation = BossPresentation.create(this.scene, x, y, tier);
    if (boss.presentation instanceof BossPresentation) {
      boss.setAlpha(0).setDisplaySize(
        boss.presentation.visualHeight,
        boss.presentation.visualHeight,
      );
    }
    this.progress.bossGeneration = Math.max(this.progress.bossGeneration, tier);
    this.createHealthBar(boss);

    const announcement = this.scene.add.text(
      this.scene.scale.gameSize.width / 2,
      80,
      isResumedBoss ? `보스 ${tier}단계 이어서 등장!` : `보스 ${tier}단계 등장!`,
      {
        ...uiTextStyle({ fontSize: '24px', color: '#ffffff', fontStyle: '800' }),
        stroke: '#6c5ce7',
        strokeThickness: 3,
      },
    ).setOrigin(0.5).setScrollFactor(0).setDepth(200);
    this.scene.tweens.add({
      targets: announcement,
      alpha: 0,
      y: 60,
      duration: 2000,
      onComplete: () => announcement.destroy(),
    });
    this.audio.effects.scream.play();
  }

  private spawnCompressedEnemy(): EnemySprite {
    const base = this.definitions.basic;
    const hpMultiplier = this.difficulty.effectiveHpMultiplier();
    const baseHp = Math.max(1, Math.floor(base.hp * hpMultiplier));
    const baseDamage = base.damage;
    const baseXp = Math.max(1, Math.floor(
      base.xp * Math.sqrt(hpMultiplier),
    ));
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const distance = Phaser.Math.Between(300, 450);
    const halfWorld = WORLD_SIZE / 2 - TILE_SIZE;
    const targetPlayer = this.livingPlayers()[0] ?? this.player;
    const x = Phaser.Math.Clamp(
      targetPlayer.sprite.x + Math.cos(angle) * distance,
      -halfWorld,
      halfWorld,
    );
    const y = Phaser.Math.Clamp(
      targetPlayer.sprite.y + Math.sin(angle) * distance,
      -halfWorld,
      halfWorld,
    );
    const enemy = createEnemySprite(this.scene, this.enemies, {
      x,
      y,
      frames: Phaser.Utils.Array.GetRandom(this.variants.basic),
      scale: base.scale * COMPRESSED_SIZE_MULTIPLIER,
      enemyType: 'compressed',
    });
    enemy.setTint(0xff8a65);
    enemy.baseTint = 0xff8a65;
    enemy.normalGeneration = this.progress.normalGeneration;
    enemy.maxHp = baseHp * COMPRESSED_EQUIVALENT_MONSTERS;
    enemy.hp = enemy.maxHp;
    enemy.speed = Math.max(35, base.speed * 0.7);
    enemy.damage = baseDamage * COMPRESSED_ATTACK_MULTIPLIER;
    enemy.xpValue = baseXp * COMPRESSED_EQUIVALENT_MONSTERS;
    enemy.lastDmgT = 0;
    this.createHealthBar(enemy);
    this.options.showToast('희귀 5배 거대 몬스터 등장!');
    return enemy;
  }

  private updateAi(): void {
    const players = this.livingPlayers();
    if (!players.length) return;
    this.getActiveEnemies().forEach((enemy) => {
      const target = players.reduce((nearest, candidate) => (
        Phaser.Math.Distance.Squared(enemy.x, enemy.y, candidate.sprite.x, candidate.sprite.y)
          < Phaser.Math.Distance.Squared(enemy.x, enemy.y, nearest.sprite.x, nearest.sprite.y)
          ? candidate : nearest
      ), players[0]);
      if ((enemy.knockbackUntil ?? 0) <= this.scene.time.now) {
        const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.sprite.x, target.sprite.y);
        enemy.setVelocity(Math.cos(angle) * enemy.speed, Math.sin(angle) * enemy.speed);
      }
      const movingLeft = (enemy.body as Phaser.Physics.Arcade.Body).velocity.x < 0;
      enemy.setFlipX(movingLeft);
      enemy.presentation?.sync(enemy.x, enemy.y, movingLeft);
      this.syncHealthBar(enemy);
    });
  }

  private updateMagnet(): void {
    const players = this.livingPlayers();
    (this.xpGems.getChildren() as DropSprite[]).forEach((gem) => {
      if (!gem.active || !players.length) return;
      const target = players.reduce<PlayerController | null>((nearest, player) => {
        const distance = Phaser.Math.Distance.Between(player.sprite.x, player.sprite.y, gem.x, gem.y);
        if (distance >= player.stats.magnet) return nearest;
        if (!nearest) return player;
        const previous = Phaser.Math.Distance.Between(nearest.sprite.x, nearest.sprite.y, gem.x, gem.y);
        return distance < previous ? player : nearest;
      }, null);
      if (!target) return;
      const angle = Phaser.Math.Angle.Between(gem.x, gem.y, target.sprite.x, target.sprite.y);
      gem.setVelocity(Math.cos(angle) * 300, Math.sin(angle) * 300);
    });
  }

  private onEnemyHit(player: PlayerController, enemy: EnemySprite): void {
    if (this.options.isGameOver()) return;
    if (!player.tryBeginHitWindow()) return;
    const now = this.scene.time.now;
    if (this.options.tryBlockPlayerHit(player, enemy)) {
      const knockbackAngle = Phaser.Math.Angle.Between(
        player.sprite.x,
        player.sprite.y,
        enemy.x,
        enemy.y,
      );
      enemy.knockbackUntil = now + SHIELD_KNOCKBACK_DURATION_MS;
      enemy.setVelocity(
        Math.cos(knockbackAngle) * SHIELD_KNOCKBACK_SPEED,
        Math.sin(knockbackAngle) * SHIELD_KNOCKBACK_SPEED,
      );
      return;
    }
    const damage = Math.max(1, enemy.damage - player.stats.armor);
    player.stats.hp = Math.max(0, player.stats.hp - damage);
    player.showDamageFeedback();
    const angle = Phaser.Math.Angle.Between(
      enemy.x,
      enemy.y,
      player.sprite.x,
      player.sprite.y,
    );
    player.sprite.setVelocity(Math.cos(angle) * 250, Math.sin(angle) * 250);
    this.showFloatingText(player.sprite.x, player.sprite.y - 20, damage, '#ffffff');
    this.audio.effects.thump.play();
    if (player.stats.hp <= 0) this.options.onPlayerDeath(player);
  }

  private onProjectileHit(projectile: DamageSprite, enemy: EnemySprite): void {
    if (!projectile.active || !enemy.active) return;
    this.damageEnemy(enemy, projectile.damage);
    projectile.pierce = (projectile.pierce ?? 1) - 1;
    if (projectile.pierce <= 0) projectile.destroy();
  }

  private onMeleeHit(hitbox: DamageSprite, enemy: EnemySprite): void {
    if (!hitbox.active || !enemy.active) return;
    const now = this.scene.time.now;
    if (enemy.lastDmgT && now - enemy.lastDmgT < MELEE_HIT_INTERVAL_MS) return;
    enemy.lastDmgT = now;
    this.damageEnemy(enemy, hitbox.damage);
  }

  private onXpCollected(player: PlayerController, gem: DropSprite): void {
    if (!gem.active) return;
    const value = gem.xpValue ?? 1;
    gem.destroy();
    this.audio.effects.coin.play();
    if (this.options.onSharedXp) {
      this.options.onSharedXp(value, player);
      return;
    }
    player.stats.xp += value;
    if (player.stats.xp >= player.stats.xpToNext) this.options.onLevelUp(player);
  }

  private onHealthCollected(player: PlayerController, orb: DropSprite): void {
    if (!orb.active) return;
    orb.destroy();
    player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + 20);
    this.showFloatingText(player.sprite.x, player.sprite.y - 20, '+20', '#6c5ce7');
  }

  private killEnemy(enemy: EnemySprite): void {
    this.progress.killCount++;
    const xpValue = enemy.xpValue || 1;
    const isBoss = enemy.enemyType === 'boss';
    if (REGULAR_ENEMY_TYPES.has(enemy.enemyType)) {
      this.progress.normalKillCount++;
      this.trySpawnBossForKills();
    } else if (isBoss) {
      this.advanceNormalGeneration();
      this.options.showToast(`보스 처치! 경험치 ${xpValue} + 체력 회복 보상`);
    }

    const showDeathEffect = this.isWithinCamera(enemy.x, enemy.y) && this.consumeDeathEffectBudget();
    if (showDeathEffect && enemy.monsterFrames && !enemy.presentation) {
      const deathSprite = this.scene.add.image(
        enemy.x,
        enemy.y,
        'monsterSheet',
        enemy.monsterFrames.destroyed,
      ).setScale(enemy.scaleX).setDepth(4).setAlpha(0.8);
      this.scene.tweens.add({
        targets: deathSprite,
        alpha: 0,
        scaleX: deathSprite.scaleX * 1.3,
        scaleY: deathSprite.scaleY * 1.3,
        angle: Phaser.Math.Between(-30, 30),
        duration: 350,
        onComplete: () => deathSprite.destroy(),
      });
    }

    // Field drops intentionally use exactly two visual/item types: XP and HP.
    // The former bonus-star roll is folded into this one XP gem so a kill never
    // produces a third-looking pickup.
    const totalXpValue = xpValue + (Math.random() < 0.05 ? 5 : 0);
    const gemSize = isBoss
      ? 44
      : Phaser.Math.Clamp(20 + Math.log2(totalXpValue + 1) * 2, 22, 34);
    this.createXpDrop(enemy.x, enemy.y, totalXpValue, gemSize);

    if (
      (isBoss || Math.random() < 0.08) &&
      this.healthOrbs.countActive() < MAX_ACTIVE_HEALTH_DROPS
    ) {
      this.healthOrbs.create(enemy.x + Phaser.Math.Between(-10, 10), enemy.y, 'healthOrb')
        .setDepth(2)
        .setDisplaySize(30, 30);
    }

    enemy.healthBar?.destroy();
    enemy.healthBar = null;
    enemy.presentation?.destroy(true);
    enemy.presentation = null;
    if (showDeathEffect) {
      const flash = this.scene.add.circle(enemy.x, enemy.y, 15, 0xffffff, 0.5).setDepth(4);
      this.scene.tweens.add({
        targets: flash,
        alpha: 0,
        scaleX: 2.5,
        scaleY: 2.5,
        duration: 250,
        onComplete: () => flash.destroy(),
      });
    }
    enemy.destroy();
  }

  private createHealthBar(enemy: EnemySprite): void {
    if (!this.isWithinCamera(enemy.x, enemy.y)) {
      enemy.healthBar = null;
      return;
    }
    enemy.healthBar = new EnemyHealthBar(this.scene, enemy);
  }

  private syncHealthBar(enemy: EnemySprite): void {
    if (this.isWithinCamera(enemy.x, enemy.y)) {
      if (!enemy.healthBar) this.createHealthBar(enemy);
      enemy.healthBar?.update();
      return;
    }
    enemy.healthBar?.destroy();
    enemy.healthBar = null;
  }

  private showFloatingText(x: number, y: number, value: string | number, color: string): void {
    const text = this.scene.add.text(x, y, String(value), {
      ...uiTextStyle({ fontSize: '14px', color, fontStyle: '800' }),
      stroke: '#0b0d12',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(50);
    this.scene.tweens.add({
      targets: text,
      y: y - 30,
      alpha: 0,
      duration: 600,
      ease: 'Power2',
      onComplete: () => text.destroy(),
    });
  }

  private cleanup(): void {
    const players = this.livingPlayers();
    (this.xpGems.getChildren() as DropSprite[]).forEach((gem) => {
      if (
        gem.active &&
        players.length > 0 &&
        players.every((player) => (
          Math.abs(gem.x - player.sprite.x) > 1000 ||
          Math.abs(gem.y - player.sprite.y) > 1000
        ))
      ) {
        gem.destroy();
      }
    });
    (this.healthOrbs.getChildren() as DropSprite[]).forEach((orb) => {
      if (
        orb.active &&
        players.length > 0 &&
        players.every((player) => (
          Math.abs(orb.x - player.sprite.x) > 1000 ||
          Math.abs(orb.y - player.sprite.y) > 1000
        ))
      ) {
        orb.destroy();
      }
    });
  }

  private createXpDrop(x: number, y: number, value: number, size: number): void {
    if (this.xpGems.countActive() >= MAX_ACTIVE_XP_DROPS) {
      const existing = (this.xpGems.getChildren() as DropSprite[]).find((gem) => gem.active);
      if (existing) {
        existing.xpValue = (existing.xpValue ?? 1) + value;
        const mergedSize = Phaser.Math.Clamp(
          20 + Math.log2((existing.xpValue ?? 1) + 1) * 2,
          22,
          44,
        );
        existing.setDisplaySize(mergedSize, mergedSize);
        return;
      }
    }
    const gem = this.xpGems.create(x, y, 'xpGem') as DropSprite;
    gem.setDepth(2).setDisplaySize(size, size);
    gem.xpValue = value;
  }

  private isWithinCamera(x: number, y: number): boolean {
    const view = this.scene.cameras.main.worldView;
    return x >= view.x - CAMERA_EFFECT_MARGIN &&
      x <= view.right + CAMERA_EFFECT_MARGIN &&
      y >= view.y - CAMERA_EFFECT_MARGIN &&
      y <= view.bottom + CAMERA_EFFECT_MARGIN;
  }

  private consumeHitFeedbackBudget(): boolean {
    const now = this.scene.time.now;
    if (now - this.hitFeedbackWindowAt >= 1000) {
      this.hitFeedbackWindowAt = now;
      this.hitFeedbackCount = 0;
    }
    if (this.hitFeedbackCount >= MAX_HIT_FEEDBACK_PER_SECOND) return false;
    this.hitFeedbackCount++;
    return true;
  }

  private consumeDeathEffectBudget(): boolean {
    const now = this.scene.time.now;
    if (now - this.deathEffectWindowAt >= 1000) {
      this.deathEffectWindowAt = now;
      this.deathEffectCount = 0;
    }
    if (this.deathEffectCount >= MAX_DEATH_EFFECTS_PER_SECOND) return false;
    this.deathEffectCount++;
    return true;
  }

  private activeRegularEnemyCount(): number {
    return this.getActiveEnemies().filter((enemy) => REGULAR_ENEMY_TYPES.has(enemy.enemyType)).length;
  }

  private rescaleRegularEnemyHp(scaleRatio: number): void {
    this.rescaleEnemyHp(scaleRatio, true);
  }

  private rescaleEnemyHp(scaleRatio: number, regularOnly: boolean): void {
    this.getActiveEnemies().forEach((enemy) => {
      if (regularOnly && !REGULAR_ENEMY_TYPES.has(enemy.enemyType)) return;
      const hpRatio = Phaser.Math.Clamp(enemy.hp / Math.max(1, enemy.maxHp), 0, 1);
      enemy.maxHp = Math.max(1, Math.floor(enemy.maxHp * scaleRatio));
      enemy.hp = Math.max(1, Math.ceil(enemy.maxHp * hpRatio));
      enemy.healthBar?.destroy();
      this.createHealthBar(enemy);
    });
  }

  private players(): PlayerController[] {
    return this.options.getPlayers?.() ?? [this.player];
  }

  private livingPlayers(): PlayerController[] {
    return this.players().filter((player) => player.stats.hp > 0 && player.sprite.active);
  }
}
