import type { WeaponTooltipData } from '../game/types';
import { createUiPanel, UI_COLORS, uiTextStyle } from './theme';

const TOOLTIP_MAX_WIDTH = 280;
const TOOLTIP_MARGIN = 10;
const TOOLTIP_GAP = 12;
const STAT_ROW_HEIGHT = 21;

/** Displays current, combat-backed weapon values above a HUD weapon icon. */
export class WeaponTooltip {
  private container?: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene) {}

  show(data: WeaponTooltipData, anchorX: number, anchorY: number): void {
    this.hide();

    const { width: gameWidth, height: gameHeight } = this.scene.scale.gameSize;
    const width = Math.min(TOOLTIP_MAX_WIDTH, Math.max(160, gameWidth - TOOLTIP_MARGIN * 2));
    const height = 94 + data.stats.length * STAT_ROW_HEIGHT;
    const minX = width / 2 + TOOLTIP_MARGIN;
    const maxX = gameWidth - width / 2 - TOOLTIP_MARGIN;
    const x = maxX >= minX
      ? Phaser.Math.Clamp(anchorX, minX, maxX)
      : gameWidth / 2;
    const preferredY = anchorY - TOOLTIP_GAP - height / 2;
    const minY = height / 2 + TOOLTIP_MARGIN;
    const maxY = gameHeight - height / 2 - TOOLTIP_MARGIN;
    const y = maxY >= minY
      ? Phaser.Math.Clamp(preferredY, minY, maxY)
      : gameHeight / 2;
    const top = -height / 2;
    const horizontalPadding = 16;

    const container = this.scene.add.container(x, y)
      .setScrollFactor(0)
      .setDepth(2000);
    const panel = createUiPanel(this.scene, 0, 0, width, height, {
      fill: UI_COLORS.panelDark,
      border: UI_COLORS.border,
      borderWidth: 1,
      radius: 14,
      shadow: true,
      shadowOffset: 4,
    });
    const title = this.scene.add.text(
      -width / 2 + horizontalPadding,
      top + 15,
      data.name,
      uiTextStyle({ fontSize: '16px', fontStyle: '800' }),
    ).setOrigin(0, 0);
    const level = this.scene.add.text(
      width / 2 - horizontalPadding,
      top + 17,
      `Lv ${data.level} / ${data.maxLevel ?? '∞'}`,
      uiTextStyle({ color: '#d4d7de', fontSize: '11px', fontStyle: '800' }),
    ).setOrigin(1, 0);
    const description = this.scene.add.text(
      -width / 2 + horizontalPadding,
      top + 40,
      data.description,
      uiTextStyle({
        color: '#a7acb7',
        fontSize: '12px',
        fontStyle: '600',
        wordWrap: { width: width - horizontalPadding * 2 },
      }),
    ).setOrigin(0, 0);
    const divider = this.scene.add.rectangle(
      0,
      top + 68,
      width - horizontalPadding * 2,
      1,
      UI_COLORS.border,
    );

    container.add([panel, title, level, description, divider]);
    data.stats.forEach((stat, index) => {
      const rowY = top + 80 + index * STAT_ROW_HEIGHT;
      const label = this.scene.add.text(
        -width / 2 + horizontalPadding,
        rowY,
        stat.label,
        uiTextStyle({ color: '#a7acb7', fontSize: '12px', fontStyle: '600' }),
      ).setOrigin(0, 0);
      const value = this.scene.add.text(
        width / 2 - horizontalPadding,
        rowY,
        stat.value,
        uiTextStyle({ fontSize: '12px', fontStyle: '800' }),
      ).setOrigin(1, 0);
      container.add([label, value]);
    });

    this.container = container;
  }

  hide(): void {
    this.container?.destroy(true);
    this.container = undefined;
  }
}
