import { PLAYER_HIT_FEEDBACK_DURATION_MS, PLAYER_SCALE } from '../config/constants';
import { UI_COLORS } from '../ui/theme';
import { createInitialPlayerStats, type PlayerDirection, type PlayerStats } from './types';

export interface PlayerControllerOptions {
  skin: string;
  spawn: { x: number; y: number };
  isRunActive: () => boolean;
  inputProvider?: () => number;
  cameraFollow?: boolean;
  cameraLerp?: number;
}

export const INPUT_UP = 1;
export const INPUT_DOWN = 2;
export const INPUT_LEFT = 4;
export const INPUT_RIGHT = 8;

type SpineView = SpineGameObject;

type DrawSkeleton = (
  skeleton: SpineSkeleton,
  premultipliedAlpha: boolean,
  slotRangeStart: number,
  slotRangeEnd: number,
) => void;

interface SharedSpineRenderer {
  drawSkeleton?: DrawSkeleton;
}

interface SpineRendererPatch {
  renderer: SharedSpineRenderer;
  original: DrawSkeleton;
  wrapped: DrawSkeleton;
  sideViews: Map<SpineSkeleton, SpineView>;
  references: number;
}

const spineRendererPatches = new WeakMap<object, SpineRendererPatch>();

function registerSpineFlipWorkaround(
  renderer: SharedSpineRenderer,
  sideView: SpineView,
): (() => void) | null {
  if (!renderer.drawSkeleton) return null;
  let patch = spineRendererPatches.get(renderer as object);
  if (!patch) {
    const original = renderer.drawSkeleton;
    const nextPatch = {
      renderer,
      original,
      sideViews: new Map<SpineSkeleton, SpineView>(),
      references: 0,
    } as SpineRendererPatch;
    nextPatch.wrapped = (skeleton, premultipliedAlpha, slotRangeStart, slotRangeEnd) => {
      const view = nextPatch.sideViews.get(skeleton);
      const flip = Boolean(view?._wantFlipX);
      const transforms = flip
        ? skeleton.bones.map((bone) => ({ bone, a: bone.a, b: bone.b, worldX: bone.worldX }))
        : [];
      if (flip && transforms.length > 0) {
        const rootWorldX = transforms[0].worldX;
        transforms.forEach(({ bone }) => {
          bone.a = -bone.a;
          bone.b = -bone.b;
          bone.worldX = 2 * rootWorldX - bone.worldX;
        });
      }
      try {
        nextPatch.original.call(
          renderer,
          skeleton,
          premultipliedAlpha,
          slotRangeStart,
          slotRangeEnd,
        );
      } finally {
        transforms.forEach(({ bone, a, b, worldX }) => {
          bone.a = a;
          bone.b = b;
          bone.worldX = worldX;
        });
      }
    };
    renderer.drawSkeleton = nextPatch.wrapped;
    patch = nextPatch;
    spineRendererPatches.set(renderer as object, patch);
  }
  patch.sideViews.set(sideView.skeleton, sideView);
  patch.references++;
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    patch!.sideViews.delete(sideView.skeleton);
    patch!.references--;
    if (patch!.references > 0) return;
    if (patch!.renderer.drawSkeleton === patch!.wrapped) {
      patch!.renderer.drawSkeleton = patch!.original;
    }
    spineRendererPatches.delete(patch!.renderer as object);
  };
}

/** Owns the player physics body, input, stats, and Spine presentation. */
export class PlayerController {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly stats: PlayerStats = createInitialPlayerStats();

  private readonly scene: Phaser.Scene;
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly wasd: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private readonly spineViews: Record<PlayerDirection, SpineView>;
  private currentSpineView: SpineView | null = null;
  private currentDirection: PlayerDirection = 'front';
  private useSpineBoneFlip = false;
  private playerHasSpine = false;
  private facingRight = true;
  private readonly inputProvider?: () => number;
  private readonly cameraFollow: boolean;
  private defeated = false;
  private defeatedFallback?: Phaser.GameObjects.Image;
  private defeatedGlow?: Phaser.GameObjects.Ellipse;
  private hitWindowActive = false;
  private hitRevisionValue = 0;
  private removeSpineFlipWorkaround?: () => void;

