import { UI_COLORS, uiTextStyle } from '../ui/theme';

/** Static death-site presentation that remains visible while the map is inspected. */
export class DeathMarker {
  readonly container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.container = scene.add.container(x, y - 110).setDepth(20);

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
      duration: 420,
      ease: 'Bounce.easeOut',
    });
  }
}
