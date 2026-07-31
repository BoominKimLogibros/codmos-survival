import {
  ARENA_PLAYABLE_HALF_SIZE,
  RUNE_CHARGE_DURATION_MS,
  RUNE_CHARGE_RADIUS,
  RUNE_ROLL_INTERVAL_SECONDS,
  RUNE_SHIELD_BLOCK_COUNT,
  TILE_SIZE,
} from '../config/constants';
import { RuneChargeGauge } from '../objects/RuneChargeGauge';
import { ShieldChargeCounter } from '../objects/ShieldChargeCounter';
import { ShieldPresentation } from '../objects/ShieldPresentation';
import { MultiAttackPresentation } from '../objects/MultiAttackPresentation';
import { RuneActivationPresentation } from '../objects/RuneActivationPresentation';
import { RuneChallenge } from '../ui/RuneChallenge';
import type { AudioManager } from './AudioManager';
import type { PlayerController } from './PlayerController';
import { getRuneSpawnChance } from './runeSpawn';
import { MULTI_ATTACK_BOSS_DAMAGE_RATIO, multiAttackDamage } from './runeAttack';
import { runeDropVisualState, runeTextureKey } from './runeDrop';
import type { EnemySprite, RuneSprite, RuneType, RunProgress } from './types';

interface RuneSystemOptions {
  getEnemies: () => EnemySprite[];
  damageEnemy: (enemy: EnemySprite, damage: number) => void;
  onChallengeOpened: () => void;
  onChallengeCompleted: () => void;
  showToast: (message: string, isError?: boolean) => void;
}

/** Owns timed rune drops, collection challenges, and temporary rune effects. */
export class RuneSystem {
  readonly runes: Phaser.Physics.Arcade.Group;

  private challenge?: RuneChallenge;
  private chargingRune?: RuneSprite;
  private chargeGauge?: RuneChargeGauge;
  private chargeElapsedMs = 0;
  private shieldPresentation?: ShieldPresentation;
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
      this.shieldPresentation?.destroy(false);
      this.shieldCounter?.destroy();
    });
  }

  update(delta: number): void {
    this.rollRuneSpawn();
    this.updateRuneAppearances();
    this.updateRuneCharge(delta);
    this.updateShieldPresentation();
  }

  tryBlockPlayerHit(): boolean {
    if (this.scene.time.now < this.multiAttackGuardUntil) return true;
    if (this.shieldCharges <= 0) return false;
    this.shieldCharges--;
    this.shieldPresentation?.sync(
      this.player.sprite.x,
      this.player.sprite.y,
      this.shieldCharges,
    );
    this.shieldCounter?.setCharges(this.shieldCharges);
    this.audio.effects.spring.play();
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
    const halfWorld = ARENA_PLAYABLE_HALF_SIZE - TILE_SIZE;
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
    const rune = this.runes.create(x, y, 'runeEmbedded') as RuneSprite;
    rune.runeType = Math.random() < 0.5 ? 'multiAttack' : 'shield';
    rune.runeSpawnedAt = this.scene.time.now;
    rune.runeAnchorY = y;
    rune.runeAvailable = false;
    rune.runePhase = 'embedded';
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
    this.options.showToast(`${label} 룬 등장 · 3초 뒤 솟아오르면 룬 위에 머무르세요.`);
    return rune;
  }

  private updateRuneAppearances(): void {
    const now = this.scene.time.now;
    (this.runes.getChildren() as RuneSprite[]).forEach((rune) => {
      if (!rune.active) return;
      const visual = runeDropVisualState(now - rune.runeSpawnedAt);
      if (rune.runePhase !== visual.phase) {
        rune.runePhase = visual.phase;
        rune.setTexture(runeTextureKey(visual.phase));
      }
      rune.runeAvailable = visual.available;
      rune.y = rune.runeAnchorY + visual.offsetY;
    });
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
      if (!rune.active || !rune.runeAvailable) return;
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
    RuneActivationPresentation.play(this.scene, runeType);
    if (runeType === 'multiAttack') {
      this.activateMultiAttack();
      return;
    }
    this.activateShield();
  }

  private activateMultiAttack(): void {
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
          if (!enemy.active || this.player.isBossSuccessActive) return;
          this.options.damageEnemy(enemy, multiAttackDamage(enemy, this.player.stats.level));
        },
      },
    );
    this.options.showToast(
      `다중 공격 발동 · 일반 몬스터 전멸, 보스 최대 HP ${MULTI_ATTACK_BOSS_DAMAGE_RATIO * 100}% 강타`,
    );
  }

  private activateShield(): void {
    this.shieldCharges = RUNE_SHIELD_BLOCK_COUNT;
    this.shieldPresentation?.destroy(false);
    this.shieldCounter?.destroy();
    this.shieldPresentation = new ShieldPresentation(
      this.scene,
      this.player.sprite.x,
      this.player.sprite.y,
      this.shieldCharges,
    );
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

  private updateShieldPresentation(): void {
    if (this.shieldCharges <= 0) return;
    this.shieldPresentation?.setPosition(
      this.player.sprite.x,
      this.player.sprite.y,
    );
    this.shieldCounter?.setPosition(this.player.sprite.x, this.player.sprite.y);
  }

  private endShield(): void {
    this.shieldCharges = 0;
    this.shieldPresentation?.destroy(true);
    this.shieldPresentation = undefined;
    this.shieldCounter?.destroy();
    this.shieldCounter = undefined;
    this.options.showToast('보호막을 모두 사용했습니다.');
  }
}
