import { getProfile } from '../services/profileService';
import { createUiButton, createUiPanel, UI_COLORS, uiTextStyle } from '../ui/theme';

interface GameOverSceneData {
  time?: number;
  kills?: number;
  level?: number;
  profileId?: string | null;
}

export class GameOverScene extends Phaser.Scene {
  private survivalTime = 0;
  private kills = 0;
  private level = 1;
  private profileId: string | null = null;
  private gameOverBackground!: Phaser.GameObjects.Rectangle;
  private gameOverBackdrop!: Phaser.GameObjects.Image;
  private gameOverContent!: Phaser.GameObjects.Container;
  private gameOverPanelSize!: { width: number; height: number };
  private readonly restartFromKeyboard = (): void => this.restartProfile();

  constructor() {
    super('GameOverScene');
  }

  init(data: GameOverSceneData): void {
    this.survivalTime = data.time ?? 0;
    this.kills = data.kills ?? 0;
    this.level = data.level ?? 1;
    this.profileId = data.profileId ?? null;
  }

  create(): void {
    const { width, height } = this.scale.gameSize;
    const compact = width < 600;
    const panelWidth = compact ? Math.min(540, width - 24) : 540;

    // Restrained neutral background keeps the result card visually dominant.
    this.gameOverBackground = this.add.rectangle(width / 2, height / 2, width, height, UI_COLORS.page);
    this.gameOverBackdrop = this.add.image(width / 2, height / 2, 'redBg')
      .setDisplaySize(width, height)
      .setTint(UI_COLORS.gray)
      .setAlpha(0.07);

    // Floating defeated monsters in background
    for (let i = 0; i < 8; i++) {
      const x = Phaser.Math.Between(50, Math.max(51, width - 50));
      const y = Phaser.Math.Between(50, Math.max(51, height - 50));
      const destroyed = [0, 2, 4, 6, 8, 10, 12, 14, 16]; // destroyed frames
      const m = this.add.image(x, y, 'monsterSheet', destroyed[Phaser.Math.Between(0, destroyed.length - 1)])
        .setAlpha(0.15).setScale(0.3).setAngle(Phaser.Math.Between(-30, 30));
      this.tweens.add({
        targets: m, alpha: { from: 0.1, to: 0.2 }, angle: m.angle + Phaser.Math.Between(-10, 10),
        duration: 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    this.gameOverContent = this.add.container(width / 2, height / 2);
    this.gameOverPanelSize = { width: panelWidth, height: 540 };
    this.gameOverContent.add(createUiPanel(this, 0, 20, panelWidth, 540, {
      fill: UI_COLORS.panel, border: UI_COLORS.border, borderWidth: 1, radius: 18,
    }));

    this.gameOverContent.add(this.add.text(0, -198, 'GAME OVER', {
      ...uiTextStyle({ fontSize: compact ? '42px' : '50px', fontStyle: '800' }),
      stroke: '#0b0d12',
      strokeThickness: 2,
    }).setOrigin(0.5));

    const mi = String(Math.floor(this.survivalTime / 60)).padStart(2, '0');
    const se = String(this.survivalTime % 60).padStart(2, '0');
    this.gameOverContent.add([
      this.add.text(0, -120, '생존 시간: ' + mi + ':' + se, uiTextStyle({
        fontSize: '22px', fontStyle: '800',
      })).setOrigin(0.5),
      this.add.text(0, -84, '레벨: ' + this.level, uiTextStyle({
        fontSize: '20px', color: '#d4d7de', fontStyle: '800',
      })).setOrigin(0.5),
      this.add.text(0, -50, '처치: ' + this.kills, uiTextStyle({
        fontSize: '20px', color: '#a7acb7', fontStyle: '800',
      })).setOrigin(0.5),
    ]);

    // Score display using CDN number images
    const score = this.kills * 10 + this.survivalTime * 5 + this.level * 100;
    this.gameOverContent.add(this.add.text(0, 4, '점수', uiTextStyle({
      fontSize: '16px', color: '#a7acb7', fontStyle: '600',
    })).setOrigin(0.5));
    const ss = String(score), nw = 28, startX = -(ss.length * nw) / 2 + nw / 2;
    for (let i = 0; i < ss.length; i++) {
      this.gameOverContent.add(this.add.image(startX + i * nw, 50, 'number' + ss[i]).setScale(0.5));
    }

    const retry = createUiButton(this, 0, 154, '다시하기', {
      width: 240, height: 52, fill: UI_COLORS.primary, border: UI_COLORS.primary,
      color: '#ffffff', fontSize: '21px',
    });
    this.gameOverContent.add(retry);
    retry.on('pointerdown', () => this.restartProfile());

    const menu = createUiButton(this, 0, 210, '메뉴로 돌아가기', {
      width: 190, height: 40, fill: UI_COLORS.surfaceRaised, border: UI_COLORS.border,
      fontSize: '14px',
    });
    this.gameOverContent.add(menu);
    menu.on('pointerdown', () => this.scene.start('MenuScene'));

    const keyboard = this.input.keyboard!;
    keyboard.on('keydown-ENTER', this.restartFromKeyboard);

    this.scale.on('resize', this._layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this._layout, this);
      keyboard.off('keydown-ENTER', this.restartFromKeyboard);
    });
  }

  private _layout(gameSize: Phaser.Structs.Size): void {
    const { width, height } = gameSize;
    this.gameOverBackground.setPosition(width / 2, height / 2).setDisplaySize(width, height);
    this.gameOverBackdrop.setPosition(width / 2, height / 2).setDisplaySize(width, height);
    const fitScale = this.gameOverPanelSize
      ? Math.min(1, (width - 12) / this.gameOverPanelSize.width, (height - 12) / this.gameOverPanelSize.height)
      : 1;
    this.gameOverContent.setPosition(width / 2, height / 2).setScale(fitScale);
  }

  private restartProfile(): void {
    const profile = getProfile(this.profileId);
    if (!profile) {
      this.scene.start('MenuScene');
      return;
    }
    this.scene.start('GameScene', {
      profileId: profile.id,
      profileSkin: profile.skin,
      saveData: profile.state,
      loadedFromProfile: true,
    });
  }
}
