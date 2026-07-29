import { BOSS_SPINE_ASSETS } from '../config/assets';
import type { EnemyPresentation } from '../game/types';

/** Renders a Spine boss while the owning Arcade sprite remains the physics proxy. */
export class BossPresentation implements EnemyPresentation {
  readonly visualHeight: number;

  private readonly view: SpineGameObject;
  private readonly scale: number;
  private readonly groundOffset: number;
  private x: number;
  private y: number;
  private facingLeft = true;
  private destroyed = false;

  static create(
    scene: Phaser.Scene,
    x: number,
    y: number,
    tier: number,
  ): BossPresentation | null {
    if (scene.game.renderer.type !== Phaser.WEBGL) return null;
    try {
      return new BossPresentation(scene, x, y, tier);
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
  ) {
    const config = BOSS_SPINE_ASSETS[(tier - 1) % BOSS_SPINE_ASSETS.length];
    this.scale = config.scale;
    this.visualHeight = config.visualHeight;
    this.groundOffset = this.visualHeight * 0.4;
    this.x = x;
    this.y = y;
    this.view = scene.add.spine(x, y + this.groundOffset, config.key, 'idle', true)
      .setDepth(3.5)
      .setScale(this.scale);
    this.view.setSkinByName(config.skin);
    this.view.setSlotsToSetupPose();
  }

  sync(x: number, y: number, movingLeft: boolean): void {
    if (this.destroyed || !this.view.active) return;
    this.x = x;
    this.y = y;
    this.view.setPosition(x, y + this.groundOffset);
    if (movingLeft === this.facingLeft) return;
    this.facingLeft = movingLeft;
    this.view.setScale(movingLeft ? this.scale : -this.scale, this.scale);
  }

  showDamageFeedback(): void {
    if (this.destroyed || !this.view.active) return;
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

  destroy(playDeathAnimation = false): void {
    if (this.destroyed || !this.view.active) return;
    this.destroyed = true;
    if (!playDeathAnimation) {
      this.view.destroy();
      return;
    }

    try {
      this.view.setColor(0xffffff).play('die', false);
      this.scene.time.delayedCall(700, () => {
        if (this.view.active) this.view.destroy();
      });
    } catch {
      this.view.destroy();
    }
  }
}
