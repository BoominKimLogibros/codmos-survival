import { BOSS_SPAWN_SPINE_ASSET, BOSS_SPINE_ASSETS } from '../config/assets';
import {
  BOSS_ENTRY_DURATION_MS,
  BOSS_SPAWN_ANIMATION_DURATION_MS,
  BOSS_SUMMON_EFFECT_DURATION_MS,
  bossAttackAnimationHasPriority,
  bossProfileForTier,
  type BossAttackVisualState,
  type BossBehaviorProfile,
} from '../game/bossBehavior';
import type { EnemyPresentation } from '../game/types';

/** Renders a Spine boss while the owning Arcade sprite remains the physics proxy. */
export class BossPresentation implements EnemyPresentation {
  readonly visualHeight: number;

  private readonly view: SpineGameObject;
  private readonly scale: number;
  private readonly groundOffset: number;
  private readonly behavior: BossBehaviorProfile;
  private readonly telegraph: Phaser.GameObjects.Graphics;
  private spawnEffect: SpineGameObject | null = null;
  private x: number;
  private y: number;
  private stage: 'summon' | 'spawn' | 'active' = 'active';
  private externallyVisible = true;
  private facingLeft = true;
  private destroyed = false;
  private lastAttackRevision = 0;
  private attackAnimationPriority = false;
  private hitAnimationRevision = 0;
  private activeHitEyePose: 'die' | 'stun' | null = null;
  private readonly eyeSlotFamilies: string[];

  static create(
    scene: Phaser.Scene,
    x: number,
    y: number,
    tier: number,
    entryRemainingMs = BOSS_ENTRY_DURATION_MS,
  ): BossPresentation | null {
    if (scene.game.renderer.type !== Phaser.WEBGL) return null;
    try {
      return new BossPresentation(scene, x, y, tier, entryRemainingMs);
    } catch (error) {
      console.warn('Boss Spine loading failed, using fallback sprite:', error);
      return null;
    }
  }

  private constructor(
    private readonly scene: Phaser.Scene,
    x: number,
    y: number,
    tier: number,
    entryRemainingMs: number,
  ) {
    const config = BOSS_SPINE_ASSETS[(tier - 1) % BOSS_SPINE_ASSETS.length];
    this.behavior = bossProfileForTier(tier);
    this.scale = config.scale;
    this.visualHeight = config.visualHeight;
    this.groundOffset = this.visualHeight * 0.4;
    this.x = x;
    this.y = y;
    const remainingMs = Phaser.Math.Clamp(entryRemainingMs, 0, BOSS_ENTRY_DURATION_MS);
    const startsInBossSpawn = remainingMs > 0 &&
      remainingMs <= BOSS_SPAWN_ANIMATION_DURATION_MS;
    // Match the proven dokkaebi setup used by dgtl_ltrcy_kybrd_game_2: applying
    // the skin before the first animation lets Spine establish every eye slot.
    this.view = scene.make.spine({
      x,
      y: y + this.groundOffset,
      key: config.key,
      animationName: startsInBossSpawn ? 'spawn' : 'idle',
      skinName: config.skin,
      loop: !startsInBossSpawn,
    })
      .setDepth(3.5)
      .setScale(this.scale);
    this.eyeSlotFamilies = ['eyes', 'eyes2'].filter((name) => (
      this.view.findSlot(`${name}_idle`) !== null
    ));
    this.telegraph = scene.add.graphics().setDepth(3.25);
    if (remainingMs > BOSS_SPAWN_ANIMATION_DURATION_MS) {
      this.beginSummonEffect(remainingMs);
    } else if (remainingMs > 0) {
      this.beginBossSpawnMotion(remainingMs);
    }
  }

  setVisible(visible: boolean): void {
    if (this.destroyed) return;
    this.externallyVisible = visible;
    this.applyStageVisibility();
  }

