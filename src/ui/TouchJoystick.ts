import { INPUT_DOWN, INPUT_LEFT, INPUT_RIGHT, INPUT_UP } from '../game/PlayerController';

export const TOUCH_JOYSTICK_DIAMETER = 112;
export const TOUCH_JOYSTICK_DRAG_RADIUS = 42;
export const TOUCH_JOYSTICK_DEAD_ZONE = 10;

export function shouldShowTouchControls(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches === true
    || (navigator.maxTouchPoints ?? 0) > 0;
}

/** Converts a pointer displacement into the same 8-direction bit mask as WASD. */
export function joystickVectorToMask(dx: number, dy: number): number {
  if (Math.hypot(dx, dy) < TOUCH_JOYSTICK_DEAD_ZONE) return 0;
  const angle = Math.atan2(dy, dx);
  const octant = Math.round(angle / (Math.PI / 4));
  const x = Math.cos(octant * Math.PI / 4);
  const y = Math.sin(octant * Math.PI / 4);
  let mask = 0;
  if (x < -0.25) mask |= INPUT_LEFT;
  if (x > 0.25) mask |= INPUT_RIGHT;
  if (y < -0.25) mask |= INPUT_UP;
  if (y > 0.25) mask |= INPUT_DOWN;
  return mask;
}

/** Fixed lower-right touch controller shared by single-player and multiplayer. */
export class TouchJoystick {
  private readonly base: Phaser.GameObjects.Arc;
  private readonly knob: Phaser.GameObjects.Arc;
  private activePointerId: number | null = null;
  private enabled = true;
  private mask = 0;
  private destroyed = false;
  readonly visible: boolean;

  constructor(private readonly scene: Phaser.Scene) {
    this.visible = shouldShowTouchControls();
    const { width, height } = scene.scale.gameSize;
    const position = this.position(width, height);
    this.base = scene.add.circle(
      position.x,
      position.y,
      TOUCH_JOYSTICK_DIAMETER / 2,
      0x10141d,
      0.42,
    ).setScrollFactor(0).setDepth(3900).setVisible(this.visible);
    this.base.setStrokeStyle(2, 0xffffff, 0.22);
    this.knob = scene.add.circle(position.x, position.y, 24, 0xffffff, 0.28)
      .setScrollFactor(0).setDepth(3901).setVisible(this.visible);
    if (this.visible) {
      this.base.setInteractive({ useHandCursor: false });
      this.base.on('pointerdown', this.handlePointerDown, this);
      scene.input.on('pointermove', this.handlePointerMove, this);
      scene.input.on('pointerup', this.handlePointerUp, this);
      scene.input.on('pointerupoutside', this.handlePointerUp, this);
      scene.input.on('pointercancel', this.handlePointerUp, this);
    }
    scene.scale.on('resize', this.handleResize, this);
    window.addEventListener('blur', this.handleBlur);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  get engaged(): boolean {
    return this.activePointerId !== null;
  }

  read(): number {
    return this.enabled && this.engaged ? this.mask : 0;
  }

  setEnabled(enabled: boolean): void {
    if (this.destroyed) return;
    this.enabled = enabled;
    this.base.setAlpha(enabled ? 1 : 0.45);
    this.knob.setAlpha(enabled ? 1 : 0.45);
    if (!enabled) this.reset();
  }

  reset(): void {
    this.activePointerId = null;
    this.mask = 0;
    if (!this.destroyed) this.knob.setPosition(this.base.x, this.base.y);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.reset();
    this.destroyed = true;
    this.scene.scale.off('resize', this.handleResize, this);
    this.scene.input.off('pointermove', this.handlePointerMove, this);
    this.scene.input.off('pointerup', this.handlePointerUp, this);
    this.scene.input.off('pointerupoutside', this.handlePointerUp, this);
    this.scene.input.off('pointercancel', this.handlePointerUp, this);
    window.removeEventListener('blur', this.handleBlur);
    this.base.destroy();
    this.knob.destroy();
  }

  private readonly handleBlur = (): void => this.reset();

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.enabled || this.activePointerId !== null) return;
    this.activePointerId = pointer.id;
    this.updatePointer(pointer);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.activePointerId) return;
    this.updatePointer(pointer);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id === this.activePointerId) this.reset();
  }

  private updatePointer(pointer: Phaser.Input.Pointer): void {
    const dx = pointer.x - this.base.x;
    const dy = pointer.y - this.base.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance > TOUCH_JOYSTICK_DRAG_RADIUS
      ? TOUCH_JOYSTICK_DRAG_RADIUS / distance
      : 1;
    const limitedX = dx * scale;
    const limitedY = dy * scale;
    this.knob.setPosition(this.base.x + limitedX, this.base.y + limitedY);
    this.mask = joystickVectorToMask(limitedX, limitedY);
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    const position = this.position(gameSize.width, gameSize.height);
    this.base.setPosition(position.x, position.y);
    this.reset();
  }

  private position(width: number, height: number): { x: number; y: number } {
    return { x: width - 74, y: height - 74 };
  }
}
