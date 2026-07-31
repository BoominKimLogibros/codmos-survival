import type { RuneType } from '../game/types';

export const RUNE_ACTIVATION_FADE_MS = 90;
export const RUNE_ACTIVATION_HOLD_MS = 420;
export const RUNE_ACTIVATION_TOTAL_MS = RUNE_ACTIVATION_FADE_MS * 2 + RUNE_ACTIVATION_HOLD_MS;

export function runeActivationTextureKey(
  runeType: RuneType,
): 'runeAttackActivation' | 'runeDefenseActivation' {
  return runeType === 'multiAttack' ? 'runeAttackActivation' : 'runeDefenseActivation';
}

export class RuneActivationPresentation {
  static play(scene: Phaser.Scene, runeType: RuneType): void {
    const textureKey = runeActivationTextureKey(runeType);
    const accent = runeType === 'multiAttack' ? 0xff3d3d : 0x1ed1de;
    const { width, height } = scene.scale.gameSize;
    const backdrop = scene.add.circle(width / 2, height / 2, 84, 0x090a0d, 0.72)
      .setStrokeStyle(3, accent, 0.92)
      .setScrollFactor(0)
      .setDepth(11999)
      .setAlpha(0);
    const icon = scene.add.image(width / 2, height / 2, textureKey)
      .setScrollFactor(0)
      .setDepth(12000)
      .setAlpha(0);

    let cleaned = false;
    const reposition = (gameSize: Phaser.Structs.Size): void => {
      const centerX = gameSize.width / 2;
      const centerY = gameSize.height / 2;
      backdrop.setPosition(centerX, centerY);
      icon.setPosition(centerX, centerY);
    };
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      scene.scale.off('resize', reposition);
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      if (backdrop.active) backdrop.destroy();
      if (icon.active) icon.destroy();
    };

    scene.scale.on('resize', reposition);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    scene.tweens.add({
      targets: [backdrop, icon],
      alpha: 1,
      duration: RUNE_ACTIVATION_FADE_MS,
      hold: RUNE_ACTIVATION_HOLD_MS,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: cleanup,
    });
  }
}
