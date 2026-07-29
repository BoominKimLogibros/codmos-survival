import {
  RUNE_CHARGE_DURATION_MS,
  RUNE_CHARGE_RADIUS,
  RUNE_ROLL_INTERVAL_SECONDS,
  RUNE_SHIELD_BLOCK_COUNT,
  TILE_SIZE,
  WORLD_SIZE,
} from '../config/constants';
import { RuneChargeGauge } from '../objects/RuneChargeGauge';
import { ShieldChargeCounter } from '../objects/ShieldChargeCounter';
import { MultiAttackPresentation } from '../objects/MultiAttackPresentation';
import { RuneChallenge } from '../ui/RuneChallenge';
import { UI_COLORS } from '../ui/theme';
import type { AudioManager } from './AudioManager';
import type { PlayerController } from './PlayerController';
import { getRuneSpawnChance } from './runeSpawn';
import type { EnemySprite, RuneSprite, RuneType, RunProgress } from './types';

interface RuneSystemOptions {
  getEnemies: () => EnemySprite[];
  damageEnemy: (enemy: EnemySprite, damage: number) => void;
  onChallengeOpened: () => void;
  onChallengeCompleted: () => void;
  showToast: (message: string, isError?: boolean) => void;
}

type FollowEffect = SpineGameObject | Phaser.GameObjects.Arc;

/** Owns timed rune drops, collection challenges, and temporary rune effects. */
export class RuneSystem {
  readonly runes: Phaser.Physics.Arcade.Group;

