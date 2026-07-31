import {
  ARENA_PLAYABLE_HALF_SIZE,
  RUNE_CHARGE_DURATION_MS,
  RUNE_CHARGE_RADIUS,
  RUNE_RETRY_DELAY_MS,
  RUNE_ROLL_INTERVAL_SECONDS,
  RUNE_SEQUENCE_LENGTH,
  RUNE_SHIELD_BLOCK_COUNT,
  TILE_SIZE,
} from '../config/constants';
import type { AudioManager } from '../game/AudioManager';
import type { EnemySystem } from '../game/EnemySystem';
import type { PlayerController } from '../game/PlayerController';
import { runeDropVisualState, runeTextureKey, type RuneDropPhase } from '../game/runeDrop';
import { MULTI_ATTACK_BOSS_DAMAGE_RATIO, multiAttackDamage } from '../game/runeAttack';
import { getRuneSpawnChance } from '../game/runeSpawn';
import type { EnemySprite, RuneType, RunProgress } from '../game/types';
import { MultiAttackPresentation } from '../objects/MultiAttackPresentation';
import { RuneActivationPresentation } from '../objects/RuneActivationPresentation';
import { UI_COLORS } from '../ui/theme';
import { createRuntimeId } from './gameProtocol';
import type { NetRuneState, RuneChallengePayload, RuneStateEvent } from './gameProtocol';

interface HostRune {
  id: string;
  type: RuneType;
  sprite: Phaser.Physics.Arcade.Sprite;
  chargingPlayerId?: string;
  chargeMs: number;
  spawnedAt: number;
  anchorY: number;
  available: boolean;
  phase: RuneDropPhase;
  gaugeBackground: Phaser.GameObjects.Rectangle;
  gaugeFill: Phaser.GameObjects.Rectangle;
}

