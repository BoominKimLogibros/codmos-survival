import { MAX_VISIBLE_HP_GRID_CELLS } from '../config/constants';
import type { EnemySprite } from '../game/types';
import { UI_COLORS } from '../ui/theme';

export class EnemyHealthBar {
  private readonly scene: Phaser.Scene;
  private readonly enemy: EnemySprite;
  private width = 0;
  private height = 0;
  private yOffset = 0;
  private gridStep = 0;
  private background!: Phaser.GameObjects.Rectangle;
  private fill!: Phaser.GameObjects.Rectangle;
  private grid!: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, enemy: EnemySprite) {
    this.scene = scene;
    this.enemy = enemy;
    this.create();
  }

  private create(): void {
    const enemy = this.enemy;
    const segmentCount = Math.max(1, Math.ceil(enemy.maxHp / 100));
    const visibleCells = Math.min(segmentCount, MAX_VISIBLE_HP_GRID_CELLS);
    const gridStep = Math.max(1, Math.ceil(segmentCount / visibleCells));
    const isLargeEnemy = enemy.enemyType === 'boss' || enemy.enemyType === 'compressed';
    this.width = Phaser.Math.Clamp(visibleCells * 8, isLargeEnemy ? 48 : 28, 240);
    this.height = isLargeEnemy ? 8 : 6;
    this.yOffset = -(Math.max(20, enemy.displayHeight / 2) + 10);
    this.gridStep = gridStep * 100;

    enemy.hpBarWidth = this.width;
    enemy.hpBarHeight = this.height;
    enemy.hpBarYOffset = this.yOffset;
    enemy.hpSegmentCount = segmentCount;
    enemy.hpVisibleGridStep = this.gridStep;

    this.background = this.scene.add.rectangle(
      enemy.x, enemy.y + this.yOffset, this.width + 2, this.height + 2, UI_COLORS.panelDeep,
    ).setDepth(3.9);
    this.fill = this.scene.add.rectangle(
      enemy.x - this.width / 2, enemy.y + this.yOffset, this.width, this.height, UI_COLORS.primary,
    ).setOrigin(0, 0.5).setDepth(4);
    this.grid = this.scene.add.graphics().setPosition(enemy.x, enemy.y + this.yOffset).setDepth(4.1);
    this.grid.lineStyle(1, 0xffffff, 0.65);
    for (let hp = this.gridStep; hp < enemy.maxHp; hp += this.gridStep) {
      const x = -this.width / 2 + this.width * (hp / enemy.maxHp);
      this.grid.lineBetween(x, -this.height / 2, x, this.height / 2);
    }

    // Preserve the previous public fields for compatibility with game logic and tests.
    enemy.hpBarBg = this.background;
    enemy.hpBar = this.fill;
    enemy.hpGrid = this.grid;
  }

  update(): void {
    const enemy = this.enemy;
    if (!this.fill || !this.fill.active) return;
    const y = enemy.y + this.yOffset;
    const ratio = Phaser.Math.Clamp(enemy.hp / enemy.maxHp, 0, 1);
    this.background.setPosition(enemy.x, y);
    this.fill.setPosition(enemy.x - this.width / 2, y);
    this.fill.width = this.width * ratio;
    this.grid.setPosition(enemy.x, y);
  }

  destroy(): void {
    [this.fill, this.background, this.grid].forEach((object) => {
      if (object && object.active) object.destroy();
    });
    this.enemy.hpBar = null;
    this.enemy.hpBarBg = null;
    this.enemy.hpGrid = null;
  }
}
