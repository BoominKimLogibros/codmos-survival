import {
  ADAPTIVE_MAX_ENEMIES,
  ARENA_PLAYABLE_HALF_SIZE,
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
} from '../config/constants';
import { createEnemySprite } from '../objects/Enemy';
import { EnemyHealthBar } from '../objects/EnemyHealthBar';
import { BossPresentation } from '../objects/BossPresentation';
import { MonsterPortalPresentation } from '../objects/MonsterPortalPresentation';
import { uiTextStyle } from '../ui/theme';
import type { AudioManager } from './AudioManager';
import type { PlayerController } from './PlayerController';
import type { WeaponSystem } from './WeaponSystem';
import {
  BOSS_XP_REWARD_DISPLAY_HEIGHT,
  BOSS_XP_REWARD_DISPLAY_WIDTH,
  BOSS_XP_REWARD_PICKUP_SIZE,
  BOSS_XP_REWARD_TEXTURE_KEY,
  regularXpDropSize,
  type XpDropKind,
} from './xpDrop';
import {
  AdaptiveDifficultyController,
  scaleHealthPreservingRatio,
  strongestDifficultyGrowthProfile,
  type DifficultyGrowthProfile,
} from './AdaptiveDifficultyController';
import {
  consumeDamageContact,
  consumeDamageSourceCooldown,
  pruneDamageContacts,
} from './damageCooldown';
import { shouldApplyKnockback } from './knockback';
import {
  MONSTER_PORTAL_DURATION_MS,
  isMonsterEnteringPortal,
} from './enemySpawn';
import {
  BOSS_CONTACT_DAMAGE_MULTIPLIER,
  BOSS_CONTACT_INTERVAL_MS,
  BOSS_ENTRY_DURATION_MS,
  bossEntryRemainingMs,
  bossContactDamage,
  bossProfileForTier,
  clampBossAttackTarget,
  isBossEntering,
  isPointInBossAttack,
  type BossAttackVisualState,
  type BossBehaviorProfile,
} from './bossBehavior';
import type {
  DamageSprite,
  DropSprite,
  EnemyDefinition,
  EnemyKnockback,
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
  getDifficultyGrowthProfiles?: () => DifficultyGrowthProfile[];
  onSharedXp?: (value: number, collector: PlayerController) => void;
  onBossKilled?: (enemy: EnemySprite) => void;
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
const HEALTH_DROP_WIDTH = 27;
const HEALTH_DROP_HEIGHT = 30;
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
  private readonly meleeHitTimes = new WeakMap<EnemySprite, Map<string, number>>();
  private readonly meleeContactFrames = new WeakMap<EnemySprite, Map<string, number>>();
  private readonly bossContactTimes = new WeakMap<EnemySprite, WeakMap<PlayerController, number>>();
  private meleeContactFrame = 0;
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
    this.meleeContactFrame++;
    this.pruneMeleeContacts();
    this.updateSpawning(delta);
    this.updateAi();
    this.updateMagnet();
    this.cleanup();
  }

  getActiveEnemies(): EnemySprite[] {
    return (this.enemies.getChildren() as EnemySprite[]).filter((enemy) => enemy.active);
  }

  getBossAttackVisualState(enemy: EnemySprite): BossAttackVisualState | null {
    if (enemy.enemyType !== 'boss') return null;
    if (isBossEntering(enemy.bossSpawnEndsAt, this.scene.time.now)) return null;
    const phase = enemy.bossAttackPhase ?? 'chase';
    const startedAt = enemy.bossAttackStartedAt ?? this.scene.time.now;
    const endsAt = enemy.bossAttackEndsAt ?? startedAt;
    const duration = Math.max(1, endsAt - startedAt);
    const progress = phase === 'windup' || phase === 'attack'
      ? Phaser.Math.Clamp((this.scene.time.now - startedAt) / duration, 0, 1)
      : 0;
    return {
      phase,
      revision: enemy.bossAttackRevision ?? 0,
      progress,
      originX: enemy.bossAttackOriginX ?? enemy.x,
      originY: enemy.bossAttackOriginY ?? enemy.y,
      targetX: enemy.bossAttackTargetX ?? enemy.x,
      targetY: enemy.bossAttackTargetY ?? enemy.y,
      radius: enemy.bossAttackRadius ?? 0,
      style: enemy.bossAttackStyle ?? bossProfileForTier(enemy.bossTier ?? 1).attackStyle,
    };
  }

  getBossEntryRemainingMs(enemy: EnemySprite): number {
    if (enemy.enemyType !== 'boss') return 0;
    return bossEntryRemainingMs(enemy.bossSpawnEndsAt, this.scene.time.now);
  }

  getMonsterPortalNetworkEndsAt(enemy: EnemySprite): number {
    if (enemy.enemyType === 'boss') return 0;
    if (!isMonsterEnteringPortal(enemy.portalSpawnEndsAt, this.scene.time.now)) return 0;
    return enemy.portalSpawnNetworkEndsAt ?? 0;
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
          this.spawnBossWave(pendingBossTier, true);
        }
      });
      return true;
    }
    this.spawnBossWave(pendingBossTier, true);
    return true;
  }

  damageEnemy(enemy: EnemySprite, damage: number, knockback?: EnemyKnockback): void {
    if (!enemy.active) return;
    if (enemy.enemyType === 'boss' && isBossEntering(
      enemy.bossSpawnEndsAt,
      this.scene.time.now,
    )) return;
    if (enemy.enemyType !== 'boss' && isMonsterEnteringPortal(
      enemy.portalSpawnEndsAt,
      this.scene.time.now,
    )) return;
    if (knockback) this.applyEnemyKnockback(enemy, knockback);
    enemy.hp -= damage;
    enemy.hitRevision = (enemy.hitRevision ?? 0) + 1;
    if (enemy.enemyType === 'boss') enemy.presentation?.showDamageFeedback();
    if (this.isWithinCamera(enemy.x, enemy.y) && this.consumeHitFeedbackBudget()) {
      if (enemy.enemyType !== 'boss') enemy.presentation?.showDamageFeedback();
      if (!enemy.presentation) {
        applyWhiteHitTint(enemy);
        this.scene.time.delayedCall(80, () => {
          if (!enemy.active) return;
          restoreEnemyTint(enemy);
        });
      }
      this.showFloatingText(enemy.x, enemy.y - 10, damage, '#d4d7de');
    }
    if (enemy.hp <= 0) this.killEnemy(enemy);
  }

  private updateSpawning(delta: number): void {
    const growth = strongestDifficultyGrowthProfile(
      this.options.getDifficultyGrowthProfiles?.() ?? [{
        level: this.player.stats.level,
        enhancementLevel: 0,
      }],
    );
    const growthAdjustment = this.difficulty.syncPlayerGrowth(growth);
    if (growthAdjustment) {
      if (growthAdjustment.hpScaleRatio !== 1) {
        this.rescaleNonBossEnemyHp(growthAdjustment.hpScaleRatio);
      }
      this.options.showToast(growthAdjustment.message);
    }
    const regularCount = this.activeRegularEnemyCount();
    const adjustment = this.difficulty.update(
      delta,
      regularCount,
      this.progress.normalKillCount,
    );
    if (adjustment) {
      if (adjustment.hpScaleRatio !== 1) this.rescaleNonBossEnemyHp(adjustment.hpScaleRatio);
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
    this.spawnBossWave();
    return true;
  }

  private getWorldEdgeSpawnPosition(angle: number): { x: number; y: number } {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const spawnBoundary = ARENA_PLAYABLE_HALF_SIZE - TILE_SIZE * 0.75;
    const distanceToWorldEdge = spawnBoundary / Math.max(
      Math.abs(directionX),
      Math.abs(directionY),
    );
    const distance = distanceToWorldEdge - Phaser.Math.FloatBetween(0, TILE_SIZE * 0.5);
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
        collideWorldBounds: true,
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
      this.beginMonsterPortalEntry(enemy);
      this.createHealthBar(enemy);
      this.progress.normalSpawnedInGeneration++;
    }
    return batchSize;
  }

  private spawnBossWave(
    tier = this.progress.bossGeneration + 1,
    isResumedBoss = false,
  ): void {
    const availableSlots = Math.max(1, ADAPTIVE_MAX_ENEMIES - this.enemies.countActive());
    const bossCount = Math.min(this.difficulty.effectiveBossCount(), availableSlots);
    const initialAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    for (let index = 0; index < bossCount; index++) {
      this.spawnBoss(tier, initialAngle + (Math.PI * 2 * index) / bossCount);
    }

    const behavior = bossProfileForTier(tier);
    const countLabel = bossCount > 1 ? ` · 동시 ${bossCount}마리` : '';
    const announcement = this.scene.add.text(
      this.scene.scale.gameSize.width / 2,
      80,
      `${isResumedBoss ? `보스 ${tier}단계 이어서 등장` : `보스 ${tier}단계 등장`}${countLabel}\n` +
      `${behavior.name} · ${behavior.trait}`,
      {
        ...uiTextStyle({ fontSize: '24px', color: '#ffffff', fontStyle: '800' }),
        align: 'center',
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

  private spawnBoss(tier: number, angle: number): void {
    const halfWorld = ARENA_PLAYABLE_HALF_SIZE - TILE_SIZE;
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
    const behavior = bossProfileForTier(tier);
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
      definition.hp * behavior.hpMultiplier * power *
      this.progress.adaptiveDifficulty.deathDifficultyMultiplier,
    ));
    boss.hp = boss.maxHp;
    boss.speed = definition.speed * behavior.speedMultiplier;
    boss.damage = Math.max(1, Math.round(definition.damage * behavior.damageMultiplier));
    boss.xpValue = Math.max(
      BOSS_XP_REWARD_BASE,
      Math.floor(BOSS_XP_REWARD_BASE * Math.pow(BOSS_XP_REWARD_MULTIPLIER, tier - 1)),
    );
    boss.lastDmgT = 0;
    boss.normalGeneration = this.progress.normalGeneration;
    boss.bossSpawnEndsAt = this.scene.time.now + BOSS_ENTRY_DURATION_MS;
    boss.bossAttackPhase = 'chase';
    boss.bossAttackRevision = 0;
    boss.bossAttackCooldownUntil = boss.bossSpawnEndsAt + 700;
    boss.bossAttackOriginX = x;
    boss.bossAttackOriginY = y;
    boss.bossAttackTargetX = x;
    boss.bossAttackTargetY = y;
    boss.bossAttackRadius = behavior.hitRadius;
    boss.bossAttackStyle = behavior.attackStyle;
    boss.presentation = BossPresentation.create(
      this.scene,
      x,
      y,
      tier,
      BOSS_ENTRY_DURATION_MS,
    );
    if (boss.presentation instanceof BossPresentation) {
      boss.setAlpha(0).setDisplaySize(
        boss.presentation.visualHeight,
        boss.presentation.visualHeight,
      );
    } else {
      boss.setVisible(false);
    }
    const body = boss.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    boss.setVelocity(0, 0);
    this.scene.time.delayedCall(BOSS_ENTRY_DURATION_MS, () => {
      if (!boss.active) return;
      const activeBody = boss.body as Phaser.Physics.Arcade.Body | null;
      if (activeBody) activeBody.enable = true;
      boss.bossAttackCooldownUntil = this.scene.time.now + 700;
      if (!boss.presentation) boss.setVisible(true);
      // The scene update can cross the entry boundary in the same frame as
      // this timer. Use the idempotent sync path so two HP bars cannot be
      // created with one orphaned at the original spawn position.
      this.syncHealthBar(boss);
    });
    this.progress.bossGeneration = Math.max(this.progress.bossGeneration, tier);
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
    const halfWorld = ARENA_PLAYABLE_HALF_SIZE - TILE_SIZE;
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
    this.beginMonsterPortalEntry(enemy);
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
      if (enemy.enemyType !== 'boss' && isMonsterEnteringPortal(
        enemy.portalSpawnEndsAt,
        this.scene.time.now,
      )) {
        enemy.setVelocity(0, 0);
        enemy.spawnPresentation?.sync(enemy.x, enemy.y);
        return;
      }
      if (enemy.enemyType === 'boss') {
        this.updateBossAi(enemy, target);
      } else if ((enemy.knockbackUntil ?? 0) <= this.scene.time.now) {
        const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.sprite.x, target.sprite.y);
        enemy.setVelocity(Math.cos(angle) * enemy.speed, Math.sin(angle) * enemy.speed);
      }
      const movingLeft = (enemy.body as Phaser.Physics.Arcade.Body).velocity.x < 0;
      enemy.setFlipX(movingLeft);
      enemy.presentation?.sync(enemy.x, enemy.y, movingLeft);
      enemy.presentation?.syncBossAttack?.(this.getBossAttackVisualState(enemy));
      this.syncHealthBar(enemy);
    });
  }

  private updateBossAi(enemy: EnemySprite, target: PlayerController): void {
    const now = this.scene.time.now;
    if (isBossEntering(enemy.bossSpawnEndsAt, now)) {
      enemy.setVelocity(0, 0);
      return;
    }
    const behavior = bossProfileForTier(enemy.bossTier ?? 1);
    const phase = enemy.bossAttackPhase ?? 'chase';

    if (phase === 'windup') {
      enemy.setVelocity(0, 0);
      if (now >= (enemy.bossAttackEndsAt ?? now)) {
        this.beginBossAttackImpact(enemy, behavior, now);
      }
      return;
    }

    if (enemy.bossAttackPhase === 'attack') {
      this.updateBossAttackImpact(enemy, behavior, now);
      return;
    }

    if (phase === 'recover') {
      enemy.setVelocity(0, 0);
      if (now >= (enemy.bossAttackEndsAt ?? now)) enemy.bossAttackPhase = 'chase';
      return;
    }

    if ((enemy.knockbackUntil ?? 0) > now) return;
    const distance = Phaser.Math.Distance.Between(
      enemy.x,
      enemy.y,
      target.sprite.x,
      target.sprite.y,
    );
    if (distance <= behavior.triggerRange && now >= (enemy.bossAttackCooldownUntil ?? 0)) {
      this.beginBossAttackWindup(enemy, target, behavior, now);
      return;
    }

    const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.sprite.x, target.sprite.y);
    enemy.setVelocity(Math.cos(angle) * enemy.speed, Math.sin(angle) * enemy.speed);
  }

  private beginBossAttackWindup(
    enemy: EnemySprite,
    target: PlayerController,
    behavior: BossBehaviorProfile,
    now: number,
  ): void {
    const originX = enemy.x;
    const originY = enemy.y;
    let targetX = originX;
    let targetY = originY;
    if (behavior.attackStyle === 'magic') {
      targetX = target.sprite.x;
      targetY = target.sprite.y;
    } else if (behavior.attackStyle === 'dash') {
      const clamped = clampBossAttackTarget(
        originX,
        originY,
        target.sprite.x,
        target.sprite.y,
        behavior.maxTravel,
      );
      targetX = clamped.x;
      targetY = clamped.y;
    }
    enemy.bossAttackPhase = 'windup';
    enemy.bossAttackRevision = (enemy.bossAttackRevision ?? 0) + 1;
    enemy.bossAttackStartedAt = now;
    enemy.bossAttackEndsAt = now + behavior.windupMs;
    enemy.bossAttackOriginX = originX;
    enemy.bossAttackOriginY = originY;
    enemy.bossAttackTargetX = targetX;
    enemy.bossAttackTargetY = targetY;
    enemy.bossAttackRadius = behavior.hitRadius;
    enemy.bossAttackStyle = behavior.attackStyle;
    enemy.bossAttackHitPlayers = new WeakSet<object>();
    enemy.setVelocity(0, 0);
  }

  private beginBossAttackImpact(
    enemy: EnemySprite,
    behavior: BossBehaviorProfile,
    now: number,
  ): void {
    enemy.bossAttackPhase = 'attack';
    enemy.bossAttackStartedAt = now;
    enemy.bossAttackEndsAt = now + behavior.attackMs;
    if (behavior.attackStyle === 'dash') {
      const dx = (enemy.bossAttackTargetX ?? enemy.x) - (enemy.bossAttackOriginX ?? enemy.x);
      const dy = (enemy.bossAttackTargetY ?? enemy.y) - (enemy.bossAttackOriginY ?? enemy.y);
      const durationSeconds = Math.max(0.001, behavior.attackMs / 1_000);
      this.damagePlayersInCurrentBossArea(enemy);
      enemy.setVelocity(dx / durationSeconds, dy / durationSeconds);
      return;
    }
    enemy.setVelocity(0, 0);
    this.damagePlayersInCurrentBossArea(enemy);
  }

  private updateBossAttackImpact(
    enemy: EnemySprite,
    behavior: BossBehaviorProfile,
    now: number,
  ): void {
    if (behavior.attackStyle === 'dash') this.damagePlayersNearDashingBoss(enemy, behavior.hitRadius);
    if (now < (enemy.bossAttackEndsAt ?? now)) return;
    if (behavior.attackStyle === 'dash') {
      enemy.setPosition(
        enemy.bossAttackTargetX ?? enemy.x,
        enemy.bossAttackTargetY ?? enemy.y,
      );
      this.damagePlayersNearDashingBoss(enemy, behavior.hitRadius);
    }
    enemy.setVelocity(0, 0);
    enemy.bossAttackPhase = 'recover';
    enemy.bossAttackStartedAt = now;
    enemy.bossAttackEndsAt = now + behavior.recoveryMs;
    enemy.bossAttackCooldownUntil = now + behavior.recoveryMs + behavior.cooldownMs;
  }

  private damagePlayersInCurrentBossArea(enemy: EnemySprite): void {
    const style = enemy.bossAttackStyle ?? 'slam';
    const originX = enemy.bossAttackOriginX ?? enemy.x;
    const originY = enemy.bossAttackOriginY ?? enemy.y;
    const targetX = enemy.bossAttackTargetX ?? enemy.x;
    const targetY = enemy.bossAttackTargetY ?? enemy.y;
    const radius = enemy.bossAttackRadius ?? 0;
    this.livingPlayers().forEach((player) => {
      if (!isPointInBossAttack(
        style,
        player.sprite.x,
        player.sprite.y,
        originX,
        originY,
        targetX,
        targetY,
        radius,
      )) return;
      this.damagePlayerFromEnemy(player, enemy);
    });
  }

  private damagePlayersNearDashingBoss(enemy: EnemySprite, radius: number): void {
    this.livingPlayers().forEach((player) => {
      if (Phaser.Math.Distance.Squared(
        enemy.x,
        enemy.y,
        player.sprite.x,
        player.sprite.y,
      ) > radius * radius) return;
      this.damagePlayerFromEnemy(player, enemy);
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
    if (enemy.enemyType === 'boss') {
      if (
        isBossEntering(enemy.bossSpawnEndsAt, this.scene.time.now) ||
        enemy.bossAttackPhase === 'attack'
      ) return;
      let playerContactTimes = this.bossContactTimes.get(enemy);
      if (!playerContactTimes) {
        playerContactTimes = new WeakMap();
        this.bossContactTimes.set(enemy, playerContactTimes);
      }
      const now = this.scene.time.now;
      if (now < (playerContactTimes.get(player) ?? 0)) return;
      if (this.damagePlayerFromEnemy(
        player,
        enemy,
        BOSS_CONTACT_DAMAGE_MULTIPLIER,
        false,
      )) {
        playerContactTimes.set(player, now + BOSS_CONTACT_INTERVAL_MS);
      }
      return;
    }
    this.damagePlayerFromEnemy(player, enemy);
  }

  private damagePlayerFromEnemy(
    player: PlayerController,
    enemy: EnemySprite,
    damageMultiplier = 1,
    trackBossAttackHit = true,
  ): boolean {
    if (trackBossAttackHit && enemy.bossAttackHitPlayers?.has(player)) return false;
    if (this.options.isGameOver()) return false;
    if (!player.tryBeginHitWindow()) return false;
    if (trackBossAttackHit) enemy.bossAttackHitPlayers?.add(player);
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
      return true;
    }
    const damage = enemy.enemyType === 'boss' &&
      damageMultiplier === BOSS_CONTACT_DAMAGE_MULTIPLIER
      ? bossContactDamage(enemy.damage, player.stats.armor)
      : Math.max(
        1,
        Math.max(1, Math.round(enemy.damage * damageMultiplier)) - player.stats.armor,
      );
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
    return true;
  }

  private onProjectileHit(projectile: DamageSprite, enemy: EnemySprite): void {
    if (!projectile.active || !enemy.active) return;
    this.damageEnemy(enemy, projectile.damage);
    projectile.pierce = (projectile.pierce ?? 1) - 1;
    if (projectile.pierce <= 0) projectile.destroy();
  }

  private onMeleeHit(hitbox: DamageSprite, enemy: EnemySprite): void {
    if (!hitbox.active || !enemy.active || hitbox.presentationOnly) return;
    const now = this.scene.time.now;
    const sourceId = hitbox.damageSourceId ?? 'shared-melee';
    if (hitbox.hitMode === 'contact') {
      let contactFrames = this.meleeContactFrames.get(enemy);
      if (!contactFrames) {
        contactFrames = new Map();
        this.meleeContactFrames.set(enemy, contactFrames);
      }
      if (!consumeDamageContact(contactFrames, sourceId, this.meleeContactFrame)) return;
      enemy.lastDmgT = now;
      this.damageEnemy(enemy, hitbox.damage, hitbox.knockback);
      return;
    }
    const hitIntervalMs = hitbox.hitIntervalMs ?? MELEE_HIT_INTERVAL_MS;
    let sourceTimes = this.meleeHitTimes.get(enemy);
    if (!sourceTimes) {
      sourceTimes = new Map();
      this.meleeHitTimes.set(enemy, sourceTimes);
    }
    if (!consumeDamageSourceCooldown(sourceTimes, sourceId, now, hitIntervalMs)) return;
    enemy.lastDmgT = now;
    this.damageEnemy(enemy, hitbox.damage, hitbox.knockback);
  }

  private applyEnemyKnockback(enemy: EnemySprite, knockback: EnemyKnockback): void {
    if (knockback.strength <= 0 || knockback.durationMs <= 0) return;
    // Preserve an already telegraphed boss action. Bosses still receive a
    // reduced push while chasing, whereas regular and compressed enemies take
    // the full weapon knockback.
    if (enemy.enemyType === 'boss' && enemy.bossAttackPhase !== 'chase') return;
    const resistance = enemy.enemyType === 'boss' ? 0.35 : 1;
    const strength = knockback.strength * resistance;
    const now = this.scene.time.now;
    if (!shouldApplyKnockback(
      enemy.knockbackUntil ?? 0,
      enemy.knockbackStrength ?? 0,
      now,
      strength,
    )) return;
    enemy.knockbackUntil = Math.max(
      enemy.knockbackUntil ?? 0,
      now + knockback.durationMs * resistance,
    );
    enemy.knockbackStrength = strength;
    enemy.setVelocity(
      knockback.directionX * strength,
      knockback.directionY * strength,
    );
  }

  private pruneMeleeContacts(): void {
    this.getActiveEnemies().forEach((enemy) => {
      const contactFrames = this.meleeContactFrames.get(enemy);
      if (!contactFrames) return;
      pruneDamageContacts(contactFrames, this.meleeContactFrame);
    });
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
      const remainingBosses = this.getActiveEnemies().filter((candidate) => (
        candidate !== enemy && candidate.enemyType === 'boss'
      )).length;
      if (remainingBosses === 0) {
        this.advanceNormalGeneration();
        this.options.showToast(`보스 무리 처치! 경험치 ${xpValue} + 체력 회복 보상`);
      } else {
        this.options.showToast(`보스 처치! 남은 보스 ${remainingBosses}마리`);
      }
      // Fire once for every boss, rather than only after the entire wave dies.
      this.options.onBossKilled?.(enemy);
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

    // Regular enemies drop gems, while bosses use a dedicated reward bundle.
    // The former bonus-star roll remains folded into that one XP pickup.
    const totalXpValue = xpValue + (Math.random() < 0.05 ? 5 : 0);
    this.createXpDrop(
      enemy.x,
      enemy.y,
      totalXpValue,
      isBoss ? 'boss' : 'regular',
    );

    if (
      (isBoss || Math.random() < 0.08) &&
      this.healthOrbs.countActive() < MAX_ACTIVE_HEALTH_DROPS
    ) {
      this.healthOrbs.create(enemy.x + Phaser.Math.Between(-10, 10), enemy.y, 'healthPotion')
        .setDepth(2)
        .setDisplaySize(HEALTH_DROP_WIDTH, HEALTH_DROP_HEIGHT);
    }

    enemy.healthBar?.destroy();
    enemy.healthBar = null;
    enemy.spawnPresentation?.destroy();
    enemy.spawnPresentation = null;
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

  private beginMonsterPortalEntry(enemy: EnemySprite): void {
    enemy.portalSpawnEndsAt = this.scene.time.now + MONSTER_PORTAL_DURATION_MS;
    enemy.portalSpawnNetworkEndsAt = Date.now() + MONSTER_PORTAL_DURATION_MS;
    enemy.setVelocity(0, 0).setVisible(false);
    const body = enemy.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    if (this.isWithinCamera(enemy.x, enemy.y)) {
      enemy.spawnPresentation = MonsterPortalPresentation.create(
        this.scene,
        enemy.x,
        enemy.y,
        {
          texture: 'monsterSheet',
          frame: enemy.monsterFrames.idle,
          scale: Math.abs(enemy.scaleX),
          tint: enemy.baseTint,
        },
        MONSTER_PORTAL_DURATION_MS,
      );
    }
    this.scene.time.delayedCall(MONSTER_PORTAL_DURATION_MS, () => {
      if (!enemy.active) return;
      const activeBody = enemy.body as Phaser.Physics.Arcade.Body | null;
      if (activeBody) activeBody.enable = true;
      enemy.portalSpawnEndsAt = undefined;
      enemy.portalSpawnNetworkEndsAt = undefined;
      enemy.spawnPresentation?.destroy();
      enemy.spawnPresentation = null;
      enemy.setVisible(true);
    });
  }

  private createHealthBar(enemy: EnemySprite): void {
    if (enemy.enemyType !== 'boss') {
      enemy.healthBar?.destroy();
      enemy.healthBar = null;
      return;
    }
    if (isBossEntering(enemy.bossSpawnEndsAt, this.scene.time.now)) {
      enemy.healthBar?.destroy();
      enemy.healthBar = null;
      return;
    }
    if (!this.isWithinCamera(enemy.x, enemy.y)) {
      enemy.healthBar?.destroy();
      enemy.healthBar = null;
      return;
    }
    if (enemy.healthBar) {
      enemy.healthBar.update();
      return;
    }
    enemy.healthBar = new EnemyHealthBar(this.scene, enemy);
  }

  private syncHealthBar(enemy: EnemySprite): void {
    if (enemy.enemyType !== 'boss') {
      enemy.healthBar?.destroy();
      enemy.healthBar = null;
      return;
    }
    if (isBossEntering(enemy.bossSpawnEndsAt, this.scene.time.now)) {
      enemy.healthBar?.destroy();
      enemy.healthBar = null;
      return;
    }
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

  private createXpDrop(
    x: number,
    y: number,
    value: number,
    kind: XpDropKind,
  ): void {
    let dropValue = value;
    if (this.xpGems.countActive() >= MAX_ACTIVE_XP_DROPS) {
      const activeDrops = (this.xpGems.getChildren() as DropSprite[]).filter((gem) => gem.active);
      const existing = activeDrops.find((gem) => gem.xpDropKind !== 'boss') ?? activeDrops[0];
      if (existing) {
        if (kind === 'boss') {
          dropValue += existing.xpValue ?? 1;
          existing.destroy();
        } else {
          existing.xpValue = (existing.xpValue ?? 1) + value;
          if (existing.xpDropKind !== 'boss') {
            const mergedSize = regularXpDropSize(existing.xpValue, 44);
            existing.setDisplaySize(mergedSize, mergedSize);
          }
          return;
        }
      }
    }

    const gem = this.xpGems.create(
      x,
      y,
      kind === 'boss' ? BOSS_XP_REWARD_TEXTURE_KEY : 'xpGem',
    ) as DropSprite;
    gem.setDepth(2);
    gem.xpDropKind = kind;
    gem.xpValue = dropValue;
    if (kind === 'regular') {
      const size = regularXpDropSize(dropValue);
      gem.setDisplaySize(size, size);
      return;
    }

    gem.setDisplaySize(BOSS_XP_REWARD_DISPLAY_WIDTH, BOSS_XP_REWARD_DISPLAY_HEIGHT);
    const body = gem.body as Phaser.Physics.Arcade.Body;
    const sourceBodyWidth = BOSS_XP_REWARD_PICKUP_SIZE / Math.max(0.001, Math.abs(gem.scaleX));
    const sourceBodyHeight = BOSS_XP_REWARD_PICKUP_SIZE / Math.max(0.001, Math.abs(gem.scaleY));
    body.setSize(sourceBodyWidth, sourceBodyHeight);
    body.setOffset(
      (gem.width - sourceBodyWidth) / 2,
      (gem.height - sourceBodyHeight) / 2,
    );
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

  private rescaleNonBossEnemyHp(scaleRatio: number): void {
    this.getActiveEnemies().forEach((enemy) => {
      if (enemy.enemyType === 'boss') return;
      this.rescaleOneEnemyHp(enemy, scaleRatio);
    });
  }

  private rescaleEnemyHp(scaleRatio: number, regularOnly: boolean): void {
    this.getActiveEnemies().forEach((enemy) => {
      if (regularOnly && !REGULAR_ENEMY_TYPES.has(enemy.enemyType)) return;
      this.rescaleOneEnemyHp(enemy, scaleRatio);
    });
  }

  private rescaleOneEnemyHp(enemy: EnemySprite, scaleRatio: number): void {
    const health = scaleHealthPreservingRatio(enemy.hp, enemy.maxHp, scaleRatio);
    enemy.maxHp = health.maxHp;
    enemy.hp = health.hp;
    enemy.healthBar?.destroy();
    this.createHealthBar(enemy);
  }

  private players(): PlayerController[] {
    return this.options.getPlayers?.() ?? [this.player];
  }

  private livingPlayers(): PlayerController[] {
    return this.players().filter((player) => player.stats.hp > 0 && player.sprite.active);
  }
}
