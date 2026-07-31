import type {
  PlayerStats,
  WeaponDefinitions,
  WeaponKey,
  WeaponTooltipData,
} from '../game/types';
import {
  calculatePlayerStatLevel,
  PLAYER_STAT_LABELS,
  PLAYER_STAT_RULES,
  type PenalizedPlayerStat,
} from '../game/progression';
import { PLAYER_STAT_ICONS, PLAYER_STAT_KEYS } from '../config/statIcons';
import { shouldShowTouchControls } from './TouchJoystick';
import { WeaponTooltip } from './WeaponTooltip';
import { createUiPanel, UI_COLORS, uiTextStyle, type UiPanel } from './theme';

interface WeaponStatusHudOptions {
  getWeaponKeys: () => WeaponKey[];
  getWeapons: () => WeaponDefinitions;
  getWeaponTooltip: (key: WeaponKey) => WeaponTooltipData;
  getStats?: () => PlayerStats;
}

interface HudIconSlot {
  kind: 'weapon' | 'stat';
  key: WeaponKey | PenalizedPlayerStat;
  background: UiPanel;
  icon: Phaser.GameObjects.Image;
  level: Phaser.GameObjects.Text;
  size: number;
}

interface IconLayout {
  size: number;
  gap: number;
  groupGap: number;
  startX: number;
  y: number;
}

const PLAYER_STAT_DESCRIPTIONS: Record<PenalizedPlayerStat, string> = {
  maxHp: '강화로 투자한 최대 체력입니다.',
  armor: '몬스터에게 받는 피해를 줄입니다.',
  speed: '플레이어의 이동 속도를 높입니다.',
  magnet: '경험치 구슬을 끌어오는 범위를 넓힙니다.',
  recovery: '전투 중 매초 체력을 회복합니다.',
};

function formattedStatValue(stats: PlayerStats, stat: PenalizedPlayerStat): string {
  switch (stat) {
    case 'maxHp': return `${stats.maxHp} HP`;
    case 'speed': return `${stats.speed}`;
    case 'armor': return `${stats.armor}`;
    case 'magnet': return `${stats.magnet}px`;
    case 'recovery': return `${stats.recovery.toFixed(1)} HP/초`;
  }
}

function formattedRuleValue(stat: PenalizedPlayerStat, value: number): string {
  switch (stat) {
    case 'maxHp': return `${value} HP`;
    case 'magnet': return `${value}px`;
    case 'recovery': return `${value.toFixed(1)} HP/초`;
    default: return `${value}`;
  }
}

export function buildPlayerStatTooltipData(
  stats: PlayerStats,
  stat: PenalizedPlayerStat,
): WeaponTooltipData {
  const level = calculatePlayerStatLevel(stats, stat);
  const rule = PLAYER_STAT_RULES[stat];
  const rows = stat === 'maxHp'
    ? [{ label: '현재 HP', value: `${Math.ceil(stats.hp)} / ${stats.maxHp}` }]
    : [];
  rows.push(
    { label: '최종 수치', value: formattedStatValue(stats, stat) },
    { label: '기본 수치', value: formattedRuleValue(stat, rule.minimum) },
    { label: 'Lv당 증가', value: `+${formattedRuleValue(stat, rule.amount)}` },
  );
  if (stat === 'armor') {
    rows.push({ label: '피해 계산', value: `받는 피해 -${stats.armor} (최소 1)` });
  }
  return {
    name: PLAYER_STAT_LABELS[stat],
    description: PLAYER_STAT_DESCRIPTIONS[stat],
    level,
    maxLevel: null,
    levelLabel: `투자 Lv ${level}`,
    stats: rows,
  };
}

