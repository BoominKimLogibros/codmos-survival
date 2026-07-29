import { UI_COLORS, uiTextStyle } from '../ui/theme';

export interface PlayerStatusPresentationState {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  xp: number;
  xpToNext: number;
  status?: string;
}

const BAR_WIDTH = 76;

function clampRatio(value: number, maximum: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.min(1, Math.max(0, value / maximum));
}

function displayName(name: string): string {
  const characters = Array.from(name);
  return characters.length > 9 ? `${characters.slice(0, 8).join('')}…` : name;
}

/** Compact name, level, HP and XP presentation shared by host and UDP clients. */
export class PlayerStatusPresentation {
  readonly container: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.Text;
  private readonly hpFill: Phaser.GameObjects.Rectangle;
  private readonly xpFill: Phaser.GameObjects.Rectangle;
  private signature = '';

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    state: PlayerStatusPresentationState,
  ) {
    this.container = scene.add.container(x, y).setDepth(22);
    this.title = scene.add.text(0, -6, '', uiTextStyle({
      fontSize: '9px', color: '#ffffff', fontStyle: '800', align: 'center',
      stroke: '#0b0d12', strokeThickness: 2,
    })).setOrigin(0.5, 1);
    const hpBackground = scene.add.rectangle(0, 0, BAR_WIDTH, 8, UI_COLORS.panelDeep, 0.94)
      .setStrokeStyle(1, UI_COLORS.border, 0.9);
    this.hpFill = scene.add.rectangle(-BAR_WIDTH / 2 + 1, 0, BAR_WIDTH - 2, 6, UI_COLORS.health)
      .setOrigin(0, 0.5);
    const xpBackground = scene.add.rectangle(0, 7, BAR_WIDTH, 4, UI_COLORS.panelDeep, 0.94);
    this.xpFill = scene.add.rectangle(-BAR_WIDTH / 2, 7, BAR_WIDTH, 3, UI_COLORS.experience)
      .setOrigin(0, 0.5);
    this.container.add([this.title, hpBackground, this.hpFill, xpBackground, this.xpFill]);
    this.update(state);
  }

  setPosition(x: number, y: number): this {
    this.container.setPosition(x, y);
    return this;
  }

  update(state: PlayerStatusPresentationState): this {
    const level = Math.max(1, Math.floor(Number.isFinite(state.level) ? state.level : 1));
    const maxHp = Math.max(1, Math.ceil(Number.isFinite(state.maxHp) ? state.maxHp : 1));
    const hp = Math.min(maxHp, Math.max(0, Math.ceil(Number.isFinite(state.hp) ? state.hp : 0)));
    const hpRatio = clampRatio(state.hp, state.maxHp);
    const xpRatio = clampRatio(state.xp, state.xpToNext);
    const signature = [state.name, level, hp, maxHp, hpRatio, xpRatio, state.status].join('|');
    if (signature === this.signature) return this;
    this.signature = signature;
    this.title.setText(`Lv.${level} · ${displayName(state.name)}${state.status ? ` · ${state.status}` : ''}`);
    this.hpFill.setDisplaySize(Math.max(1, (BAR_WIDTH - 2) * hpRatio), 6).setVisible(hpRatio > 0);
    this.xpFill.setDisplaySize(Math.max(1, BAR_WIDTH * xpRatio), 3).setVisible(xpRatio > 0);
    this.container.setAlpha(state.status ? 0.58 : 1);
    return this;
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
