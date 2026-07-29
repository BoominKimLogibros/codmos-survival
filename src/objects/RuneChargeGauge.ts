import { UI_COLORS } from '../ui/theme';

const GAUGE_WIDTH = 72;
const GAUGE_HEIGHT = 10;
const GAUGE_OFFSET_Y = 43;

/** World-space progress gauge displayed above the rune being charged. */
export class RuneChargeGauge {
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(9);
  }

  update(x: number, y: number, progress: number): void {
    const value = Phaser.Math.Clamp(progress, 0, 1);
    const left = x - GAUGE_WIDTH / 2;
    const top = y - GAUGE_OFFSET_Y;
    this.graphics.clear();
    this.graphics.fillStyle(UI_COLORS.panelDeep, 0.92);
    this.graphics.fillRoundedRect(left, top, GAUGE_WIDTH, GAUGE_HEIGHT, 5);
    if (value > 0) {
      this.graphics.fillStyle(UI_COLORS.primary, 1);
      this.graphics.fillRoundedRect(
        left + 2,
        top + 2,
        (GAUGE_WIDTH - 4) * value,
        GAUGE_HEIGHT - 4,
        3,
      );
    }
    this.graphics.lineStyle(1, UI_COLORS.white, 0.72);
    this.graphics.strokeRoundedRect(left, top, GAUGE_WIDTH, GAUGE_HEIGHT, 5);
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