  constructor(scene: Phaser.Scene, options: PlayerControllerOptions) {
    this.scene = scene;
    this.inputProvider = options.inputProvider;
    this.cameraFollow = options.cameraFollow !== false;
    this.sprite = scene.physics.add.sprite(options.spawn.x, options.spawn.y, 'player').setDepth(5);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDamping(true);
    this.sprite.setDrag(0.9);
    (this.sprite.body as Phaser.Physics.Arcade.Body).setCircle(14, 2, 2);
    this.sprite.setAlpha(0);

    this.spineViews = this.createSpineViews(options.skin, options.spawn);
    this.cursors = scene.input.keyboard!.createCursorKeys();
    this.wasd = {
      up: scene.input.keyboard!.addKey('W'),
      down: scene.input.keyboard!.addKey('S'),
      left: scene.input.keyboard!.addKey('A'),
      right: scene.input.keyboard!.addKey('D'),
    };

    if (this.cameraFollow) {
      const cameraLerp = Phaser.Math.Clamp(options.cameraLerp ?? 0.08, 0, 1);
      scene.cameras.main.startFollow(this.sprite, true, cameraLerp, cameraLerp);
    }
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.removeSpineFlipWorkaround?.();
      this.removeSpineFlipWorkaround = undefined;
    });
    scene.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (options.isRunActive() && this.stats.recovery > 0) {
          this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + this.stats.recovery);
        }
      },
    });
  }

  get hasSpine(): boolean {
    return this.playerHasSpine;
  }

  get isFacingRight(): boolean {
    return this.facingRight;
  }

  get hitRevision(): number {
    return this.hitRevisionValue;
  }

  tryBeginHitWindow(): boolean {
    if (this.hitWindowActive || this.defeated || this.stats.hp <= 0 || !this.sprite.active) return false;
    this.hitWindowActive = true;
    this.scene.time.delayedCall(PLAYER_HIT_FEEDBACK_DURATION_MS, () => {
      this.hitWindowActive = false;
    });
    return true;
  }

  update(): void {
    const { speed } = this.stats;
    let velocityX = 0;
    let velocityY = 0;
    const input = this.inputProvider?.();
    if (input !== undefined) {
      if (input & INPUT_LEFT) velocityX = -1;
      if (input & INPUT_RIGHT) velocityX = 1;
      if (input & INPUT_UP) velocityY = -1;
      if (input & INPUT_DOWN) velocityY = 1;
    } else {
      if (this.cursors.left.isDown || this.wasd.left.isDown) velocityX = -1;
      if (this.cursors.right.isDown || this.wasd.right.isDown) velocityX = 1;
      if (this.cursors.up.isDown || this.wasd.up.isDown) velocityY = -1;
      if (this.cursors.down.isDown || this.wasd.down.isDown) velocityY = 1;
    }
    if (velocityX && velocityY) {
      velocityX *= 0.707;
      velocityY *= 0.707;
    }

    this.sprite.setVelocity(velocityX * speed, velocityY * speed);
    this.updatePresentation(velocityX, velocityY);
    this.syncSpinePosition();
  }

  applySavedState(stats: PlayerStats, position: { x: number; y: number }): void {
    Object.assign(this.stats, stats, { weapons: [...stats.weapons] });
    if (this.stats.hp <= 0) this.stats.hp = this.stats.maxHp;
    this.setPosition(position.x, position.y);
  }

  setPosition(x: number, y: number): void {
    this.sprite.setPosition(x, y);
    this.syncSpinePosition();
    if (this.cameraFollow) this.scene.cameras.main.centerOn(x, y);
  }

  applyNetworkState(x: number, y: number, velocityX: number, velocityY: number): void {
    this.sprite.setPosition(x, y).setVelocity(velocityX, velocityY);
    const magnitude = Math.hypot(velocityX, velocityY);
    const normalizedX = magnitude > 0 ? velocityX / magnitude : 0;
    const normalizedY = magnitude > 0 ? velocityY / magnitude : 0;
    this.updatePresentation(normalizedX, normalizedY);
    this.syncSpinePosition();
  }

  showDamageFeedback(): void {
    this.hitRevisionValue++;
    const damageTint = 0xff4d4f;
    if (this.playerHasSpine) {
      Object.values(this.spineViews).forEach((view) => view.setColor(damageTint));
      this.scene.time.delayedCall(PLAYER_HIT_FEEDBACK_DURATION_MS, () => {
        Object.values(this.spineViews).forEach((view) => {
          if (view.active) view.setColor(0xffffff);
        });
      });
      return;
    }

    this.sprite.setTint(damageTint);
    this.scene.time.delayedCall(PLAYER_HIT_FEEDBACK_DURATION_MS, () => {
      if (this.sprite.active) this.sprite.clearTint();
    });
  }

  enterDefeatedState(): void {
    if (this.defeated) return;
    this.defeated = true;
    const { x, y } = this.sprite;
    this.sprite.setVelocity(0, 0);
    this.sprite.disableBody(true, true);
    Object.values(this.spineViews).forEach((view) => view.setVisible(false));

    if (!this.playerHasSpine) {
      const fallbackGhost = this.scene.add.image(x, y - 44, 'player')
        .setCrop(0, 0, 32, 17)
        .setTint(UI_COLORS.grayLight)
        .setAlpha(0)
        .setDepth(19);
      const fallbackGlow = this.scene.add.ellipse(
        x,
        y - 52,
        52,
        48,
        UI_COLORS.primary,
        0.12,
      ).setDepth(18).setAlpha(0);
      this.defeatedFallback = fallbackGhost;
      this.defeatedGlow = fallbackGlow;
      this.fadeInGhost(fallbackGhost, fallbackGlow);
      return;
    }

    const ghost = this.spineViews.front;
    const ghostY = y - 45;
    ghost
      .setPosition(x, ghostY)
      .setDepth(19)
      .setColor(UI_COLORS.grayLight)
      .setAlpha(0)
      .setVisible(true);
    try {
      ghost.play('idle', true);
      ghost._currentAnim = 'idle';
    } catch {
      // The setup pose remains visible if a skin has no idle animation.
    }

    const glow = this.scene.add.ellipse(
      x,
      y - 58,
      58,
      64,
      UI_COLORS.primary,
      0.12,
    ).setDepth(18).setAlpha(0);
    this.defeatedGlow = glow;
    this.fadeInGhost(ghost, glow);
  }

  reviveAt(x: number, y: number, hp = Math.ceil(this.stats.maxHp * 0.5)): void {
    this.defeated = false;
    this.hitWindowActive = false;
    this.stats.hp = Phaser.Math.Clamp(Math.ceil(hp), 1, this.stats.maxHp);
    this.sprite.enableBody(true, x, y, true, true).setVelocity(0, 0);
    this.sprite.setAlpha(this.playerHasSpine ? 0 : 1).clearTint();

    if (this.defeatedFallback) {
      this.scene.tweens.killTweensOf(this.defeatedFallback);
      this.defeatedFallback.destroy();
      this.defeatedFallback = undefined;
    }
    if (this.defeatedGlow) {
      this.scene.tweens.killTweensOf(this.defeatedGlow);
      this.defeatedGlow.destroy();
      this.defeatedGlow = undefined;
    }

    if (this.playerHasSpine) {
      Object.entries(this.spineViews).forEach(([direction, view]) => {
        this.scene.tweens.killTweensOf(view);
        view
          .setPosition(x, y)
          .setDepth(5)
          .setColor(0xffffff)
          .setAlpha(1)
          .setVisible(direction === this.currentDirection);
      });
      this.currentSpineView = this.spineViews[this.currentDirection];
      try {
        this.currentSpineView.play('idle', true);
        this.currentSpineView._currentAnim = 'idle';
      } catch {
        // The setup pose remains visible if a skin has no idle animation.
      }
    }
    this.syncSpinePosition();
  }

  private fadeInGhost(
    ghost: SpineView | Phaser.GameObjects.Image,
    glow: Phaser.GameObjects.Ellipse,
  ): void {
    this.scene.tweens.add({
      targets: ghost,
      alpha: 0.32,
      delay: 300,
      duration: 420,
      ease: 'Sine.easeOut',
    });
    this.scene.tweens.add({
      targets: glow,
      alpha: { from: 0, to: 0.15 },
      scaleX: { from: 0.86, to: 1.08 },
      scaleY: { from: 0.86, to: 1.08 },
      delay: 300,
      duration: 1300,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private createSpineViews(
    skin: string,
    spawn: { x: number; y: number },
  ): Record<PlayerDirection, SpineView> {
    const views = {} as Record<PlayerDirection, SpineView>;
    const canRenderSpine = this.scene.game.renderer.type === Phaser.WEBGL;

    try {
      if (!canRenderSpine) throw new Error('Spine rendering requires WebGL');
      (['front', 'side', 'back'] as PlayerDirection[]).forEach((direction) => {
        const key = `int${direction.charAt(0).toUpperCase()}${direction.slice(1)}`;
        const spine = this.scene.add.spine(spawn.x, spawn.y, key, 'idle', true);
        spine.setScale(PLAYER_SCALE);
        spine.setDepth(5);
        spine.setSkinByName(skin);
        spine.setVisible(direction === 'front');
        views[direction] = spine;
      });

      this.installSpineFlipWorkaround(views.side);
      this.currentSpineView = views.front;
      this.playerHasSpine = true;
    } catch (error) {
      Object.values(views).forEach((view) => view?.destroy());
      if (canRenderSpine) console.warn('Spine loading failed, using fallback sprite:', error);
      this.sprite.setAlpha(1);
      this.playerHasSpine = false;
    }

    return views;
  }

  private installSpineFlipWorkaround(sideView: SpineView): void {
    sideView._wantFlipX = false;
    const sceneRenderer = this.scene.spine.sceneRenderer as SharedSpineRenderer | undefined;
    this.removeSpineFlipWorkaround = sceneRenderer
      ? registerSpineFlipWorkaround(sceneRenderer, sideView) ?? undefined
      : undefined;
    this.useSpineBoneFlip = Boolean(this.removeSpineFlipWorkaround);
  }

  private updatePresentation(velocityX: number, velocityY: number): void {
    if (!this.playerHasSpine) {
      if (velocityX < 0) {
        this.sprite.setFlipX(true);
        this.facingRight = false;
      } else if (velocityX > 0) {
        this.sprite.setFlipX(false);
        this.facingRight = true;
      }
      return;
    }

    const isMoving = velocityX !== 0 || velocityY !== 0;
    let nextDirection = this.currentDirection;
    if (isMoving) {
      if (Math.abs(velocityX) > Math.abs(velocityY)) nextDirection = 'side';
      else if (velocityY < 0) nextDirection = 'back';
      else nextDirection = 'front';
    }

    if (nextDirection !== this.currentDirection) {
      this.spineViews[this.currentDirection].setVisible(false);
      this.currentDirection = nextDirection;
      this.currentSpineView = this.spineViews[nextDirection];
      this.currentSpineView.setVisible(true);
    }

    const activeView = this.currentSpineView;
    if (!activeView) return;
    const animation = isMoving ? 'move' : 'idle';
    if (activeView._currentAnim !== animation) {
      try {
        activeView.play(animation, true);
        activeView._currentAnim = animation;
      } catch {
        try {
          activeView.play('idle', true);
          activeView._currentAnim = 'idle';
        } catch {
          // Some skins do not include every optional animation.
        }
      }
    }

    if (velocityX < 0) {
      this.spineViews.side._wantFlipX = true;
      if (!this.useSpineBoneFlip) this.spineViews.side.setScale(-PLAYER_SCALE, PLAYER_SCALE);
      this.facingRight = false;
    } else if (velocityX > 0) {
      this.spineViews.side._wantFlipX = false;
      if (!this.useSpineBoneFlip) this.spineViews.side.setScale(PLAYER_SCALE, PLAYER_SCALE);
      this.facingRight = true;
    }
  }

  private syncSpinePosition(): void {
    if (!this.playerHasSpine) return;
    Object.values(this.spineViews).forEach((spine) => {
      spine.setPosition(this.sprite.x, this.sprite.y);
    });
  }
}
