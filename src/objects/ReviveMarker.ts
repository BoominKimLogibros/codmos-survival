import { UI_COLORS, uiTextStyle } from '../ui/theme';

/** Compact world-space tombstone with a host-authoritative resurrection gauge. */
export class ReviveMarker {
  readonly container: Phaser.GameObjects.Container;

  private readonly gaugeFill: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    playerName: string,
  ) {
    this.container = scene.add.container(x, y).setDepth(17);

    const shadow = scene.add.ellipse(0, 8, 50, 15, UI_COLORS.shadow, 0.28);
    const stone = scene.add.graphics();
    stone.fillStyle(UI_COLORS.panelDark, 1);
    stone.fillRoundedRect(-19, -37, 38, 43, 11);
    stone.fillStyle(UI_COLORS.border, 1);
    stone.fillRoundedRect(-23, 3, 46, 8, 3);
    stone.lineStyle(3, UI_COLORS.grayLight, 0.88);
    stone.lineBetween(0, -28, 0, -10);
    stone.lineBetween(-7, -20, 7, -20);

    const gaugeBackground = scene.add.rectangle(0, 23, 76, 9, UI_COLORS.panelDeep, 0.96);
    gaugeBackground.setStrokeStyle(1, UI_COLORS.border);
    this.gaugeFill = scene.add.rectangle(-37, 23, 1, 7, UI_COLORS.primary, 1)
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.label = scene.add.text(0, 37, `${playerName} · 10초간 기도해 부활`, uiTextStyle({
      fontSize: '9px',
      color: '#d4d7de',
      fontStyle: '800',
      stroke: '#0b0d12',
      strokeThickness: 2,
    })).setOrigin(0.5, 0);

    this.container.add([shadow, stone, gaugeBackground, this.gaugeFill, this.label]);
  }

  setProgress(ratio: number, charging: boolean, playerName: string): void {
    const normalized = Phaser.Math.Clamp(ratio, 0, 1);
    this.gaugeFill
      .setDisplaySize(Math.max(1, 74 * normalized), 7)
      .setVisible(normalized > 0);
    this.label.setText(charging
      ? `${playerName} · 기도 중 ${Math.floor(normalized * 100)}%`
      : `${playerName} · 10초간 기도해 부활`);
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
