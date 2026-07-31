import { UI_COLORS } from '../ui/theme';

export interface MultiAttackVisualTarget {
  active: boolean;
  x: number;
  y: number;
  enemyType?: string;
  knockbackUntil?: number;
  setVelocity?: (x: number, y: number) => unknown;
}

interface MultiAttackPresentationOptions<T extends MultiAttackVisualTarget> {
  targets: T[];
  onImpact: (enemy: T) => void;
}

const CHARGE_DURATION_MS = 850;
const PRESENTATION_DURATION_MS = 2600;
const TARGET_BATCH_SIZE = 80;
const TARGET_BATCH_INTERVAL_MS = 45;
const MAX_TARGET_MARKERS = 48;
const TARGET_MARKER_MARGIN = 100;

/** Long-form multi-attack presentation with a charge-up and chained impacts. */
export class MultiAttackPresentation {
  static readonly durationMs = PRESENTATION_DURATION_MS;

  static play<T extends MultiAttackVisualTarget>(
    scene: Phaser.Scene,
    x: number,
    y: number,
    options: MultiAttackPresentationOptions<T>,
  ): void {
    this.createCentralEffect(scene, x, y);
    this.createTargetSequence(scene, x, y, options);
    scene.cameras.main.shake(320, 0.003);
    scene.time.delayedCall(CHARGE_DURATION_MS, () => {
      scene.cameras.main.flash(260, 255, 255, 255);
      scene.cameras.main.shake(480, 0.008);
    });
  }

