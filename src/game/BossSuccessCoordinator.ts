import type { PlayerController } from './PlayerController';
import type { WeaponSystem } from './WeaponSystem';
import {
  BOSS_SUCCESS_TICK_MS,
  bossSuccessDamage,
  isInsideBossSuccessRange,
} from './playerSuccess';
import type { EnemySprite } from './types';

export interface BossSuccessParticipant {
  player: PlayerController;
  weapons: WeaponSystem;
}

/** Coordinates the boss-kill celebration without giving clients combat authority. */
export class BossSuccessCoordinator {
  private readonly active = new Map<PlayerController, WeaponSystem>();
  private tickElapsed = 0;
  private destroyed = false;

  constructor(
    scene: Phaser.Scene,
    private readonly participants: () => BossSuccessParticipant[],
    private readonly getEnemies: () => EnemySprite[],
    private readonly damageEnemy: (enemy: EnemySprite, damage: number) => void,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  celebrate(): void {
    if (this.destroyed) return;
    this.tickElapsed = 0;
    this.participants().forEach(({ player, weapons }) => {
      if (player.stats.hp <= 0 || !player.sprite.active) return;
      weapons.pauseForBossSuccess();
      this.active.set(player, weapons);
      player.enterBossSuccessState(() => this.cancel(player));
    });
  }

  update(delta: number): void {
    if (this.destroyed || this.active.size === 0) return;
    this.tickElapsed += Math.max(0, delta);
    const tickCount = Math.min(5, Math.floor(this.tickElapsed / BOSS_SUCCESS_TICK_MS));
    if (tickCount === 0) return;
    this.tickElapsed %= BOSS_SUCCESS_TICK_MS;

    for (let tick = 0; tick < tickCount; tick++) {
      for (const [player] of [...this.active]) {
        if (!player.isBossSuccessActive) {
          this.cancel(player);
          continue;
        }
        if (player.stats.hp <= 0 || !player.sprite.active) {
          this.remove(player);
          continue;
        }
        const damage = bossSuccessDamage(player.stats.level);
        this.getEnemies().forEach((enemy) => {
          if (!enemy.active || !isInsideBossSuccessRange(
            player.sprite.x,
            player.sprite.y,
            enemy.x,
            enemy.y,
          )) return;
          this.damageEnemy(enemy, damage);
        });
      }
    }
  }

  remove(player: PlayerController): void {
    if (!this.active.delete(player)) return;
    player.exitBossSuccessState(false);
    if (this.active.size === 0) this.tickElapsed = 0;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    [...this.active.keys()].forEach((player) => player.exitBossSuccessState(false));
    this.active.clear();
    this.tickElapsed = 0;
  }

  private cancel(player: PlayerController): void {
    const weapons = this.active.get(player);
    if (!weapons) return;
    this.active.delete(player);
    if (player.stats.hp > 0 && player.sprite.active) weapons.resumeAfterBossSuccess();
    if (this.active.size === 0) this.tickElapsed = 0;
  }
}
