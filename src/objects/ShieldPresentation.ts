import { UI_COLORS } from '../ui/theme';

type ShieldEffect = SpineGameObject | Phaser.GameObjects.Arc;

/** Persistent rune shield that follows a player and reacts when a charge is spent. */
export class ShieldPresentation {
  private readonly effect: ShieldEffect;
  private readonly isSpineEffect: boolean;
  private currentCharges: number;
  private destroyed = false;
  private x: number;
  private y: number;

  constructor(
    private readonly scene: Phaser.Scene,
    x: number,
    y: number,
    charges: number,
  ) {
    this.currentCharges = charges;
    this.x = x;
    this.y = y;
    this.effect = this.createEffect(x, y);
    this.isSpineEffect = !(this.effect instanceof Phaser.GameObjects.Arc);
    scene.tweens.add({
      targets: this.effect,
      alpha: { from: this.isSpineEffect ? 0.84 : 0.5, to: 1 },
      duration: 780,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  get charges(): number {
    return this.currentCharges;
  }

  sync(x: number, y: number, charges: number): void {
    if (this.destroyed) return;
    this.setPosition(x, y);
    if (charges < this.currentCharges) this.showBlockFeedback(x, y);
    this.currentCharges = charges;
  }

  setPosition(x: number, y: number): void {
    if (this.destroyed) return;
    this.x = x;
    this.y = y;
    this.effect.setPosition(
      x,
      y + (this.isSpineEffect ? 18 : 0),
    );
  }

  destroy(depleted = false): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.tweens.killTweensOf(this.effect);
    this.effect.destroy();
    if (depleted && this.scene.sys.isActive()) this.showBreakFeedback(this.x, this.y);
  }

  private createEffect(x: number, y: number): ShieldEffect {
    if (this.scene.game.renderer.type === Phaser.WEBGL) {
      try {
        return this.scene.add.spine(
          x,
          y + 18,
          'runeShield',
          'animation',
          true,
        ).setDepth(6).setScale(0.42).setAlpha(1);
      } catch (error) {
        console.warn('Rune shield Spine effect failed, using fallback:', error);
      }
    }
    return this.scene.add.circle(x, y, 48, UI_COLORS.primary, 0.12)
      .setStrokeStyle(2, UI_COLORS.white, 0.85)
      .setDepth(6)
      .setBlendMode(Phaser.BlendModes.ADD);
  }

  private showBlockFeedback(x: number, y: number): void {
    const flash = this.scene.add.circle(x, y, 50, UI_COLORS.white, 0.24)
      .setStrokeStyle(4, UI_COLORS.primary, 1)
      .setDepth(32)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: flash,
      scaleX: 1.45,
      scaleY: 1.45,
      alpha: 0,
      duration: 240,
      ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  private showBreakFeedback(x: number, y: number): void {
    for (let index = 0; index < 2; index++) {
      const ring = this.scene.add.circle(x, y, 48)
        .setStrokeStyle(index === 0 ? 5 : 2, index === 0 ? UI_COLORS.white : UI_COLORS.primary, 0.92)
        .setDepth(33)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets: ring,
        scaleX: 1.8 + index * 0.35,
        scaleY: 1.8 + index * 0.35,
        alpha: 0,
        delay: index * 55,
        duration: 360,
        ease: 'Cubic.easeOut',
        onComplete: () => ring.destroy(),
      });
    }
  }
}
