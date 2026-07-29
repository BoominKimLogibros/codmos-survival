import { createUiButton, createUiPanel, UI_COLORS, uiTextStyle } from './theme';

interface GameOverModalOptions {
  time: number;
  kills: number;
  level: number;
  onRetry: () => void;
  onMenu: () => void;
}

const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 226;

/** Compact in-game defeat modal that leaves the frozen world visible. */
export class GameOverModal {
  private readonly overlay: Phaser.GameObjects.Rectangle;
  private readonly content: Phaser.GameObjects.Container;

  constructor(
    private readonly scene: Phaser.Scene,
    options: GameOverModalOptions,
  ) {
    const { width, height } = scene.scale.gameSize;
    this.overlay = scene.add.rectangle(width / 2, height / 2, width, height, UI_COLORS.page, 0.12)
      .setScrollFactor(0)
      .setDepth(4000)
      .setInteractive();
    this.content = scene.add.container(0, 0).setScrollFactor(0).setDepth(4001);

    const panel = createUiPanel(scene, 0, 0, PANEL_WIDTH, PANEL_HEIGHT, {
      fill: UI_COLORS.panelDark,
      border: UI_COLORS.border,
      borderWidth: 1,
      radius: 16,
      shadow: true,
      shadowOffset: 4,
    });
    const title = scene.add.text(0, -82, '쓰러졌습니다', uiTextStyle({
      fontSize: '23px',
      fontStyle: '800',
    })).setOrigin(0.5);
    const minutes = String(Math.floor(options.time / 60)).padStart(2, '0');
    const seconds = String(options.time % 60).padStart(2, '0');
    const result = scene.add.text(
      0,
      -47,
      `${minutes}:${seconds}  ·  LV ${options.level}  ·  처치 ${options.kills}`,
      uiTextStyle({ color: '#d4d7de', fontSize: '13px', fontStyle: '800' }),
    ).setOrigin(0.5);
    const guide = scene.add.text(0, -15, '방향키로 맵을 둘러볼 수 있습니다.', uiTextStyle({
      color: '#a7acb7',
      fontSize: '12px',
      fontStyle: '600',
    })).setOrigin(0.5);
    const retry = createUiButton(scene, -84, 54, '다시하기', {
      width: 150,
      height: 44,
      fill: UI_COLORS.primary,
      border: UI_COLORS.primary,
      fontSize: '15px',
    });
    const menu = createUiButton(scene, 84, 54, '메뉴로 돌아가기', {
      width: 150,
      height: 44,
      fill: UI_COLORS.surfaceRaised,
      border: UI_COLORS.border,
      fontSize: '13px',
    });
    retry.on('pointerdown', options.onRetry);
    menu.on('pointerdown', options.onMenu);
    this.content.add([panel, title, result, guide, retry, menu]);

    this.layout(scene.scale.gameSize);
    scene.scale.on('resize', this.layout, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off('resize', this.layout, this);
    });
  }

  private layout(gameSize: Phaser.Structs.Size): void {
    const { width, height } = gameSize;
    const scale = Math.min(1, (width - 16) / PANEL_WIDTH, (height - 16) / PANEL_HEIGHT);
    const displayedHeight = PANEL_HEIGHT * scale;
    this.overlay.setPosition(width / 2, height / 2).setDisplaySize(width, height);
    this.content
      .setPosition(width / 2, height - displayedHeight / 2 - 14)
      .setScale(scale);
  }
}
