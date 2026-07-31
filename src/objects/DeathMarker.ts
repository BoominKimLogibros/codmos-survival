import { UI_COLORS, uiTextStyle } from '../ui/theme';

export const DEATH_MARKER_DROP_DURATION_MS = 520;
export const DEATH_MARKER_FADE_DURATION_MS = 460;

/** One-shot tombstone that drops from the top of the camera and then disappears. */
export class DeathMarker {
  readonly container: Phaser.GameObjects.Container;

  private destroyed = false;
  private readonly onShutdown = (): void => this.destroy();

  constructor(private readonly scene: Phaser.Scene, x: number, y: number) {
    // worldView.top is screen-space y:0 expressed in world coordinates.
    const startY = scene.cameras.main.worldView.top - 56;
    this.container = scene.add.container(x, startY).setDepth(20);

    const shadow = scene.add.ellipse(0, 13, 72, 18, UI_COLORS.shadow, 0.38);
    const stone = scene.add.graphics();
    stone.fillStyle(UI_COLORS.border, 1);
    stone.fillRoundedRect(-27, -47, 54, 62, 18);
    stone.fillStyle(UI_COLORS.surfaceRaised, 1);
    stone.fillRoundedRect(-23, -43, 46, 55, 15);
    stone.fillStyle(UI_COLORS.panelDark, 1);
    stone.fillRoundedRect(-33, 8, 66, 13, 5);
    stone.lineStyle(2, UI_COLORS.gray, 0.65);
    stone.lineBetween(-15, -8, 15, -8);

    const rip = scene.add.text(0, -25, 'RIP', uiTextStyle({
      color: '#d4d7de',
      fontSize: '12px',
      fontStyle: '800',
    })).setOrigin(0.5);

    this.container.add([shadow, stone, rip]);
    scene.tweens.add({
      targets: this.container,
      y,
      duration: DEATH_MARKER_DROP_DURATION_MS,
      ease: 'Bounce.easeOut',
      onComplete: () => {
        if (this.destroyed || !this.container.active) return;
        scene.tweens.add({
          targets: this.container,
          alpha: 0,
          delay: 120,
          duration: DEATH_MARKER_FADE_DURATION_MS,
          ease: 'Cubic.easeIn',
          onComplete: () => this.destroy(),
        });
      },
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown);
    if (!this.container.active) return;
    this.scene.tweens.killTweensOf(this.container);
    this.container.destroy(true);
  }
}
