import type { LevelUpChoice, PlayerStats, WeaponDefinitions } from '../game/types';
import { createUiPanel, UI_COLORS, uiTextStyle } from '../ui/theme';
import type { GameScene } from './GameScene';
import { generateLevelUpChoices } from '../game/levelUp';

interface LevelUpSceneData {
  stats: PlayerStats;
  weaponDefinitions: WeaponDefinitions;
}

export class LevelUpScene extends Phaser.Scene {
  private stats!: PlayerStats;
  private weaponDefinitions!: WeaponDefinitions;
  private levelOverlay!: Phaser.GameObjects.Rectangle;
  private levelContent!: Phaser.GameObjects.Container;
  private levelPanelSize!: { width: number; height: number };
  private selectionCommitted = false;
  private choices: LevelUpChoice[] = [];
  private readonly selectFirst = (): void => this.pickByIndex(0);
  private readonly selectSecond = (): void => this.pickByIndex(1);
  private readonly selectThird = (): void => this.pickByIndex(2);

  constructor() {
    super('LevelUpScene');
  }

  init(data: LevelUpSceneData): void {
    this.stats = data.stats;
    this.weaponDefinitions = data.weaponDefinitions;
    this.selectionCommitted = false;
  }

  create(): void {
    const { width, height } = this.scale.gameSize;
    const compact = width < 720;
    const panelWidth = compact ? Math.min(390, width - 18) : 710;
    const panelHeight = compact ? Math.min(570, height - 18) : 520;
    const titleY = -panelHeight / 2 + 42;
    this.levelOverlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.7);
    this.levelContent = this.add.container(width / 2, height / 2);
    const mainPanel = createUiPanel(this, 0, 0, panelWidth, panelHeight, {
      fill: UI_COLORS.panel, border: UI_COLORS.border, borderWidth: 1, radius: 18,
    });
    this.levelPanelSize = { width: panelWidth, height: panelHeight };
    this.levelContent.add([
      mainPanel,
      this.add.text(0, titleY, '레벨 업!', {
        ...uiTextStyle({ fontSize: compact ? '30px' : '36px', fontStyle: '800' }),
        stroke: '#0b0d12', strokeThickness: 2,
      }).setOrigin(0.5),
      this.add.text(0, titleY + 40, '레벨 ' + this.stats.level, uiTextStyle({
        fontSize: compact ? '16px' : '18px', fontStyle: '800',
      })).setOrigin(0.5),
    ]);

    const choices = this._genChoices();
    this.choices = choices;
    const cw = compact ? panelWidth - 36 : 200;
    const ch = compact ? 128 : 180;
    const gap = compact ? 12 : 20;
    const tw = choices.length * cw + (choices.length - 1) * gap;
    const sx = compact ? 0 : -tw / 2 + cw / 2;

    choices.forEach((c, idx) => {
      const x = compact ? 0 : sx + idx * (cw + gap);
      const y = compact ? titleY + 116 + idx * (ch + gap) : 30;
      const card = createUiPanel(this, x, y, cw, ch, {
        fill: UI_COLORS.surfaceRaised, border: UI_COLORS.border, borderWidth: 1, radius: 16,
      }).setInteractive({
        hitArea: new Phaser.Geom.Rectangle(-cw / 2, -ch / 2, cw, ch),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
      this.levelContent.add(card);
      if (c.icon) {
        const iconSize = compact ? 30 : 34;
        this.levelContent.add(this.add.image(
          compact ? x - cw / 2 + 46 : x,
          compact ? y : y - 55,
          c.icon,
        ).setDisplaySize(iconSize, iconSize));
      }
      const textX = compact ? x + 20 : x;
      const textWidth = compact ? cw - 116 : cw - 20;
      this.levelContent.add(this.add.text(textX, compact ? y - 31 : y - 20, c.name, uiTextStyle({
        fontSize: '14px', color: '#ffffff', fontStyle: '800', wordWrap: { width: textWidth },
        align: 'center',
      })).setOrigin(0.5));
      this.levelContent.add(this.add.text(textX, compact ? y - 5 : y + 10, c.desc, uiTextStyle({
        fontSize: '11px', color: '#a7acb7', fontStyle: '600',
        wordWrap: { width: textWidth }, align: 'center',
      })).setOrigin(0.5, 0));
      if (c.levelText) this.levelContent.add(this.add.text(textX, compact ? y + 37 : y + 60, c.levelText, uiTextStyle({
        fontSize: '10px', color: '#d4d7de', fontStyle: '800',
      })).setOrigin(0.5));
      card.on('pointerover', () => card.redrawUiPanel({ border: UI_COLORS.primary, borderWidth: 2 }));
      card.on('pointerout', () => card.redrawUiPanel({ border: UI_COLORS.border, borderWidth: 1 }));
      card.on('pointerdown', () => this._pick(c));
      this.levelContent.add(this.add.text(
        compact ? x + cw / 2 - 34 : x,
        compact ? y + ch / 2 - 16 : 143,
        `[${idx + 1}] 키`,
        uiTextStyle({
        fontSize: '12px', color: '#a7acb7', fontStyle: '600',
        }),
      ).setOrigin(0.5));
    });

    const keyboard = this.input.keyboard!;
    keyboard.on('keydown-ONE', this.selectFirst);
    keyboard.on('keydown-TWO', this.selectSecond);
    keyboard.on('keydown-THREE', this.selectThird);

    this.scale.on('resize', this._layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this._layout, this);
      keyboard.off('keydown-ONE', this.selectFirst);
      keyboard.off('keydown-TWO', this.selectSecond);
      keyboard.off('keydown-THREE', this.selectThird);
      this.choices = [];
    });
  }

  private _layout(gameSize: Phaser.Structs.Size): void {
    const { width, height } = gameSize;
    this.levelOverlay.setPosition(width / 2, height / 2).setDisplaySize(width, height);
    const fitScale = this.levelPanelSize
      ? Math.min(1, (width - 12) / this.levelPanelSize.width, (height - 12) / this.levelPanelSize.height)
      : 1;
    this.levelContent.setPosition(width / 2, height / 2).setScale(fitScale);
  }

  private _genChoices(): LevelUpChoice[] {
    return generateLevelUpChoices(this.stats, this.weaponDefinitions);
  }

  private pickByIndex(index: number): void {
    const choice = this.choices[index];
    if (choice) this._pick(choice);
  }

  private _pick(choice: LevelUpChoice): void {
    if (this.selectionCommitted) return;
    this.selectionCommitted = true;
    (this.scene.get('GameScene') as GameScene).resumeFromLevelUp(choice);
    this.scene.stop();
  }
}