interface HostChallenge extends RuneChallengePayload { index: number; attempt: number }

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
    for (const rune of this.runes.values()) {
      this.updateAppearance(rune);
      this.updateCharge(rune, delta);
    }
  }

  getShieldCharges(playerId: string): number { return this.shieldCharges.get(playerId) ?? 0; }

  cancelPlayer(playerId: string): void {
    this.shieldCharges.delete(playerId);
    for (const [challengeId, challenge] of this.challenges) {
      if (challenge.playerId !== playerId) continue;
      this.challenges.delete(challengeId);
      this.deliverRuneState(playerId, {
        event: 'complete', challengeId, attempt: challenge.attempt, index: challenge.index, cancelled: true,
      });
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
    if (!challengeId || !Number.isInteger(direction) || direction < 0 || direction > 3) return;
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.playerId !== playerId || Date.now() < challenge.retryAt) return;
    if (challenge.sequence[challenge.index] !== direction) {
      challenge.index = 0;
      challenge.attempt++;
      challenge.retryAt = Date.now() + RUNE_RETRY_DELAY_MS;
      this.deliverRuneState(playerId, {
        event: 'retry',
        challengeId,
        attempt: challenge.attempt,
        retryAt: challenge.retryAt,
      });
      return;
    }
    challenge.index++;
    this.deliverRuneState(playerId, {
      event: 'progress', challengeId, attempt: challenge.attempt, index: challenge.index,
    });
    if (challenge.index < challenge.sequence.length) return;
    this.challenges.delete(challengeId);
    this.deliverRuneState(playerId, {
      event: 'complete', challengeId, attempt: challenge.attempt, index: challenge.index,
    });
    this.activate(playerId, challenge.runeType);
  }

  snapshot(): NetRuneState[] {
    return [...this.runes.values()].map((rune) => ({
      id: rune.id,
      type: rune.type,
      x: rune.sprite.x,
      y: rune.sprite.y,
      phase: rune.phase,
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
    const boundary = ARENA_PLAYABLE_HALF_SIZE - TILE_SIZE;
    const x = Phaser.Math.Clamp(player.controller.sprite.x + Math.cos(angle) * distance, -boundary, boundary);
    const y = Phaser.Math.Clamp(player.controller.sprite.y + Math.sin(angle) * distance, -boundary, boundary);
    const sprite = this.scene.physics.add.sprite(x, y, 'runeEmbedded').setDepth(7).setDisplaySize(62, 62);
    const gaugeBackground = this.scene.add.rectangle(x, y + 40, 58, 8, UI_COLORS.panelDeep)
      .setDepth(29).setVisible(false);
    const gaugeFill = this.scene.add.rectangle(x - 28, y + 40, 1, 6, UI_COLORS.primary)
      .setOrigin(0, 0.5).setDepth(30).setVisible(false);
    const rune: HostRune = {
      id: `r${this.nextId++}`,
      type: Math.random() < 0.5 ? 'multiAttack' : 'shield',
      sprite,
      chargeMs: 0,
      spawnedAt: this.scene.time.now,
      anchorY: y,
      available: false,
      phase: 'embedded',
      gaugeBackground,
      gaugeFill,
    };
    this.runes.set(rune.id, rune);
    this.scene.tweens.add({ targets: sprite, alpha: 0.78, duration: 850, yoyo: true, repeat: -1 });
    this.toast(`${rune.type === 'shield' ? '보호막' : '다중 공격'} 룬 등장 · 3초 뒤 활성화`);
  }

  private updateAppearance(rune: HostRune): void {
    const visual = runeDropVisualState(this.scene.time.now - rune.spawnedAt);
    if (rune.phase !== visual.phase) {
      rune.phase = visual.phase;
      rune.sprite.setTexture(runeTextureKey(visual.phase));
    }
    rune.available = visual.available;
    rune.sprite.y = rune.anchorY + visual.offsetY;
  }

  private updateCharge(rune: HostRune, delta: number): void {
    if (!rune.sprite.active) return;
    if (!rune.available) {
      rune.chargingPlayerId = undefined;
      rune.chargeMs = 0;
      rune.gaugeBackground.setVisible(false);
      rune.gaugeFill.setVisible(false);
      return;
    }
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
      challengeId: createRuntimeId('rune'),
      playerId: target.id,
      runeType: rune.type,
      sequence: Array.from({ length: RUNE_SEQUENCE_LENGTH }, () => Phaser.Math.Between(0, 3)),
      retryAt: 0,
      index: 0,
      attempt: 0,
    };
    this.challenges.set(challenge.challengeId, challenge);
    this.deliverRuneState(target.id, { event: 'challenge', challenge });
  }

  private activate(playerId: string, runeType: RuneType): void {
    const player = this.players.get(playerId);
    if (!player) return;
    RuneActivationPresentation.play(this.scene, runeType);
    if (runeType === 'shield') {
      this.shieldCharges.set(playerId, RUNE_SHIELD_BLOCK_COUNT);
      this.audio.effects.shield.play();
      this.broadcast('rune-effect', { playerId, runeType }, true);
      this.toast(`${this.playerName(playerId)} 보호막 · 공격 10회 방어`);
      return;
    }
    const targets = this.enemies.getActiveEnemies();
    this.audio.effects.multiAttack.play();
    this.broadcast('rune-effect', { playerId, runeType }, true);
    MultiAttackPresentation.play(this.scene, player.sprite.x, player.sprite.y, {
      targets,
      onImpact: (enemy: EnemySprite) => {
        if (!enemy.active || player.isBossSuccessActive) return;
        this.enemies.damageEnemy(enemy, multiAttackDamage(enemy, player.stats.level));
      },
    });
    this.toast(
      `${this.playerName(playerId)} 다중 공격 · 일반 몬스터 전멸, ` +
      `보스 최대 HP ${MULTI_ATTACK_BOSS_DAMAGE_RATIO * 100}% 강타`,
    );
  }

  private livingPlayers(): Array<{ id: string; controller: PlayerController }> {
    return [...this.players.entries()]
      .filter(([, player]) => player.stats.hp > 0 && player.sprite.active)
      .map(([id, controller]) => ({ id, controller }));
  }

  private playerName(playerId: string): string {
    return playerId.slice(0, 6);
  }

  private deliverRuneState(playerId: string, event: RuneStateEvent): void {
    this.deliver(playerId, 'rune-state', event, true);
  }
}
