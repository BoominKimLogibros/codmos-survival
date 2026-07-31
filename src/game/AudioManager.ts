import type { AudioEffects } from './types';

/** Centralized lifecycle for gameplay music and sound effects. */
export class AudioManager {
  readonly effects: AudioEffects;
  readonly music: Phaser.Sound.BaseSound;

  constructor(private readonly scene: Phaser.Scene) {
    this.effects = {
      coin: scene.sound.add('coinSfx', { volume: 0.3 }),
      fail: scene.sound.add('failSfx', { volume: 0.4 }),
      jump: scene.sound.add('jumpSfx', { volume: 0.2 }),
      explosion: scene.sound.add('explosionSfx', { volume: 0.3 }),
      boing: scene.sound.add('boingSfx', { volume: 0.2 }),
      spring: scene.sound.add('springSfx', { volume: 0.2 }),
      bomb: scene.sound.add('bombSfx', { volume: 0.3 }),
      scream: scene.sound.add('screamSfx', { volume: 0.25 }),
      thump: scene.sound.add('thumpSfx', { volume: 0.25 }),
      multiAttack: scene.sound.add('runeMultiAttackSfx', { volume: 0.35 }),
      shield: scene.sound.add('runeShieldSfx', { volume: 0.35 }),
    };

    const musicKeys = ['bgmCyber', 'bgmSpace', 'bgmSea'];
    const musicKey = musicKeys[Phaser.Math.Between(0, musicKeys.length - 1)];
    this.music = scene.sound.add(musicKey, { volume: 0.15, loop: true });
    this.music.play();

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  pause(): void {
    if (this.music.isPlaying) this.music.pause();
  }

  resume(): void {
    if (this.music.isPaused) this.music.resume();
  }

  stop(): void {
    this.music.stop();
  }

  destroy(): void {
    this.music.stop();
    this.music.destroy();
    Object.values(this.effects).forEach((effect) => effect.destroy());
  }
}