  syncBossAttack(state: BossAttackVisualState | null): void {
    if (this.destroyed || !this.view.active || !this.telegraph.active) return;
    this.telegraph.clear();
    if (this.stage !== 'active') return;
    if (!bossAttackAnimationHasPriority(state?.phase)) {
      this.attackAnimationPriority = false;
      return;
    }

    if (!this.attackAnimationPriority) {
      this.attackAnimationPriority = true;
      this.cancelHitMotionForAttack();
    }
    if (!state) return;

    if (state.revision > this.lastAttackRevision) {
      this.lastAttackRevision = state.revision;
      this.playAttackMotion();
    }

    const progress = Phaser.Math.Clamp(state.progress, 0, 1);
    const color = this.behavior.telegraphColor;
    const attackAlpha = state.phase === 'attack' ? 0.34 : 0.08 + progress * 0.16;
    if (state.style === 'dash') {
      this.telegraph.lineStyle(state.radius * 2, color, attackAlpha * 0.55);
      this.telegraph.lineBetween(state.originX, state.originY, state.targetX, state.targetY);
      this.telegraph.lineStyle(3, color, 0.95);
      this.telegraph.lineBetween(state.originX, state.originY, state.targetX, state.targetY);
      this.telegraph.strokeCircle(state.targetX, state.targetY, state.radius);
      const markerX = Phaser.Math.Linear(state.originX, state.targetX, progress);
      const markerY = Phaser.Math.Linear(state.originY, state.targetY, progress);
      this.telegraph.fillStyle(0xffffff, 0.9).fillCircle(markerX, markerY, 5);
      return;
    }

    this.telegraph.fillStyle(color, attackAlpha).fillCircle(
      state.targetX,
      state.targetY,
      state.radius,
    );
    this.telegraph.lineStyle(3, color, 0.95).strokeCircle(
      state.targetX,
      state.targetY,
      state.radius,
    );
    const countdownRadius = Math.max(5, state.radius * (1 - progress * 0.86));
    this.telegraph.lineStyle(2, 0xffffff, 0.88).strokeCircle(
      state.targetX,
      state.targetY,
      countdownRadius,
    );
  }

  sync(x: number, y: number, movingLeft: boolean): void {
    if (this.destroyed || !this.view.active) return;
    this.x = x;
    this.y = y;
    this.view.setPosition(x, y + this.groundOffset);
    this.spawnEffect?.setPosition(x, y + this.groundOffset);
    this.applyActiveHitEyePose();
    if (movingLeft === this.facingLeft) return;
    this.facingLeft = movingLeft;
    this.view.setScale(movingLeft ? this.scale : -this.scale, this.scale);
  }