  private challenge?: RuneChallenge;
  private chargingRune?: RuneSprite;
  private chargeGauge?: RuneChargeGauge;
  private chargeElapsedMs = 0;
  private shieldEffect?: FollowEffect;
  private shieldCounter?: ShieldChargeCounter;
  private shieldCharges = 0;
  private multiAttackGuardUntil = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: PlayerController,
    private readonly audio: AudioManager,
    private readonly progress: RunProgress,
    private readonly options: RuneSystemOptions,
  ) {
    this.runes = scene.physics.add.group();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.challenge?.destroy();
      this.chargeGauge?.destroy();
      this.shieldEffect?.destroy();
      this.shieldCounter?.destroy();
    });
  }

  update(delta: number): void {
    this.rollRuneSpawn();
    this.updateRuneCharge(delta);
    this.updateShieldPresentation();
  }

  tryBlockPlayerHit(): boolean {
    if (this.scene.time.now < this.multiAttackGuardUntil) return true;
    if (this.shieldCharges <= 0) return false;
    this.shieldCharges--;
    this.shieldCounter?.setCharges(this.shieldCharges);
    this.audio.effects.spring.play();
    const blockFlash = this.scene.add.circle(
      this.player.sprite.x,
      this.player.sprite.y,
      54,
      UI_COLORS.white,
      0.26,
    ).setDepth(30);
    this.scene.tweens.add({
      targets: blockFlash,
      scaleX: 1.18,
      scaleY: 1.18,
      alpha: 0,
      duration: 140,
      onComplete: () => blockFlash.destroy(),
    });
    if (this.shieldCharges <= 0) this.endShield();
    return true;
  }

  private rollRuneSpawn(): boolean {
    const currentInterval = Math.floor(
      this.progress.gameTime / RUNE_ROLL_INTERVAL_SECONDS,
    );
    if (currentInterval <= this.progress.lastRuneRollInterval) return false;
    this.progress.lastRuneRollInterval = currentInterval;
    const spawnChance = getRuneSpawnChance(this.options.getEnemies().length);
    if (Math.random() >= spawnChance) return false;
    this.spawnRune();
    return true;
  }

  private spawnRune(): RuneSprite {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const distance = Phaser.Math.Between(190, 330);
    const halfWorld = WORLD_SIZE / 2 - TILE_SIZE;
    const x = Phaser.Math.Clamp(
      this.player.sprite.x + Math.cos(angle) * distance,
      -halfWorld,
      halfWorld,
    );
    const y = Phaser.Math.Clamp(
      this.player.sprite.y + Math.sin(angle) * distance,
      -halfWorld,
      halfWorld,
    );
    const rune = this.runes.create(x, y, 'rune') as RuneSprite;
    rune.runeType = Math.random() < 0.5 ? 'multiAttack' : 'shield';
    rune.setDepth(7).setDisplaySize(62, 62);
    (rune.body as Phaser.Physics.Arcade.Body).setCircle(72, 24, 24);
    this.scene.tweens.add({
      targets: rune,
      alpha: 0.78,
      duration: 850,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    const label = rune.runeType === 'multiAttack' ? '다중 공격' : '보호막';
    this.options.showToast(`${label} 룬 등장 · 룬 위에서 3초간 머무르세요.`);
    return rune;
  }

  private updateRuneCharge(delta: number): void {
    if (this.challenge) return;
    const rune = this.findRuneInChargeRange();
    if (!rune) {
      this.resetRuneCharge();
      return;
    }
    if (this.chargingRune !== rune) {
      this.resetRuneCharge();
      this.chargingRune = rune;
      this.chargeGauge = new RuneChargeGauge(this.scene);
    }

    this.chargeElapsedMs = Math.min(
      RUNE_CHARGE_DURATION_MS,
      this.chargeElapsedMs + delta,
    );
    this.chargeGauge?.update(
      rune.x,
      rune.y,
      this.chargeElapsedMs / RUNE_CHARGE_DURATION_MS,
    );
    if (this.chargeElapsedMs < RUNE_CHARGE_DURATION_MS) return;

    this.resetRuneCharge();
    this.collectRune(rune);
  }

  private findRuneInChargeRange(): RuneSprite | undefined {
    const playerX = this.player.sprite.x;
    const playerY = this.player.sprite.y;
    let nearestRune: RuneSprite | undefined;
    let nearestDistance = RUNE_CHARGE_RADIUS;
    (this.runes.getChildren() as RuneSprite[]).forEach((rune) => {
      if (!rune.active) return;
      const distance = Phaser.Math.Distance.Between(playerX, playerY, rune.x, rune.y);
      if (distance > nearestDistance) return;
      nearestDistance = distance;
      nearestRune = rune;
    });
    return nearestRune;
  }

  private resetRuneCharge(): void {
    this.chargingRune = undefined;
    this.chargeElapsedMs = 0;
    this.chargeGauge?.destroy();
    this.chargeGauge = undefined;
  }

  private collectRune(rune: RuneSprite): void {
    if (!rune.active || this.challenge) return;
    const runeType = rune.runeType;
    rune.destroy();
    this.options.onChallengeOpened();
    this.challenge = new RuneChallenge(this.scene, {
      runeType,
      onSuccess: () => {
        this.challenge = undefined;
        this.activateRune(runeType);
        this.options.onChallengeCompleted();
      },
    });
  }

  private activateRune(runeType: RuneType): void {
    if (runeType === 'multiAttack') {
      this.activateMultiAttack();
      return;
    }
    this.activateShield();
  }

  private activateMultiAttack(): void {
    const baseDamage = Math.max(100, this.player.stats.level * 20);
    const enemies = this.options.getEnemies();
    this.multiAttackGuardUntil = this.scene.time.now + MultiAttackPresentation.durationMs;
    this.audio.effects.multiAttack.play();
    MultiAttackPresentation.play(
      this.scene,
      this.player.sprite.x,
      this.player.sprite.y,
      {
        targets: enemies,
        onImpact: (enemy) => {
          if (!enemy.active) return;
          const damage = enemy.enemyType === 'boss'
            ? Math.max(baseDamage, Math.ceil(enemy.maxHp * 0.1))
            : enemy.hp;
          this.options.damageEnemy(enemy, damage);
        },
      },
    );
    this.options.showToast('다중 공격 발동 · 일반 몬스터 전멸, 보스 최대 HP 10% 피해');
  }

  private activateShield(): void {
    this.shieldCharges = RUNE_SHIELD_BLOCK_COUNT;
    this.shieldEffect?.destroy();
    this.shieldCounter?.destroy();
    this.shieldEffect = this.createShieldEffect();
    this.shieldCounter = new ShieldChargeCounter(
      this.scene,
      this.player.sprite.x,
      this.player.sprite.y,
      this.shieldCharges,
    );
    this.shieldCounter.setPosition(this.player.sprite.x, this.player.sprite.y);
    this.audio.effects.shield.play();
    this.options.showToast('보호막 발동 · 공격을 10회 막아냅니다.');
  }

  private createShieldEffect(): FollowEffect {
    const { x, y } = this.player.sprite;
    if (this.scene.game.renderer.type === Phaser.WEBGL) {
      try {
        return this.scene.add.spine(
          x,
          y + 18,
          'runeShield',
          'animation',
          true,
        ).setDepth(6).setScale(0.42);
      } catch (error) {
        console.warn('Shield Spine effect failed, using fallback:', error);
      }
    }
    return this.scene.add.circle(x, y, 54, UI_COLORS.primary, 0.14)
      .setStrokeStyle(3, UI_COLORS.white, 0.78)
      .setDepth(6);
  }

  private updateShieldPresentation(): void {
    if (this.shieldCharges <= 0) return;
    this.shieldEffect?.setPosition(
      this.player.sprite.x,
      this.player.sprite.y + (this.shieldEffect instanceof Phaser.GameObjects.Arc ? 0 : 18),
    );
    this.shieldCounter?.setPosition(this.player.sprite.x, this.player.sprite.y);
  }

  private endShield(): void {
    this.shieldCharges = 0;
    this.shieldEffect?.destroy();
    this.shieldEffect = undefined;
    this.shieldCounter?.destroy();
    this.shieldCounter = undefined;
    this.options.showToast('보호막을 모두 사용했습니다.');
  }
}
