import { WORLD_SIZE } from '../config/constants';

const CAMERA_SPEED = 520;

/** Converts arrow-key input into a bounded free camera after the player dies. */
export class DeathCameraController {
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private active = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.cursors = scene.input.keyboard!.createCursorKeys();
    const keyboard = scene.input.keyboard!;
    keyboard.on('keydown-LEFT', this.panLeft, this);
    keyboard.on('keydown-RIGHT', this.panRight, this);
    keyboard.on('keydown-UP', this.panUp, this);
    keyboard.on('keydown-DOWN', this.panDown, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard.off('keydown-LEFT', this.panLeft, this);
      keyboard.off('keydown-RIGHT', this.panRight, this);
      keyboard.off('keydown-UP', this.panUp, this);
      keyboard.off('keydown-DOWN', this.panDown, this);
    });
  }

  start(x: number, y: number): void {
    const camera = this.scene.cameras.main;
    camera.stopFollow();
    camera.centerOn(x, y);
    this.active = true;
  }

  resumeFollowing(target: Phaser.GameObjects.GameObject): void {
    this.active = false;
    this.scene.cameras.main.startFollow(target, true, 0.24, 0.24);
  }

  update(delta: number): void {
    if (!this.active) return;
    let directionX = 0;
    let directionY = 0;
    if (this.cursors.left.isDown) directionX--;
    if (this.cursors.right.isDown) directionX++;
    if (this.cursors.up.isDown) directionY--;
    if (this.cursors.down.isDown) directionY++;
    if (!directionX && !directionY) return;
    if (directionX && directionY) {
      directionX *= 0.707;
      directionY *= 0.707;
    }

    const distance = CAMERA_SPEED * (delta / 1000);
    this.pan(directionX * distance, directionY * distance);
  }

  private readonly panLeft = (): void => this.pan(-64, 0);
  private readonly panRight = (): void => this.pan(64, 0);
  private readonly panUp = (): void => this.pan(0, -64);
  private readonly panDown = (): void => this.pan(0, 64);

  private pan(deltaX: number, deltaY: number): void {
    if (!this.active) return;
    const camera = this.scene.cameras.main;
    const viewWidth = camera.width / camera.zoom;
    const viewHeight = camera.height / camera.zoom;
    const halfWorld = WORLD_SIZE / 2;
    camera.setScroll(
      this.clampScroll(camera.scrollX + deltaX, -halfWorld, halfWorld - viewWidth),
      this.clampScroll(camera.scrollY + deltaY, -halfWorld, halfWorld - viewHeight),
    );
  }

  private clampScroll(value: number, minimum: number, maximum: number): number {
    if (minimum > maximum) return (minimum + maximum) / 2;
    return Phaser.Math.Clamp(value, minimum, maximum);
  }
}
