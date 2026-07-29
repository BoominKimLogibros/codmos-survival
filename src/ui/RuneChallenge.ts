import {
  RUNE_RETRY_DELAY_MS,
  RUNE_SEQUENCE_LENGTH,
} from '../config/constants';
import type { RuneType } from '../game/types';
import { createUiPanel, UI_COLORS, uiTextStyle, type UiPanel } from './theme';

type RuneDirection = 'left' | 'right' | 'up' | 'down';

interface RuneChallengeOptions {
  runeType: RuneType;
  onSuccess: () => void;
}

interface DirectionIcon {
  button: Phaser.GameObjects.Container;
  background: UiPanel;
  image: Phaser.GameObjects.Image;
}

const PANEL_WIDTH = 440;
const PANEL_HEIGHT = 252;

const DIRECTIONS: RuneDirection[] = ['left', 'right', 'up', 'down'];
const DIRECTION_FRAMES: Record<RuneDirection, string> = {
  left: 'img_directionkey_L',
  right: 'img_directionkey_R',
  up: 'img_directionkey_Up',
  down: 'img_directionkey_Down',
};

const KEY_DIRECTIONS: Record<string, RuneDirection | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** Paused-game direction sequence challenge shown after collecting a rune. */
export class RuneChallenge {
  private readonly overlay: Phaser.GameObjects.Rectangle;
  private readonly content: Phaser.GameObjects.Container;
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly icons: DirectionIcon[] = [];
  private sequence: RuneDirection[] = [];
  private currentIndex = 0;
  private acceptingInput = true;
  private destroyed = false;
  private retryTimer?: Phaser.Time.TimerEvent;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: RuneChallengeOptions,
  ) {
    const { width, height } = scene.scale.gameSize;
    this.overlay = scene.add.rectangle(
      width / 2,
      height / 2,
      width,
      height,
      UI_COLORS.page,
      0.42,
    ).setScrollFactor(0).setDepth(4500).setInteractive();
    this.content = scene.add.container(0, 0).setScrollFactor(0).setDepth(4501);

    const panel = createUiPanel(scene, 0, 0, PANEL_WIDTH, PANEL_HEIGHT, {
      fill: UI_COLORS.panelDark,
      border: UI_COLORS.primary,
      borderWidth: 2,
      radius: 18,
      shadow: true,
      shadowOffset: 4,
    });
    const title = scene.add.text(0, -96, this.getTitle(), uiTextStyle({
      fontSize: '22px',
      fontStyle: '800',
    })).setOrigin(0.5);
    const guide = scene.add.text(
      0,
      -65,
      '표시된 순서대로 방향키를 입력하세요.',
      uiTextStyle({
        color: '#d4d7de',
        fontSize: '13px',
        fontStyle: '700',
      }),
    ).setOrigin(0.5);
    this.statusText = scene.add.text(0, 91, '', uiTextStyle({
      color: '#a7acb7',
      fontSize: '13px',
      fontStyle: '800',
    })).setOrigin(0.5);
    this.content.add([panel, title, guide, this.statusText]);

    this.resetSequence();
    this.layout(scene.scale.gameSize);
    scene.scale.on('resize', this.layout, this);
    scene.input.keyboard?.on('keydown', this.handleKeyDown, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.retryTimer?.remove(false);
    this.scene.scale.off('resize', this.layout, this);
    this.scene.input.keyboard?.off('keydown', this.handleKeyDown, this);
    this.overlay.destroy();
    this.content.destroy(true);
  }

  private getTitle(): string {
    return this.options.runeType === 'multiAttack' ? '다중 공격 룬' : '보호막 룬';
  }

  private createSequence(): RuneDirection[] {
    return Array.from(
      { length: RUNE_SEQUENCE_LENGTH },
      () => Phaser.Utils.Array.GetRandom(DIRECTIONS),
    );
  }

  private resetSequence(): void {
    this.icons.forEach(({ button }) => button.destroy(true));
    this.icons.length = 0;
    this.sequence = this.createSequence();
    this.currentIndex = 0;
    this.acceptingInput = true;
    this.statusText.setText('키보드 또는 아이콘을 눌러 입력할 수 있습니다.');

    const spacing = 82;
    const startX = -((this.sequence.length - 1) * spacing) / 2;
    this.sequence.forEach((direction, index) => {
      const x = startX + index * spacing;
      const button = this.scene.add.container(x, 20)
        .setScrollFactor(0)
        .setSize(66, 66)
        .setInteractive({
          hitArea: new Phaser.Geom.Rectangle(0, 0, 66, 66),
          hitAreaCallback: Phaser.Geom.Rectangle.Contains,
          useHandCursor: true,
        });
      const background = createUiPanel(this.scene, 0, 0, 66, 66, {
        fill: UI_COLORS.surfaceRaised,
        border: index === 0 ? UI_COLORS.primary : UI_COLORS.border,
        borderWidth: 2,
        radius: 14,
      });
      const image = this.scene.add.image(
        0,
        0,
        'runeKeyAtlas',
        DIRECTION_FRAMES[direction],
      ).setDisplaySize(50, 50);
      button.add([background, image]);
      button.on('pointerdown', () => this.submit(direction));
      this.content.add(button);
      this.icons.push({ button, background, image });
    });
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const direction = KEY_DIRECTIONS[event.key];
    if (!direction) return;
    event.preventDefault();
    this.submit(direction);
  }

  private submit(direction: RuneDirection): void {
    if (!this.acceptingInput || this.destroyed) return;
    if (direction !== this.sequence[this.currentIndex]) {
      this.fail();
      return;
    }

    const completedIcon = this.icons[this.currentIndex];
    completedIcon.background.redrawUiPanel({
      fill: UI_COLORS.primary,
      border: UI_COLORS.primary,
    });
    completedIcon.image.setAlpha(0.72);
    this.currentIndex++;

    if (this.currentIndex >= this.sequence.length) {
      this.succeed();
      return;
    }
    this.icons[this.currentIndex].background.redrawUiPanel({
      border: UI_COLORS.primary,
    });
    this.statusText.setText(`${this.currentIndex} / ${this.sequence.length} 입력 완료`);
  }

  private fail(): void {
    this.acceptingInput = false;
    this.icons.forEach(({ background }) => background.redrawUiPanel({
      fill: UI_COLORS.panel,
      border: UI_COLORS.gray,
    }));
    const retryAt = this.scene.time.now + RUNE_RETRY_DELAY_MS;
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((retryAt - this.scene.time.now) / 1000));
      this.statusText.setText(`입력 실패 · ${remaining}초 후 다시 시도합니다.`);
    };
    updateCountdown();
    this.retryTimer = this.scene.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        updateCountdown();
        if (this.scene.time.now < retryAt) return;
        this.retryTimer?.remove(false);
        this.retryTimer = undefined;
        this.resetSequence();
      },
    });
  }

  private succeed(): void {
    this.acceptingInput = false;
    this.statusText.setText('룬 각인 성공!');
    this.scene.time.delayedCall(220, () => {
      if (this.destroyed) return;
      this.destroy();
      this.options.onSuccess();
    });
  }

  private layout(gameSize: Phaser.Structs.Size): void {
    const { width, height } = gameSize;
    const scale = Math.min(1, (width - 20) / PANEL_WIDTH, (height - 20) / PANEL_HEIGHT);
    this.overlay.setPosition(width / 2, height / 2).setDisplaySize(width, height);
    this.content.setPosition(width / 2, height / 2).setScale(scale);
  }
}
