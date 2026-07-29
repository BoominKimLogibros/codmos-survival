import type {
  WeaponDefinitions,
  WeaponKey,
  WeaponTooltipData,
} from '../game/types';
import { WeaponTooltip } from './WeaponTooltip';
import { createUiPanel, UI_COLORS, uiTextStyle } from './theme';
import type { UiPanel } from './theme';

interface WeaponStatusHudOptions {
  getWeaponKeys: () => WeaponKey[];
  getWeapons: () => WeaponDefinitions;
  getWeaponTooltip: (key: WeaponKey) => WeaponTooltipData;
}

interface WeaponIconSlot {
  background: UiPanel;
  icon: Phaser.GameObjects.Image;
  level: Phaser.GameObjects.Text;
}

/** Shared lower-left skill HUD used by both single-player and LAN clients. */
export class WeaponStatusHud {
  private readonly tooltip: WeaponTooltip;
  private icons: WeaponIconSlot[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: WeaponStatusHudOptions,
  ) {
    this.tooltip = new WeaponTooltip(scene);
    this.refresh();
    scene.scale.on('resize', this.handleResize, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  refresh(): void {
    this.tooltip.hide();
    this.icons.forEach(({ background, icon, level }) => {
      background.destroy();
      icon.destroy();
      level.destroy();
    });
    this.icons = [];

    const definitions = this.options.getWeapons();
    const startY = this.scene.scale.gameSize.height - 40;
    this.options.getWeaponKeys().forEach((key, index) => {
      const definition = definitions[key];
      if (!definition) return;
      const x = this.iconX(index);
      const background = createUiPanel(this.scene, x, startY, 42, 42, {
        fill: UI_COLORS.panelDark,
        border: UI_COLORS.border,
        borderWidth: 2,
        radius: 12,
        shadow: true,
        shadowOffset: 3,
      }).setScrollFactor(0).setDepth(100);
      background.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(-21, -21, 42, 42),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
      background.on('pointerover', () => {
        background.redrawUiPanel({ border: UI_COLORS.primary });
        this.tooltip.show(this.options.getWeaponTooltip(key), background.x, background.y - 21);
      });
      background.on('pointerout', () => {
        background.redrawUiPanel({ border: UI_COLORS.border });
        this.tooltip.hide();
      });
      const icon = this.scene.add.image(x, startY - 2, definition.icon)
        .setScrollFactor(0)
        .setDepth(101)
        .setDisplaySize(26, 26);
      const level = this.scene.add.text(x - 15, startY + 11, `Lv${definition.level}`, uiTextStyle({
        fontSize: '8px',
        color: '#d4d7de',
        fontStyle: '800',
      })).setScrollFactor(0).setDepth(102);
      this.icons.push({ background, icon, level });
    });
  }

  hideTooltip(): void {
    this.tooltip.hide();
  }

  destroy(): void {
    this.scene.scale.off('resize', this.handleResize, this);
    this.tooltip.hide();
    this.icons.forEach(({ background, icon, level }) => {
      background.destroy();
      icon.destroy();
      level.destroy();
    });
    this.icons = [];
  }

  private iconX(index: number): number {
    return 16 + index * 48 + 20;
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.tooltip.hide();
    const startY = gameSize.height - 40;
    this.icons.forEach(({ background, icon, level }, index) => {
      const x = this.iconX(index);
      background.setPosition(x, startY);
      icon.setPosition(x, startY - 2);
      level.setPosition(x - 15, startY + 11);
    });
  }
}
