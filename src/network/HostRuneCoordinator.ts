import {
  RUNE_CHARGE_DURATION_MS,
  RUNE_CHARGE_RADIUS,
  RUNE_RETRY_DELAY_MS,
  RUNE_ROLL_INTERVAL_SECONDS,
  RUNE_SEQUENCE_LENGTH,
  RUNE_SHIELD_BLOCK_COUNT,
  TILE_SIZE,
  WORLD_SIZE,
} from '../config/constants';
import type { AudioManager } from '../game/AudioManager';
import type { EnemySystem } from '../game/EnemySystem';
import type { PlayerController } from '../game/PlayerController';
import { getRuneSpawnChance } from '../game/runeSpawn';
import type { EnemySprite, RuneType, RunProgress } from '../game/types';
import { MultiAttackPresentation } from '../objects/MultiAttackPresentation';
import { UI_COLORS } from '../ui/theme';
import type { NetRuneState, RuneChallengePayload } from './gameProtocol';

interface HostRune {
  id: string;
  type: RuneType;
  sprite: Phaser.Physics.Arcade.Sprite;
  chargingPlayerId?: string;
  chargeMs: number;
  gaugeBackground: Phaser.GameObjects.Rectangle;
  gaugeFill: Phaser.GameObjects.Rectangle;
}

interface HostChallenge extends RuneChallengePayload { index: number }