/** Shared lower-left skill/stat HUD used by both single-player and LAN clients. */
export class WeaponStatusHud {
  private readonly tooltip: WeaponTooltip;
  private icons: HudIconSlot[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: WeaponStatusHudOptions,
  ) {
    this.tooltip = new WeaponTooltip(scene);
    this.refresh();
    scene.scale.on('resize', this.handleResize, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  update(): void {
    const stats = this.options.getStats?.();
    const definitions = this.options.getWeapons();
    this.icons.forEach((slot) => {
      const level = slot.kind === 'weapon'
        ? definitions[slot.key as WeaponKey]?.level ?? 0
        : stats ? calculatePlayerStatLevel(stats, slot.key as PenalizedPlayerStat) : 0;
      slot.level.setText(`Lv${level}`);
    });
  }

  refresh(): void {
    this.tooltip.hide();
    this.destroyIcons();

    const weaponKeys = this.options.getWeaponKeys();
    const definitions = this.options.getWeapons();
    const statKeys = this.options.getStats ? PLAYER_STAT_KEYS : [];
    const total = weaponKeys.length + statKeys.length;
    const layout = this.calculateLayout(total, weaponKeys.length, this.scene.scale.gameSize);

    weaponKeys.forEach((key, index) => {
      const definition = definitions[key];
      if (!definition) return;
      this.icons.push(this.createIconSlot(
        'weapon',
        key,
        definition.icon,
        definition.level,
        this.iconX(index, weaponKeys.length, layout),
        layout,
      ));
    });
    statKeys.forEach((key, index) => {
      const stats = this.options.getStats?.();
      const level = stats ? calculatePlayerStatLevel(stats, key) : 0;
      this.icons.push(this.createIconSlot(
        'stat',
        key,
        PLAYER_STAT_ICONS[key],
        level,
        this.iconX(weaponKeys.length + index, weaponKeys.length, layout),
        layout,
      ));
    });
  }

  hideTooltip(): void {
    this.tooltip.hide();
  }

  destroy(): void {
    this.scene.scale.off('resize', this.handleResize, this);
    this.tooltip.hide();
    this.destroyIcons();
  }

  private createIconSlot(
    kind: HudIconSlot['kind'],
    key: HudIconSlot['key'],
    texture: string,
    levelValue: number,
    x: number,
    layout: IconLayout,
  ): HudIconSlot {
    const half = layout.size / 2;
    const background = createUiPanel(this.scene, x, layout.y, layout.size, layout.size, {
      fill: UI_COLORS.panelDark,
      border: kind === 'stat' ? UI_COLORS.experience : UI_COLORS.border,
      borderWidth: 2,
      radius: Math.max(8, layout.size * 0.28),
      shadow: true,
      shadowOffset: Math.max(2, layout.size * 0.07),
    }).setScrollFactor(0).setDepth(100);
    background.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-half, -half, layout.size, layout.size),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    const icon = this.scene.add.image(x, layout.y - layout.size * 0.06, texture)
      .setScrollFactor(0)
      .setDepth(101)
      .setDisplaySize(layout.size * 0.62, layout.size * 0.62);
    const level = this.scene.add.text(
      x - layout.size * 0.36,
      layout.y + layout.size * 0.26,
      `Lv${levelValue}`,
      uiTextStyle({
        fontSize: layout.size < 34 ? '7px' : '8px',
        color: '#ffffff',
        fontStyle: '800',
        stroke: '#10131a',
        strokeThickness: 2,
      }),
    ).setScrollFactor(0).setDepth(102);
    const slot: HudIconSlot = { kind, key, background, icon, level, size: layout.size };
    const normalBorder = kind === 'stat' ? UI_COLORS.experience : UI_COLORS.border;
    background.on('pointerover', () => {
      background.redrawUiPanel({ border: UI_COLORS.primary });
      this.showTooltip(slot);
    });
    background.on('pointerout', () => {
      background.redrawUiPanel({ border: normalBorder });
      this.tooltip.hide();
    });
    background.on('pointerdown', () => this.showTooltip(slot));
    return slot;
  }

  private showTooltip(slot: HudIconSlot): void {
    const data = slot.kind === 'weapon'
      ? this.options.getWeaponTooltip(slot.key as WeaponKey)
      : buildPlayerStatTooltipData(
        this.options.getStats!(),
        slot.key as PenalizedPlayerStat,
      );
    this.tooltip.show(data, slot.background.x, slot.background.y - slot.size / 2);
  }

  private destroyIcons(): void {
    this.icons.forEach(({ background, icon, level }) => {
      background.destroy();
      icon.destroy();
      level.destroy();
    });
    this.icons = [];
  }

  private calculateLayout(
    total: number,
    weaponCount: number,
    gameSize: Phaser.Structs.Size,
  ): IconLayout {
    const horizontalMargin = 16;
    const groupGap = weaponCount > 0 && total > weaponCount ? 4 : 0;
    const gap = total >= 9 ? 4 : 6;
    const available = Math.max(1, gameSize.width - horizontalMargin * 2 - groupGap);
    const fittedSize = Math.floor((available - gap * Math.max(0, total - 1)) / Math.max(1, total));
    const size = Phaser.Math.Clamp(fittedSize, 24, 42);
    const rowWidth = size * total + gap * Math.max(0, total - 1) + groupGap;
    const crowdedRight = horizontalMargin + rowWidth > gameSize.width - 142;
    const y = crowdedRight
      ? gameSize.height - (shouldShowTouchControls() ? 208 : 100)
      : gameSize.height - 40;
    return {
      size,
      gap,
      groupGap,
      startX: horizontalMargin + size / 2,
      y,
    };
  }

  private iconX(index: number, weaponCount: number, layout: IconLayout): number {
    return layout.startX + index * (layout.size + layout.gap) +
      (index >= weaponCount ? layout.groupGap : 0);
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.tooltip.hide();
    const weaponCount = this.icons.filter((slot) => slot.kind === 'weapon').length;
    const layout = this.calculateLayout(this.icons.length, weaponCount, gameSize);
    this.icons.forEach((slot, index) => {
      const x = this.iconX(index, weaponCount, layout);
      slot.size = layout.size;
      slot.background.setPosition(x, layout.y).resizeUiPanel(layout.size, layout.size);
      const half = layout.size / 2;
      slot.background.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(-half, -half, layout.size, layout.size),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
      slot.icon.setPosition(x, layout.y - layout.size * 0.06)
        .setDisplaySize(layout.size * 0.62, layout.size * 0.62);
      slot.level.setPosition(x - layout.size * 0.36, layout.y + layout.size * 0.26)
        .setFontSize(layout.size < 34 ? 7 : 8);
    });
  }
}