  showDamageFeedback(): void {
    if (this.destroyed || !this.view.active || this.stage !== 'active') return;
    this.playHitMotion();
    const flash = this.scene.add.ellipse(
      this.x,
      this.y - this.visualHeight * 0.08,
      this.visualHeight * 0.72,
      this.visualHeight * 0.9,
      0xffffff,
      0.72,
    ).setDepth(3.6).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 1.08,
      scaleY: 1.08,
      duration: 90,
      onComplete: () => flash.destroy(),
    });
  }

  private playAttackMotion(): void {
    if (this.stage !== 'active') return;
    try {
      this.view.play(this.behavior.attackAnimation, false);
      this.view.addAnimation(0, 'idle', true, 0);
    } catch {
      this.view.play('idle', true);
    }
  }

  private playHitMotion(): void {
    if (this.stage !== 'active' || this.attackAnimationPriority) return;
    const revision = ++this.hitAnimationRevision;
    try {
      // A separate Spine track preserves the telegraphed attack on track 0.
      this.activeHitEyePose = this.behavior.hitAnimation === 'stun' ? 'stun' : 'die';
      this.view.setAnimation(1, this.behavior.hitAnimation, false);
      this.applyActiveHitEyePose();
      this.scene.time.delayedCall(this.behavior.hitAnimationMs, () => {
        if (this.destroyed || !this.view.active || revision !== this.hitAnimationRevision) return;
        this.activeHitEyePose = null;
        this.view.clearTrack(1);
        this.applyEyePose('idle');
      });
    } catch {
      this.activeHitEyePose = null;
      // The white flash below remains available if a runtime lacks this motion.
    }
  }

  private applyActiveHitEyePose(): void {
    if (this.activeHitEyePose) this.applyEyePose(this.activeHitEyePose);
  }

  private cancelHitMotionForAttack(): void {
    this.hitAnimationRevision++;
    this.activeHitEyePose = null;
    try {
      this.view.clearTrack(1);
      this.applyEyePose('idle');
    } catch {
      // Track 0 attack motion remains the authoritative visual fallback.
    }
  }

  private applyEyePose(visiblePose: 'idle' | 'die' | 'stun'): void {
    this.eyeSlotFamilies.forEach((family) => {
      (['idle', 'die', 'stun'] as const).forEach((pose) => {
        const slot = this.view.findSlot(`${family}_${pose}`);
        if (slot) slot.color.a = pose === visiblePose ? 1 : 0;
      });
    });
  }

  private beginSummonEffect(entryRemainingMs: number): void {
    this.stage = 'summon';
    const summonRemainingMs = Math.max(
      1,
      entryRemainingMs - BOSS_SPAWN_ANIMATION_DURATION_MS,
    );
    try {
      this.spawnEffect = this.scene.make.spine({
        x: this.x,
        y: this.y + this.groundOffset,
        key: BOSS_SPAWN_SPINE_ASSET.key,
        animationName: BOSS_SPAWN_SPINE_ASSET.animation,
        skinName: BOSS_SPAWN_SPINE_ASSET.skin,
        loop: false,
      }).setDepth(3.6).setScale(0.82);
      const entry = this.spawnEffect.setAnimation(
        0,
        BOSS_SPAWN_SPINE_ASSET.animation,
        false,
      );
      entry.trackTime = Math.max(
        0,
        BOSS_SUMMON_EFFECT_DURATION_MS - summonRemainingMs,
      ) / 1_000;
    } catch (error) {
      console.warn('Boss summon Spine loading failed:', error);
      this.spawnEffect = null;
    }
    this.applyStageVisibility();
    this.scene.time.delayedCall(summonRemainingMs, () => {
      if (this.destroyed) return;
      this.beginBossSpawnMotion(BOSS_SPAWN_ANIMATION_DURATION_MS);
    });
  }

  private beginBossSpawnMotion(remainingMs: number): void {
    this.spawnEffect?.destroy();
    this.spawnEffect = null;
    this.stage = 'spawn';
    try {
      const entry = this.view.setAnimation(0, 'spawn', false);
      entry.trackTime = Math.max(
        0,
        BOSS_SPAWN_ANIMATION_DURATION_MS - remainingMs,
      ) / 1_000;
      this.view.addAnimation(0, 'idle', true, 0);
    } catch {
      this.view.play('idle', true);
    }
    this.applyStageVisibility();
    this.scene.time.delayedCall(Math.max(1, remainingMs), () => {
      if (this.destroyed || !this.view.active) return;
      this.stage = 'active';
      this.view.play('idle', true);
      this.applyStageVisibility();
    });
  }

  private applyStageVisibility(): void {
    this.spawnEffect?.setVisible(this.externallyVisible && this.stage === 'summon');
    this.view.setVisible(this.externallyVisible && this.stage !== 'summon');
    this.telegraph.setVisible(this.externallyVisible && this.stage === 'active');
  }

  destroy(playDeathAnimation = false): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.attackAnimationPriority = false;
    this.spawnEffect?.destroy();
    this.spawnEffect = null;
    this.telegraph.destroy();
    if (!this.view.active) return;
    if (!playDeathAnimation) {
      this.view.destroy();
      return;
    }

    try {
      this.activeHitEyePose = null;
      this.view.clearTrack(1);
      this.view.setColor(0xffffff).play('die', false);
      this.scene.time.delayedCall(700, () => {
        if (this.view.active) this.view.destroy();
      });
    } catch {
      this.view.destroy();
    }
  }
}