export class HostRuneCoordinator {
  private readonly runes = new Map<string, HostRune>();
  private readonly challenges = new Map<string, HostChallenge>();
  private readonly shieldCharges = new Map<string, number>();
  private nextId = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly players: Map<string, PlayerController>,
    private readonly progress: RunProgress,
    private readonly enemies: EnemySystem,
    private readonly audio: AudioManager,
    private readonly deliver: (playerId: string, kind: string, payload: unknown, reliable?: boolean) => void,
    private readonly broadcast: (kind: string, payload: unknown, reliable?: boolean) => void,
    private readonly toast: (message: string) => void,
  ) {}

  update(delta: number): void {
    this.rollSpawn();
    for (const rune of this.runes.values()) this.updateCharge(rune, delta);
  }

  getShieldCharges(playerId: string): number { return this.shieldCharges.get(playerId) ?? 0; }

  cancelPlayer(playerId: string): void {
    this.shieldCharges.delete(playerId);
    for (const [challengeId, challenge] of this.challenges) {
      if (challenge.playerId !== playerId) continue;
      this.challenges.delete(challengeId);
      this.deliver(playerId, 'rune-complete', { challengeId, cancelled: true }, true);
    }
  }

  tryBlock(playerId: string): boolean {
    const charges = this.getShieldCharges(playerId);
    if (charges <= 0) return false;
    this.shieldCharges.set(playerId, charges - 1);
    this.audio.effects.spring.play();
    return true;
  }

  handleInput(playerId: string, challengeId: string, direction: number): void {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.playerId !== playerId || Date.now() < challenge.retryAt) return;
    if (challenge.sequence[challenge.index] !== direction) {
      challenge.index = 0;
      challenge.retryAt = Date.now() + RUNE_RETRY_DELAY_MS;
      this.deliver(playerId, 'rune-retry', { challengeId, retryAt: challenge.retryAt }, true);
      return;
    }
    challenge.index++;
    this.deliver(playerId, 'rune-progress', { challengeId, index: challenge.index }, true);
    if (challenge.index < challenge.sequence.length) return;
    this.challenges.delete(challengeId);
    this.deliver(playerId, 'rune-complete', { challengeId }, true);
    this.activate(playerId, challenge.runeType);
  }

  snapshot(): NetRuneState[] {
    return [...this.runes.values()].map((rune) => ({
      id: rune.id,
      type: rune.type,
      x: rune.sprite.x,
      y: rune.sprite.y,
      chargingPlayerId: rune.chargingPlayerId,
      chargeRatio: rune.chargeMs / RUNE_CHARGE_DURATION_MS,
    }));
  }

  private rollSpawn(): void {
    const interval = Math.floor(this.progress.gameTime / RUNE_ROLL_INTERVAL_SECONDS);
    if (interval <= this.progress.lastRuneRollInterval) return;
    this.progress.lastRuneRollInterval = interval;
    const spawnChance = getRuneSpawnChance(this.enemies.getActiveEnemies().length);
    if (Math.random() >= spawnChance) return;
    const living = this.livingPlayers();
    if (!living.length) return;
    const player = Phaser.Utils.Array.GetRandom(living);
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const distance = Phaser.Math.Between(190, 330);
    const boundary = WORLD_SIZE / 2 - TILE_SIZE;
    const x = Phaser.Math.Clamp(player.controller.sprite.x + Math.cos(angle) * distance, -boundary, boundary);
    const y = Phaser.Math.Clamp(player.controller.sprite.y + Math.sin(angle) * distance, -boundary, boundary);
    const sprite = this.scene.physics.add.sprite(x, y, 'rune').setDepth(7).setDisplaySize(62, 62);
    const gaugeBackground = this.scene.add.rectangle(x, y + 40, 58, 8, UI_COLORS.panelDeep)
      .setDepth(29).setVisible(false);
    const gaugeFill = this.scene.add.rectangle(x - 28, y + 40, 1, 6, UI_COLORS.primary)
      .setOrigin(0, 0.5).setDepth(30).setVisible(false);
    const rune: HostRune = {
      id: `r${this.nextId++}`,
      type: Math.random() < 0.5 ? 'multiAttack' : 'shield',
      sprite,
      chargeMs: 0,
      gaugeBackground,
      gaugeFill,
    };
    this.runes.set(rune.id, rune);
    this.scene.tweens.add({ targets: sprite, alpha: 0.78, duration: 850, yoyo: true, repeat: -1 });
    this.toast(`${rune.type === 'shield' ? '보호막' : '다중 공격'} 룬 등장`);
  }

  private updateCharge(rune: HostRune, delta: number): void {
    if (!rune.sprite.active) return;
    const target = this.livingPlayers()
      .map((entry) => ({
        ...entry,
        distance: Phaser.Math.Distance.Between(entry.controller.sprite.x, entry.controller.sprite.y, rune.sprite.x, rune.sprite.y),
      }))
      .filter((entry) => entry.distance <= RUNE_CHARGE_RADIUS)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!target) {
      rune.chargingPlayerId = undefined;
      rune.chargeMs = 0;
      rune.gaugeBackground.setVisible(false);
      rune.gaugeFill.setVisible(false);
      return;
    }
    if (rune.chargingPlayerId !== target.id) {
      rune.chargingPlayerId = target.id;
      rune.chargeMs = 0;
    }
    rune.chargeMs = Math.min(RUNE_CHARGE_DURATION_MS, rune.chargeMs + delta);
    const ratio = rune.chargeMs / RUNE_CHARGE_DURATION_MS;
    const size = 62 + 8 * ratio;
    rune.sprite.setDisplaySize(size, size).setAlpha(0.78 + 0.22 * ratio);
    rune.gaugeBackground.setPosition(rune.sprite.x, rune.sprite.y + 40).setVisible(true);
    rune.gaugeFill.setPosition(rune.sprite.x - 28, rune.sprite.y + 40)
      .setDisplaySize(Math.max(1, 56 * ratio), 6).setVisible(true);
    if (rune.chargeMs < RUNE_CHARGE_DURATION_MS) return;
    this.runes.delete(rune.id);
    rune.sprite.destroy();
    rune.gaugeBackground.destroy();
    rune.gaugeFill.destroy();
    const challenge: HostChallenge = {
      challengeId: crypto.randomUUID(),
      playerId: target.id,
      runeType: rune.type,
      sequence: Array.from({ length: RUNE_SEQUENCE_LENGTH }, () => Phaser.Math.Between(0, 3)),
      retryAt: 0,
      index: 0,
    };
    this.challenges.set(challenge.challengeId, challenge);
    this.deliver(target.id, 'rune-challenge', challenge, true);
  }

  private activate(playerId: string, runeType: RuneType): void {
    const player = this.players.get(playerId);
    if (!player) return;
    if (runeType === 'shield') {
      this.shieldCharges.set(playerId, RUNE_SHIELD_BLOCK_COUNT);
      this.audio.effects.shield.play();
      this.broadcast('rune-effect', { playerId, runeType }, true);
      this.toast(`${this.playerName(playerId)} 보호막 · 공격 10회 방어`);
      return;
    }
    const targets = this.enemies.getActiveEnemies();
    const baseDamage = Math.max(100, player.stats.level * 20);
    this.audio.effects.multiAttack.play();
    this.broadcast('rune-effect', { playerId, runeType }, true);
    MultiAttackPresentation.play(this.scene, player.sprite.x, player.sprite.y, {
      targets,
      onImpact: (enemy: EnemySprite) => {
        if (!enemy.active) return;
        const damage = enemy.enemyType === 'boss'
          ? Math.max(baseDamage, Math.ceil(enemy.maxHp * 0.1))
          : enemy.hp;
        this.enemies.damageEnemy(enemy, damage);
      },
    });
    this.toast(`${this.playerName(playerId)} 다중 공격 발동`);
  }

  private livingPlayers(): Array<{ id: string; controller: PlayerController }> {
    return [...this.players.entries()]
      .filter(([, player]) => player.stats.hp > 0 && player.sprite.active)
      .map(([id, controller]) => ({ id, controller }));
  }

  private playerName(playerId: string): string {
    return playerId.slice(0, 6);
  }
}
