import { createUiPanel, UI_COLORS, uiTextStyle } from '../ui/theme';

/** Small world-space badge that follows the player while a rune shield is active. */
export class ShieldChargeCounter {
  private readonly container: Phaser.GameObjects.Container;
  private readonly label: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number, charges: number) {
    this.container = scene.add.container(x, y).setDepth(31);
    const background = createUiPanel(scene, 0, 0, 62, 28, {
      fill: UI_COLORS.panelDeep,
      border: UI_COLORS.primary,
      borderWidth: 2,
      radius: 12,
    });
    this.label = scene.add.text(0, -1, '', uiTextStyle({
      fontSize: '12px',
      fontStyle: '800',
    })).setOrigin(0.5);
    this.container.add([background, this.label]);
    this.setCharges(charges);
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x + 45, y - 34);
  }

  setCharges(charges: number): void {
    this.label.setText(`방어 ${charges}`);
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
