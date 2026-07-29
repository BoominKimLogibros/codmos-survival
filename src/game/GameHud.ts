import { MAX_VISIBLE_HP_GRID_CELLS } from '../config/constants';
import { createUiButton, createUiPanel, createUiToast, UI_COLORS, uiTextStyle } from '../ui/theme';
import { WeaponStatusHud } from '../ui/WeaponStatusHud';
import type { UiButton, UiPanel, UiToast } from '../ui/theme';
import type {
  PlayerStats,
  RunProgress,
  WeaponDefinitions,
  WeaponKey,
  WeaponTooltipData,
} from './types';

interface GameHudOptions {
  getStats: () => PlayerStats;
  getProgress: () => RunProgress;
  getWeapons: () => WeaponDefinitions;
  getWeaponTooltip: (key: WeaponKey) => WeaponTooltipData;
  canOpenExit: () => boolean;
  onExitOpened: () => void;
  onExitClosed: () => void;
  onExitConfirmed: () => void;
}

interface HudLayout {
  x: number;
  y: number;
  panelWidth: number;
  panelHeight: number;
  barWidth: number;
  barLeft: number;
  hpY: number;
  xpY: number;
  leftX: number;
  rightX: number;
  dividerLeft: number;
  dividerRight: number;
}

/** Owns all gameplay HUD objects, responsive layout, toast, and exit modal. */
export class GameHud {
  private layout: HudLayout;
  private readonly panel: UiPanel;
  private readonly dividers: Phaser.GameObjects.Graphics;
  private readonly hpBackground: Phaser.GameObjects.Rectangle;
  private readonly hpBar: Phaser.GameObjects.Rectangle;
  private readonly hpGrid: Phaser.GameObjects.Graphics;
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly xpBackground: Phaser.GameObjects.Rectangle;
  private readonly xpBar: Phaser.GameObjects.Rectangle;
  private readonly levelText: Phaser.GameObjects.Text;
  private readonly timerText: Phaser.GameObjects.Text;
  private readonly killsText: Phaser.GameObjects.Text;
  private readonly exitButton: UiButton;
  private readonly toast: UiToast;
  private readonly weaponStatusHud: WeaponStatusHud;
  private toastTween?: Phaser.Tweens.Tween;
  private exitModal?: Phaser.GameObjects.Container;
  private exitOverlay?: Phaser.GameObjects.Rectangle;
  private hpGridMax = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: GameHudOptions,
  ) {
    const { width, height } = scene.scale.gameSize;
    this.layout = this.calculateLayout(width);
    const hud = this.layout;
    this.panel = createUiPanel(scene, hud.x, hud.y, hud.panelWidth, hud.panelHeight, {
      fill: UI_COLORS.panelDark,
      border: UI_COLORS.border,
      borderWidth: 1,
      radius: 16,
      shadow: true,
    }).setScrollFactor(0).setDepth(99);
    this.dividers = scene.add.graphics().setScrollFactor(0).setDepth(100);
    this.hpBackground = scene.add.rectangle(
      hud.x,
      hud.hpY,
      hud.barWidth,
      18,
      UI_COLORS.panelDeep,
    ).setScrollFactor(0).setDepth(100);
    this.hpBar = scene.add.rectangle(
      hud.barLeft,
      hud.hpY,
      hud.barWidth,
      16,
      UI_COLORS.health,
    ).setOrigin(0, 0.5).setScrollFactor(0).setDepth(101);
    this.hpGrid = scene.add.graphics().setScrollFactor(0).setDepth(102);
    this.hpText = scene.add.text(hud.x, hud.hpY, '100/100', uiTextStyle({
      fontSize: '10px',
      fontStyle: '800',
    })).setOrigin(0.5).setScrollFactor(0).setDepth(103);
    this.xpBackground = scene.add.rectangle(
      hud.x,
      hud.xpY,
      hud.barWidth,
      8,
      UI_COLORS.panelDeep,
    ).setScrollFactor(0).setDepth(100);
    this.xpBar = scene.add.rectangle(
      hud.barLeft,
      hud.xpY,
      1,
      6,
      UI_COLORS.experience,
    ).setOrigin(0, 0.5).setScrollFactor(0).setDepth(101);
    this.levelText = scene.add.text(hud.leftX, hud.y, 'LV 1', uiTextStyle({
      fontSize: '16px',
      fontStyle: '800',
    })).setOrigin(0.5).setScrollFactor(0).setDepth(103);
    this.timerText = scene.add.text(hud.rightX, hud.y - 10, '00:00', uiTextStyle({
      fontSize: '16px',
      fontStyle: '800',
    })).setOrigin(0.5).setScrollFactor(0).setDepth(103);
    this.killsText = scene.add.text(hud.rightX, hud.y + 12, '처치 0', uiTextStyle({
      fontSize: '11px',
      color: '#a7acb7',
      fontStyle: '600',
    })).setOrigin(0.5).setScrollFactor(0).setDepth(103);

    this.exitButton = createUiButton(scene, width - 70, height - 35, '나가기', {
      width: 108,
      height: 42,
      fill: UI_COLORS.surfaceRaised,
      border: UI_COLORS.border,
      fontSize: '14px',
    }).setScrollFactor(0).setDepth(300);
    this.exitButton.on('pointerdown', () => this.openExitModal());
    this.toast = createUiToast(scene, width / 2, height - 98, {
      width: Math.min(420, width - 30),
      fontSize: '15px',
    }).setScrollFactor(0).setDepth(1000);
    this.weaponStatusHud = new WeaponStatusHud(scene, {
      getWeaponKeys: () => this.options.getStats().weapons,
      getWeapons: () => this.options.getWeapons(),
      getWeaponTooltip: (key) => this.options.getWeaponTooltip(key),
    });

    this.drawDividers();
    this.drawHpGrid();
    scene.scale.on('resize', this.handleResize, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off('resize', this.handleResize, this);
    });
  }

  update(): void {
    const stats = this.options.getStats();
    const progress = this.options.getProgress();
    const hpRatio = Math.max(0, stats.hp / stats.maxHp);
    this.hpBar.setDisplaySize(Math.max(0.01, this.layout.barWidth * hpRatio), 16);
    this.hpBar.setFillStyle(UI_COLORS.health);
    this.xpBar.setFillStyle(UI_COLORS.experience);
    this.hpText.setText(`${Math.ceil(stats.hp)}/${stats.maxHp}`);
    this.xpBar.setDisplaySize(
      Math.max(1, this.layout.barWidth * (stats.xp / stats.xpToNext)),
      6,
    );
    this.levelText.setText(`LV ${stats.level}`);
    const minutes = String(Math.floor(progress.gameTime / 60)).padStart(2, '0');
    const seconds = String(progress.gameTime % 60).padStart(2, '0');
    this.timerText.setText(`${minutes}:${seconds}`);
    this.killsText.setText(`처치 ${progress.killCount}`);
    if (this.hpGridMax !== stats.maxHp) this.drawHpGrid();
  }

  refreshWeaponIcons(): void {
    this.weaponStatusHud.refresh();
  }

  showToast(message: string, isError = false): void {
    this.toastTween?.stop();
    this.toast.showMessage(message, isError);
    this.toastTween = this.scene.tweens.add({
      targets: this.toast,
      alpha: 0,
      delay: 1600,
      duration: 300,
      ease: 'Power2',
    });
  }

  enterGameOverState(): void {
    this.weaponStatusHud.hideTooltip();
    this.exitButton.setEnabled(false);
  }

  toggleExitModal(): void {
    if (this.exitModal) this.closeExitModal();
    else this.openExitModal();
  }

  private calculateLayout(width: number): HudLayout {
    const panelWidth = Math.min(580, width - 24);
    const x = width / 2;
    const y = 46;
    const sideWidth = panelWidth < 480 ? 68 : 92;
    const sectionGap = 14;
    const padding = 14;
    const barWidth = Math.max(
      132,
      panelWidth - sideWidth * 2 - sectionGap * 2 - padding * 2,
    );
    return {
      x,
      y,
      panelWidth,
      panelHeight: 72,
      barWidth,
      barLeft: x - barWidth / 2,
      hpY: y - 10,
      xpY: y + 13,
      leftX: x - panelWidth / 2 + padding + sideWidth / 2,
      rightX: x + panelWidth / 2 - padding - sideWidth / 2,
      dividerLeft: x - barWidth / 2 - sectionGap / 2,
      dividerRight: x + barWidth / 2 + sectionGap / 2,
    };
  }

  private openExitModal(): void {
    if (this.exitModal || !this.options.canOpenExit()) return;
    this.weaponStatusHud.hideTooltip();
    this.options.onExitOpened();
    const { width, height } = this.scene.scale.gameSize;
    this.exitModal = this.scene.add.container(width / 2, height / 2)
      .setScrollFactor(0)
      .setDepth(5000);
    this.exitOverlay = this.scene.add.rectangle(0, 0, width, height, 0x000000, 0.76)
      .setInteractive();
    const modalWidth = Math.min(400, width - 20);
    const compact = modalWidth < 390;
    const panel = createUiPanel(this.scene, 0, 0, modalWidth, 230, {
      fill: UI_COLORS.panel,
      border: UI_COLORS.border,
      borderWidth: 1,
      radius: 18,
    });
    const title = this.scene.add.text(0, -68, '게임에서 나갈까요?', uiTextStyle({
      fontSize: '24px',
      fontStyle: '800',
    })).setOrigin(0.5);
    const description = this.scene.add.text(
      0,
      -25,
      '현재 진행 상황은 프로필에 자동 저장됩니다.',
      uiTextStyle({ fontSize: '13px', color: '#a7acb7', fontStyle: '600' }),
    ).setOrigin(0.5);
    const cancel = createUiButton(this.scene, compact ? -80 : -90, 58, '계속하기', {
      width: compact ? 130 : 142,
      height: 44,
      fill: UI_COLORS.primary,
      border: UI_COLORS.primary,
    });
    const exit = createUiButton(this.scene, compact ? 80 : 90, 58, '나가기', {
      width: compact ? 130 : 142,
      height: 44,
      fill: UI_COLORS.surfaceRaised,
      border: UI_COLORS.border,
    });
    cancel.on('pointerdown', () => this.closeExitModal());
    exit.on('pointerdown', () => this.options.onExitConfirmed());
    this.exitModal.add([this.exitOverlay, panel, title, description, cancel, exit]);
  }

  private closeExitModal(): void {
    if (!this.exitModal) return;
    this.exitModal.destroy(true);
    this.exitModal = undefined;
    this.exitOverlay = undefined;
    this.options.onExitClosed();
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.weaponStatusHud.hideTooltip();
    const { width, height } = gameSize;
    this.layout = this.calculateLayout(width);
    const hud = this.layout;
    this.panel.setPosition(hud.x, hud.y).resizeUiPanel(hud.panelWidth, hud.panelHeight);
    this.hpBackground.setPosition(hud.x, hud.hpY).setDisplaySize(hud.barWidth, 18);
    this.hpBar.setPosition(hud.barLeft, hud.hpY);
    this.hpText.setPosition(hud.x, hud.hpY);
    this.xpBackground.setPosition(hud.x, hud.xpY).setDisplaySize(hud.barWidth, 8);
    this.xpBar.setPosition(hud.barLeft, hud.xpY);
    this.levelText.setPosition(hud.leftX, hud.y);
    this.timerText.setPosition(hud.rightX, hud.y - 10);
    this.killsText.setPosition(hud.rightX, hud.y + 12);
    this.exitButton.setPosition(width - 70, height - 35);
    this.toast.setPosition(width / 2, height - 98);
    if (this.exitModal && this.exitOverlay) {
      this.exitModal.setPosition(width / 2, height / 2);
      this.exitOverlay.setDisplaySize(width, height);
    }
    this.drawDividers();
    this.drawHpGrid();
    this.update();

  }

  private drawDividers(): void {
    const hud = this.layout;
    this.dividers.clear();
    this.dividers.lineStyle(1, UI_COLORS.border, 0.9);
    this.dividers.lineBetween(hud.dividerLeft, hud.y - 22, hud.dividerLeft, hud.y + 22);
    this.dividers.lineBetween(hud.dividerRight, hud.y - 22, hud.dividerRight, hud.y + 22);
  }

  private drawHpGrid(): void {
    const maxHp = Math.max(1, this.options.getStats().maxHp);
    const segmentCount = Math.ceil(maxHp / 100);
    const segmentStep = Math.max(
      1,
      Math.ceil(segmentCount / MAX_VISIBLE_HP_GRID_CELLS),
    );
    this.hpGrid.clear();
    this.hpGrid.lineStyle(1, 0xffffff, 0.55);
    for (let hp = 100 * segmentStep; hp < maxHp; hp += 100 * segmentStep) {
      const x = this.layout.barLeft + this.layout.barWidth * (hp / maxHp);
      this.hpGrid.lineBetween(x, this.layout.hpY - 8, x, this.layout.hpY + 8);
    }
    this.hpGridMax = maxHp;
  }
}
