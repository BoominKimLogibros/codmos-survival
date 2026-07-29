import { UI_COLORS } from '../ui/theme';

export interface ExplosionVisualData {
  startX: number;
  startY: number;
  x: number;
  y: number;
  radius: number;
  flightDurationMs: number;
  fuseDurationMs: number;
}

/** Flies a spinning bomb from its owner to the target, then presents the impact locally. */
export class ExplosionPresentation {
  static play(
    scene: Phaser.Scene,
    data: ExplosionVisualData,
    onImpact?: () => void,
  ): void {
    const startX = Number.isFinite(data.startX) ? data.startX : data.x;
    const startY = Number.isFinite(data.startY) ? data.startY : data.y;
    const duration = Phaser.Math.Clamp(data.flightDurationMs || 500, 280, 900);
    const distance = Phaser.Math.Distance.Between(startX, startY, data.x, data.y);
    const arcHeight = Phaser.Math.Clamp(distance * 0.24, 42, 132);
    const bomb = scene.add.image(startX, startY, 'dynamite')
      .setDepth(9)
      .setDisplaySize(34, 34)
      .setAngle(Phaser.Math.Between(-20, 20));
    const bombScale = bomb.scaleX;
    let lastTrailProgress = -1;

    scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: (tween) => {
        const progress = tween.getValue();
        bomb.setPosition(
          Phaser.Math.Linear(startX, data.x, progress),
          Phaser.Math.Linear(startY, data.y, progress) - Math.sin(progress * Math.PI) * arcHeight,
        );
        bomb.setRotation(progress * Math.PI * 4);
        const flightScale = bombScale * (1 + Math.sin(progress * Math.PI) * 0.22);
        bomb.setScale(flightScale);
        if (progress - lastTrailProgress >= 0.09) {
          lastTrailProgress = progress;
          this.createTrailParticle(scene, bomb.x, bomb.y);
        }
      },
      onComplete: () => {
        if (!scene.sys.isActive()) return;
        bomb.setPosition(data.x, data.y).setScale(bombScale);
        this.playFuse(scene, data, bomb, onImpact);
      },
    });
  }

  private static playFuse(
    scene: Phaser.Scene,
    data: ExplosionVisualData,
    bomb: Phaser.GameObjects.Image,
    onImpact?: () => void,
  ): void {
    const fuseDuration = Phaser.Math.Clamp(data.fuseDurationMs || 1000, 250, 3000);
    const fuseRing = scene.add.circle(data.x, data.y, 21, UI_COLORS.primary, 0.08)
      .setStrokeStyle(2, UI_COLORS.white, 0.8)
      .setDepth(8.5);
    const countdown = scene.add.text(data.x, data.y - 30, '1.0', {
      fontFamily: 'Nunito, sans-serif',
      fontSize: '11px',
      fontStyle: '800',
      color: '#ffffff',
      stroke: '#0b0d12',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(9.5);
    const startedAt = scene.time.now;
    const updateCountdown = scene.time.addEvent({
      delay: 50,
      loop: true,
      callback: () => {
        const remaining = Math.max(0, fuseDuration - (scene.time.now - startedAt));
        countdown.setText((remaining / 1000).toFixed(1));
      },
    });
    scene.tweens.add({
      targets: bomb,
      scaleX: bomb.scaleX * 1.14,
      scaleY: bomb.scaleY * 1.14,
      duration: 125,
      yoyo: true,
      repeat: Math.max(0, Math.floor(fuseDuration / 250) - 1),
      ease: 'Sine.easeInOut',
    });
    scene.tweens.add({
      targets: fuseRing,
      scaleX: 1.8,
      scaleY: 1.8,
      alpha: 0.55,
      duration: fuseDuration,
      ease: 'Linear',
    });
    scene.time.delayedCall(fuseDuration, () => {
      updateCountdown.remove(false);
      countdown.destroy();
      fuseRing.destroy();
      if (!scene.sys.isActive() || !bomb.active) return;
      onImpact?.();
      this.playImpact(scene, data, bomb);
    });
  }

  private static playImpact(
    scene: Phaser.Scene,
    data: ExplosionVisualData,
    bomb: Phaser.GameObjects.Image,
  ): void {
    const radius = Phaser.Math.Clamp(data.radius, 20, 220);
    const innerRing = scene.add.circle(data.x, data.y, radius * 0.28, UI_COLORS.white, 0.72)
      .setDepth(6.8);
    const outerRing = scene.add.circle(data.x, data.y, radius * 0.22, UI_COLORS.primary, 0.56)
      .setDepth(6.7);

    scene.tweens.add({
      targets: bomb,
      angle: bomb.angle + 100,
      alpha: 0,
      scaleX: bomb.scaleX * 2.2,
      scaleY: bomb.scaleY * 2.2,
      duration: 460,
      ease: 'Cubic.easeOut',
      onComplete: () => bomb.destroy(),
    });
    scene.tweens.add({
      targets: innerRing,
      alpha: 0,
      scaleX: 3.2,
      scaleY: 3.2,
      duration: 340,
      ease: 'Cubic.easeOut',
      onComplete: () => innerRing.destroy(),
    });
    scene.tweens.add({
      targets: outerRing,
      alpha: 0,
      scaleX: 4.1,
      scaleY: 4.1,
      duration: 520,
      ease: 'Sine.easeOut',
      onComplete: () => outerRing.destroy(),
    });

    for (let index = 0; index < 10; index++) {
      const angle = (index / 10) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.16, 0.16);
      const distance = radius * Phaser.Math.FloatBetween(0.65, 1.15);
      const particle = scene.add.circle(
        data.x,
        data.y,
        Phaser.Math.FloatBetween(2, 4),
        index % 2 === 0 ? UI_COLORS.white : UI_COLORS.primary,
        0.9,
      ).setDepth(7.2);
      scene.tweens.add({
        targets: particle,
        x: data.x + Math.cos(angle) * distance,
        y: data.y + Math.sin(angle) * distance,
        alpha: 0,
        scaleX: 0.25,
        scaleY: 0.25,
        duration: Phaser.Math.Between(360, 560),
        ease: 'Cubic.easeOut',
        onComplete: () => particle.destroy(),
      });
    }
  }

  private static createTrailParticle(scene: Phaser.Scene, x: number, y: number): void {
    const particle = scene.add.circle(x, y, Phaser.Math.Between(2, 4), UI_COLORS.primary, 0.55)
      .setDepth(8);
    scene.tweens.add({
      targets: particle,
      alpha: 0,
      scaleX: 0.2,
      scaleY: 0.2,
      duration: 220,
      ease: 'Cubic.easeOut',
      onComplete: () => particle.destroy(),
    });
  }
}
