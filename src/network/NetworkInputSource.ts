import { INPUT_DOWN, INPUT_LEFT, INPUT_RIGHT, INPUT_UP } from '../game/PlayerController';

const INPUT_RESEND_MS = 50;

export class NetworkInputSource {
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly wasd: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private lastMask = -1;
  private lastSentAt = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onSend?: (mask: number) => void,
  ) {
    this.cursors = scene.input.keyboard!.createCursorKeys();
    this.wasd = {
      up: scene.input.keyboard!.addKey('W'),
      down: scene.input.keyboard!.addKey('S'),
      left: scene.input.keyboard!.addKey('A'),
      right: scene.input.keyboard!.addKey('D'),
    };
  }

  read(enabled = true): number {
    if (!enabled) return 0;
    let mask = 0;
    if (this.cursors.up.isDown || this.wasd.up.isDown) mask |= INPUT_UP;
    if (this.cursors.down.isDown || this.wasd.down.isDown) mask |= INPUT_DOWN;
    if (this.cursors.left.isDown || this.wasd.left.isDown) mask |= INPUT_LEFT;
    if (this.cursors.right.isDown || this.wasd.right.isDown) mask |= INPUT_RIGHT;
    return mask;
  }

  update(enabled = true): number {
    const mask = this.read(enabled);
    const now = performance.now();
    if (this.onSend && (mask !== this.lastMask || now - this.lastSentAt >= INPUT_RESEND_MS)) {
      this.onSend(mask);
      this.lastMask = mask;
      this.lastSentAt = now;
    }
    return mask;
  }

  stop(): void {
    if (this.onSend && this.lastMask !== 0) this.onSend(0);
    this.lastMask = 0;
    this.lastSentAt = performance.now();
  }
}
