import { MONSTER_PORTAL_SPINE_ASSET } from '../config/assets';
import {
  MONSTER_PORTAL_DURATION_MS,
  MONSTER_PORTAL_EMERGE_DURATION_MS,
} from '../game/enemySpawn';
import type { EnemySpawnPresentation } from '../game/types';

interface MonsterPortalAppearance {
  texture: string;
  frame: string | number;
  scale: number;
  tint?: number;
}

/** Short-lived portal and non-physics monster clone used during enemy entry. */
export class MonsterPortalPresentation implements EnemySpawnPresentation {
  private readonly portal: SpineGameObject;
  private emergingMonster: Phaser.GameObjects.Sprite | null = null;
  private x: number;
  private y: number;
  private visible = true;
  private destroyed = false;

  static create(
    scene: Phaser.Scene,
    x: number,
    y: number,
    appearance: MonsterPortalAppearance,
    remainingMs = MONSTER_PORTAL_DURATION_MS,
  ): MonsterPortalPresentation | null {
    if (scene.game.renderer.type !== Phaser.WEBGL || remainingMs <= 0) return null;
    try {
      return new MonsterPortalPresentation(scene, x, y, appearance, remainingMs);
    } catch (error) {
      console.warn('Monster portal Spine loading failed:', error);
      return null;
    }
  }

  private constructor(
    private readonly scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly appearance: MonsterPortalAppearance,
    remainingMs: number,
  ) {
    this.x = x;
    this.y = y;
    const clampedRemaining = Phaser.Math.Clamp(remainingMs, 1, MONSTER_PORTAL_DURATION_MS);
    const displayHeight = 121 * Math.abs(appearance.scale);
    const portalScale = Phaser.Math.Clamp(displayHeight / 95, 0.42, 1.55);
    this.portal = scene.make.spine({
      x,
      y,
      key: MONSTER_PORTAL_SPINE_ASSET.key,
      animationName: MONSTER_PORTAL_SPINE_ASSET.animation,
      skinName: MONSTER_PORTAL_SPINE_ASSET.skin,
      loop: false,
    }).setDepth(4.1).setScale(portalScale);
    const portalTrack = this.portal.setAnimation(
      0,
      MONSTER_PORTAL_SPINE_ASSET.animation,
      false,
    );
    portalTrack.trackTime = (MONSTER_PORTAL_DURATION_MS - clampedRemaining) / 1_000;

    const untilEmergence = Math.max(0, clampedRemaining - MONSTER_PORTAL_EMERGE_DURATION_MS);
    if (untilEmergence === 0) this.beginEmergence(clampedRemaining);
    else {
      scene.time.delayedCall(untilEmergence, () => {
        if (!this.destroyed) this.beginEmergence(MONSTER_PORTAL_EMERGE_DURATION_MS);
      });
    }
    scene.time.delayedCall(clampedRemaining, () => this.destroy());
  }

  sync(x: number, y: number): void {
    if (this.destroyed) return;
    const dx = x - this.x;
    const dy = y - this.y;
    this.x = x;
    this.y = y;
    this.portal.setPosition(x, y);
    if (this.emergingMonster) {
      this.emergingMonster.x += dx;
      this.emergingMonster.y += dy;
    }
  }

  setVisible(visible: boolean): void {
    if (this.destroyed) return;
    this.visible = visible;
    this.portal.setVisible(visible);
    this.emergingMonster?.setVisible(visible);
  }

  private beginEmergence(durationMs: number): void {
    if (this.destroyed || this.emergingMonster) return;
    this.emergingMonster = this.scene.add.sprite(
      this.x,
      this.y + 18,
      this.appearance.texture,
      this.appearance.frame,
    ).setDepth(4).setScale(this.appearance.scale).setAlpha(0).setVisible(this.visible);
    if (this.appearance.tint !== undefined) this.emergingMonster.setTint(this.appearance.tint);
    this.scene.tweens.add({
      targets: this.emergingMonster,
      y: this.y,
      alpha: 1,
      duration: Math.max(1, durationMs),
      ease: 'Cubic.Out',
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.emergingMonster) this.scene.tweens.killTweensOf(this.emergingMonster);
    this.emergingMonster?.destroy();
    this.emergingMonster = null;
    this.portal.destroy();
  }
}