  private static createCentralEffect(scene: Phaser.Scene, x: number, y: number): void {
    const glow = scene.add.circle(x, y, 44, UI_COLORS.primary, 0.3)
      .setDepth(24)
      .setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: glow,
      scaleX: 3.2,
      scaleY: 3.2,
      alpha: 0.08,
      duration: 600,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
      onComplete: () => glow.destroy(),
    });

    const sigil = scene.add.graphics().setPosition(x, y).setDepth(25);
    sigil.lineStyle(3, UI_COLORS.white, 0.9);
    sigil.strokeCircle(0, 0, 54);
    sigil.lineStyle(2, UI_COLORS.primary, 0.95);
    sigil.strokeCircle(0, 0, 72);
    for (let index = 0; index < 8; index++) {
      const angle = (Math.PI * 2 * index) / 8;
      sigil.lineBetween(
        Math.cos(angle) * 38,
        Math.sin(angle) * 38,
        Math.cos(angle) * 72,
        Math.sin(angle) * 72,
      );
    }
    sigil.setScale(0.45).setAlpha(0.2);
    scene.tweens.add({
      targets: sigil,
      angle: 360,
      scaleX: 1.65,
      scaleY: 1.65,
      alpha: { from: 0.2, to: 0 },
      duration: 2300,
      ease: 'Cubic.easeOut',
      onComplete: () => sigil.destroy(),
    });

    for (let index = 0; index < 12; index++) {
      const angle = (Math.PI * 2 * index) / 12;
      const ray = scene.add.rectangle(x, y, 210, 5, UI_COLORS.white, 0.34)
        .setOrigin(0, 0.5)
        .setRotation(angle)
        .setScale(0, 1)
        .setDepth(23)
        .setBlendMode(Phaser.BlendModes.ADD);
      scene.tweens.add({
        targets: ray,
        scaleX: 1.75,
        alpha: 0,
        delay: index * 25,
        duration: 1100,
        ease: 'Cubic.easeOut',
        onComplete: () => ray.destroy(),
      });
    }

    for (let index = 0; index < 4; index++) {
      const ring = scene.add.circle(x, y, 36)
        .setStrokeStyle(index % 2 === 0 ? 5 : 3, index % 2 === 0
          ? UI_COLORS.primary
          : UI_COLORS.white, 0.9)
        .setDepth(26)
        .setBlendMode(Phaser.BlendModes.ADD);
      scene.tweens.add({
        targets: ring,
        scaleX: 12 + index * 1.8,
        scaleY: 12 + index * 1.8,
        alpha: 0,
        delay: 180 + index * 220,
        duration: 1250,
        ease: 'Cubic.easeOut',
        onComplete: () => ring.destroy(),
      });
    }

    for (let index = 0; index < 36; index++) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(150, 430);
      const particle = scene.add.circle(
        x,
        y,
        Phaser.Math.Between(2, 5),
        index % 3 === 0 ? UI_COLORS.white : UI_COLORS.primary,
        0.9,
      ).setDepth(29).setBlendMode(Phaser.BlendModes.ADD);
      scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        scaleX: 0.15,
        scaleY: 0.15,
        alpha: 0,
        delay: Phaser.Math.Between(160, 620),
        duration: Phaser.Math.Between(700, 1250),
        ease: 'Cubic.easeOut',
        onComplete: () => particle.destroy(),
      });
    }

    if (scene.game.renderer.type !== Phaser.WEBGL) return;
    try {
      const spine = scene.add.spine(
        x,
        y + 108,
        'runeMultiAttack',
        'animation',
        true,
      ).setDepth(30).setScale(0.5);
      scene.time.delayedCall(PRESENTATION_DURATION_MS, () => {
        if (spine.active) spine.destroy();
      });
    } catch (error) {
      console.warn('Multi-attack Spine effect failed, using layered fallback:', error);
    }
  }

  private static createTargetSequence<T extends MultiAttackVisualTarget>(
    scene: Phaser.Scene,
    originX: number,
    originY: number,
    options: MultiAttackPresentationOptions<T>,
  ): void {
    const targets = [...options.targets].sort((left, right) => (
      Phaser.Math.Distance.Squared(originX, originY, left.x, left.y) -
      Phaser.Math.Distance.Squared(originX, originY, right.x, right.y)
    ));
    const batchCount = Math.ceil(targets.length / TARGET_BATCH_SIZE);
    const sequenceEnd = CHARGE_DURATION_MS + batchCount * TARGET_BATCH_INTERVAL_MS + 300;
    const worldView = scene.cameras.main.worldView;
    const visualTargets = new Set(targets.filter((enemy) => (
      enemy.x >= worldView.x - TARGET_MARKER_MARGIN &&
      enemy.x <= worldView.right + TARGET_MARKER_MARGIN &&
      enemy.y >= worldView.y - TARGET_MARKER_MARGIN &&
      enemy.y <= worldView.bottom + TARGET_MARKER_MARGIN
    )).slice(0, MAX_TARGET_MARKERS));
    const markers = new Map<T, Phaser.GameObjects.Arc>();

    targets.forEach((enemy) => {
      enemy.setVelocity?.(0, 0);
      enemy.knockbackUntil = scene.time.now + Math.max(sequenceEnd, PRESENTATION_DURATION_MS);
      if (!visualTargets.has(enemy)) return;

      const marker = scene.add.circle(enemy.x, enemy.y, 24)
        .setStrokeStyle(2, UI_COLORS.white, 0.85)
        .setDepth(27)
        .setScale(2.1)
        .setAlpha(0);
      markers.set(enemy, marker);
      scene.tweens.add({
        targets: marker,
        scaleX: 0.8,
        scaleY: 0.8,
        alpha: 0.9,
        delay: Phaser.Math.Between(0, 220),
        duration: 520,
        ease: 'Cubic.easeIn',
      });
    });

    let cursor = 0;
    const applyNextBatch = () => {
      if (!scene.sys.isActive()) return;
      const batch = targets.slice(cursor, cursor + TARGET_BATCH_SIZE);
      batch.forEach((enemy, index) => {
        const marker = markers.get(enemy);
        marker?.destroy();
        markers.delete(enemy);
        if (!enemy.active) return;
        if (visualTargets.has(enemy)) {
          this.createTargetImpact(
            scene,
            enemy.x,
            enemy.y,
            cursor + index,
            enemy.enemyType === 'boss',
          );
        }
        options.onImpact(enemy);
      });
      cursor += batch.length;
      if (cursor < targets.length) {
        scene.time.delayedCall(TARGET_BATCH_INTERVAL_MS, applyNextBatch);
        return;
      }
      markers.forEach((marker) => marker.destroy());
      markers.clear();
    };

    if (targets.length > 0) scene.time.delayedCall(CHARGE_DURATION_MS, applyNextBatch);
  }

  private static createTargetImpact(
    scene: Phaser.Scene,
    x: number,
    y: number,
    index: number,
    isBoss: boolean,
  ): void {
    const beam = scene.add.rectangle(
      x,
      y - (isBoss ? 105 : 50),
      isBoss ? 28 : 10,
      isBoss ? 310 : 180,
      UI_COLORS.white,
      isBoss ? 0.96 : 0.82,
    )
      .setDepth(32)
      .setScale(1, 0.08)
      .setBlendMode(Phaser.BlendModes.ADD);
    const blast = scene.add.circle(x, y, isBoss ? 34 : 18, UI_COLORS.primary, 0.75)
      .setDepth(33)
      .setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: beam,
      scaleY: 1.3,
      scaleX: 0.25,
      alpha: 0,
      duration: 340,
      ease: 'Cubic.easeOut',
      onComplete: () => beam.destroy(),
    });
    scene.tweens.add({
      targets: blast,
      scaleX: isBoss ? 5.2 : 3.4,
      scaleY: isBoss ? 5.2 : 3.4,
      alpha: 0,
      duration: 360,
      ease: 'Cubic.easeOut',
      onComplete: () => blast.destroy(),
    });
    if (isBoss) {
      const shockwave = scene.add.ellipse(x, y + 4, 88, 30)
        .setStrokeStyle(6, UI_COLORS.white, 0.9)
        .setDepth(34)
        .setScale(0.4)
        .setBlendMode(Phaser.BlendModes.ADD);
      scene.tweens.add({
        targets: shockwave,
        scaleX: 3.8,
        scaleY: 3.8,
        alpha: 0,
        duration: 460,
        ease: 'Cubic.easeOut',
        onComplete: () => shockwave.destroy(),
      });
      scene.cameras.main.shake(190, 0.012);
      return;
    }
    if (index % 8 === 0) scene.cameras.main.shake(90, 0.0025);
  }
}
