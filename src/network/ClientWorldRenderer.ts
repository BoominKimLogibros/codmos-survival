import { PlayerController } from '../game/PlayerController';
import type { PlayerStats } from '../game/types';
import { ExplosionPresentation } from '../objects/ExplosionPresentation';
import { updateAuraPresentation } from '../objects/AuraPresentation';
import { MultiAttackPresentation } from '../objects/MultiAttackPresentation';
import { ReviveMarker } from '../objects/ReviveMarker';
import { UI_COLORS, uiTextStyle } from '../ui/theme';
import type {
  CombatEffectPayload,
  NetEnemyState,
  NetAuraState,
  NetObjectState,
  NetPlayerState,
  NetReviveState,
  NetRuneState,
  WorldSnapshot,
} from './gameProtocol';

interface PlayerView {
  controller: PlayerController;
  label: Phaser.GameObjects.Text;
  shield: Phaser.GameObjects.Text;
  target?: NetPlayerState;
  targetAt: number;
  defeated: boolean;
  hitRevision: number;
}

interface EnemyView {
  sprite: Phaser.GameObjects.Sprite;
  hpBg: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Rectangle;
  target: NetEnemyState;
  targetAt: number;
  hitRevision: number;
}

interface ObjectView {
  sprite: Phaser.GameObjects.Sprite;
  target: NetObjectState;
  targetAt: number;
}

interface RuneView {
  sprite: Phaser.GameObjects.Sprite;
  gaugeBackground: Phaser.GameObjects.Rectangle;
  gaugeFill: Phaser.GameObjects.Rectangle;
}

interface AuraView {
  sprite: Phaser.GameObjects.Image;
  scale: number;
}

const CLIENT_RENDER_MARGIN = 120;

export class ClientWorldRenderer {
  private readonly players = new Map<string, PlayerView>();
  private readonly enemies = new Map<string, EnemyView>();
  private readonly objects = new Map<string, ObjectView>();
  private readonly runes = new Map<string, RuneView>();
  private readonly auras = new Map<string, AuraView>();
  private readonly revives = new Map<string, ReviveMarker>();
  private readonly canonicalEnemies = new Map<string, NetEnemyState>();
  private readonly canonicalObjects = new Map<string, NetObjectState>();
  private readonly canonicalRunes = new Map<string, NetRuneState>();
  private latestPlayers: NetPlayerState[] = [];
  private latestProgress = { gameTime: 0, killCount: 0, normalGeneration: 1, bossGeneration: 0 };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly localPlayerId: string,
    private readonly localInput: () => number,
  ) {}

  get playerStates(): NetPlayerState[] { return this.latestPlayers; }
  get progress(): typeof this.latestProgress { return this.latestProgress; }
  get localPlayer(): PlayerController | undefined { return this.players.get(this.localPlayerId)?.controller; }
  get localAlive(): boolean { return this.latestPlayers.find((player) => player.id === this.localPlayerId)?.alive ?? true; }

  apply(snapshot: WorldSnapshot): void {
    this.latestProgress = snapshot.progress;
    this.latestPlayers = snapshot.players;
    snapshot.players.forEach((state) => this.queuePlayer(state));

    if (snapshot.keyframe) {
      this.removeAbsent(this.canonicalEnemies, snapshot.enemies.map((item) => item.id), (id) => this.destroyEnemy(id));
      this.removeAbsent(this.canonicalObjects, snapshot.objects.map((item) => item.id), (id) => this.destroyObject(id));
      this.removeAbsent(this.canonicalRunes, snapshot.runes.map((item) => item.id), (id) => this.destroyRune(id));
    }
    snapshot.removedEnemies.forEach((id) => this.destroyEnemy(id));
    snapshot.removedObjects.forEach((id) => this.destroyObject(id));
    snapshot.removedRunes.forEach((id) => this.destroyRune(id));
    snapshot.enemies.forEach((state) => { this.canonicalEnemies.set(state.id, state); this.upsertEnemy(state); });
    snapshot.objects.forEach((state) => { this.canonicalObjects.set(state.id, state); this.upsertObject(state); });
    snapshot.runes.forEach((state) => { this.canonicalRunes.set(state.id, state); this.upsertRune(state); });
    this.syncAuras(snapshot.auras ?? []);
    this.syncRevives(snapshot.revives ?? []);
  }

  update(delta: number): void {
    const now = performance.now();
    const fastBlend = 1 - Math.exp(-delta / 32);
    const correctionBlend = 1 - Math.exp(-delta / 70);
    for (const [id, view] of this.players) {
      const state = view.target;
      if (!state) continue;
      if (id === this.localPlayerId && state.alive) {
        const ageSeconds = Math.min(75, now - view.targetAt) / 1000;
        const serverX = state.x + state.vx * ageSeconds;
        const serverY = state.y + state.vy * ageSeconds;
        const dx = serverX - view.controller.sprite.x;
        const dy = serverY - view.controller.sprite.y;
        const error = Math.hypot(dx, dy);
        if (error > 120) view.controller.applyNetworkState(serverX, serverY, state.vx, state.vy);
        else if (error > 4) view.controller.sprite.setPosition(
          Phaser.Math.Linear(view.controller.sprite.x, serverX, correctionBlend),
          Phaser.Math.Linear(view.controller.sprite.y, serverY, correctionBlend),
        );
        view.controller.update();
      } else if (state.alive) {
        const ageSeconds = Math.min(100, now - view.targetAt) / 1000;
        const targetX = state.x + state.vx * ageSeconds;
        const targetY = state.y + state.vy * ageSeconds;
        const error = Phaser.Math.Distance.Between(
          view.controller.sprite.x,
          view.controller.sprite.y,
          targetX,
          targetY,
        );
        const x = error > 180 ? targetX : Phaser.Math.Linear(view.controller.sprite.x, targetX, fastBlend);
        const y = error > 180 ? targetY : Phaser.Math.Linear(view.controller.sprite.y, targetY, fastBlend);
        view.controller.applyNetworkState(x, y, state.vx, state.vy);
      }
      view.label.setPosition(view.controller.sprite.x, view.controller.sprite.y - 54);
      view.shield.setPosition(view.controller.sprite.x + 30, view.controller.sprite.y - 34)
        .setText(state.shield > 0 ? `방어 ${state.shield}` : '').setVisible(state.shield > 0);
      this.auras.get(id)?.sprite.setPosition(view.controller.sprite.x, view.controller.sprite.y);
    }
    this.auras.forEach((aura) => {
      updateAuraPresentation(aura.sprite, aura.sprite.x, aura.sprite.y, aura.scale, now);
    });
    for (const view of this.enemies.values()) {
      const state = view.target;
      const ageSeconds = Math.min(100, now - view.targetAt) / 1000;
      const targetX = state.x + state.vx * ageSeconds;
      const targetY = state.y + state.vy * ageSeconds;
      view.sprite.x = Phaser.Math.Linear(view.sprite.x, targetX, fastBlend);
      view.sprite.y = Phaser.Math.Linear(view.sprite.y, targetY, fastBlend);
      view.sprite.setFlipX(state.vx < 0);
      const visible = this.inCamera(view.sprite.x, view.sprite.y, CLIENT_RENDER_MARGIN);
      view.sprite.setVisible(visible);
      view.hpBg.setVisible(visible);
      view.hpBar.setVisible(visible);
      if (!visible) continue;
      const width = Math.max(42, Math.min(120, state.maxHp / 3));
      const ratio = Math.max(0, state.hp / Math.max(1, state.maxHp));
      view.hpBg.setPosition(view.sprite.x, view.sprite.y - view.sprite.displayHeight / 2 - 9).setDisplaySize(width, 6);
      view.hpBar.setPosition(view.sprite.x - width / 2, view.hpBg.y).setDisplaySize(Math.max(1, width * ratio), 4);
    }
    for (const view of this.objects.values()) {
      const state = view.target;
      const ageSeconds = Math.min(100, now - view.targetAt) / 1000;
      const targetX = state.x + (state.vx ?? 0) * ageSeconds;
      const targetY = state.y + (state.vy ?? 0) * ageSeconds;
      view.sprite.x = Phaser.Math.Linear(view.sprite.x, targetX, fastBlend);
      view.sprite.y = Phaser.Math.Linear(view.sprite.y, targetY, fastBlend);
      view.sprite.setRotation(state.rotation ?? 0).setScale(state.scale ?? 1);
      view.sprite.setVisible(this.inCamera(view.sprite.x, view.sprite.y, CLIENT_RENDER_MARGIN));
    }
  }

  playMultiAttack(playerId: string): void {
    const player = this.players.get(playerId)?.controller;
    if (!player) return;
    MultiAttackPresentation.play(this.scene, player.sprite.x, player.sprite.y, {
      targets: [],
      onImpact: () => undefined,
    });
  }

  playCombatEffect(effect: CombatEffectPayload, onImpact?: () => void): void {
    if (effect.type !== 'explosion') return;
    if ([
      effect.startX,
      effect.startY,
      effect.x,
      effect.y,
      effect.radius,
      effect.flightDurationMs,
      effect.fuseDurationMs,
    ]
      .every(Number.isFinite)) return;
    ExplosionPresentation.play(this.scene, effect, onImpact);
  }

  destroy(): void {
    this.players.forEach((view) => {
      view.controller.sprite.destroy();
      view.label.destroy();
      view.shield.destroy();
    });
    this.enemies.forEach((view) => { view.sprite.destroy(); view.hpBg.destroy(); view.hpBar.destroy(); });
    this.objects.forEach((view) => view.sprite.destroy());
    this.runes.forEach((rune) => {
      rune.sprite.destroy();
      rune.gaugeBackground.destroy();
      rune.gaugeFill.destroy();
    });
    this.auras.forEach((aura) => aura.sprite.destroy());
    this.revives.forEach((revive) => revive.destroy());
  }

  private queuePlayer(state: NetPlayerState): void {
    let view = this.players.get(state.id);
    if (!view) {
      const controller = new PlayerController(this.scene, {
        skin: state.skin,
        spawn: { x: state.x, y: state.y },
        // Client replicas predict movement only. Recovery and every other stat
        // mutation remain authoritative on the host and arrive in snapshots.
        isRunActive: () => false,
        inputProvider: state.id === this.localPlayerId ? this.localInput : () => 0,
        cameraFollow: state.id === this.localPlayerId,
        cameraLerp: state.id === this.localPlayerId ? 0.24 : undefined,
      });
      const label = this.scene.add.text(state.x, state.y - 54, state.name, uiTextStyle({
        fontSize: '11px', color: '#ffffff', fontStyle: '800',
        stroke: '#0b0d12', strokeThickness: 2,
      })).setOrigin(0.5).setDepth(20);
      const shield = this.scene.add.text(state.x + 30, state.y - 34, '', uiTextStyle({
        fontSize: '9px', color: '#d4d7de', fontStyle: '800',
        stroke: '#0b0d12', strokeThickness: 2,
      })).setOrigin(0.5).setDepth(20);
      view = {
        controller,
        label,
        shield,
        targetAt: performance.now(),
        defeated: false,
        hitRevision: state.hitRevision,
      };
      this.players.set(state.id, view);
    }
    view.target = state;
    view.targetAt = performance.now();
    Object.assign(view.controller.stats, {
      hp: state.hp,
      maxHp: state.maxHp,
      speed: state.speed,
      level: state.level,
      xp: state.xp,
      xpToNext: state.xpToNext,
    } satisfies Partial<PlayerStats>);
    if (state.alive && state.hitRevision > view.hitRevision) {
      view.controller.showDamageFeedback();
    }
    view.hitRevision = Math.max(view.hitRevision, state.hitRevision);
    if (!state.alive && !view.defeated) {
      view.defeated = true;
      view.controller.enterDefeatedState();
      view.label.setAlpha(0.5).setText(`${state.name} · 유령`);
    } else if (state.alive && view.defeated) {
      view.defeated = false;
      view.controller.reviveAt(state.x, state.y, state.hp);
      view.label.setAlpha(1).setText(state.name);
    }
  }

  private syncAuras(states: NetAuraState[]): void {
    const activeIds = new Set(states.map((state) => state.playerId));
    for (const [playerId, aura] of this.auras) {
      if (activeIds.has(playerId)) continue;
      aura.sprite.destroy();
      this.auras.delete(playerId);
    }
    states.forEach((state) => {
      let view = this.auras.get(state.playerId);
      if (!view) {
        view = {
          sprite: this.scene.add.image(state.x, state.y, 'aura').setAlpha(0).setDepth(4),
          scale: state.scale,
        };
        this.auras.set(state.playerId, view);
      }
      view.scale = state.scale;
      updateAuraPresentation(view.sprite, state.x, state.y, state.scale, performance.now());
    });
  }

  private syncRevives(states: NetReviveState[]): void {
    const activeIds = new Set(states.map((state) => state.playerId));
    for (const [playerId, revive] of this.revives) {
      if (activeIds.has(playerId)) continue;
      revive.destroy();
      this.revives.delete(playerId);
    }
    states.forEach((state) => {
      const playerName = this.latestPlayers.find((player) => player.id === state.playerId)?.name ?? '플레이어';
      let revive = this.revives.get(state.playerId);
      if (!revive) {
        revive = new ReviveMarker(this.scene, state.x, state.y, playerName);
        this.revives.set(state.playerId, revive);
      }
      revive.container.setPosition(state.x, state.y);
      revive.setProgress(state.chargeRatio, Boolean(state.chargingPlayerId), playerName);
    });
  }

  private upsertEnemy(state: NetEnemyState): void {
    let view = this.enemies.get(state.id);
    if (!view) {
      const sprite = this.scene.add.sprite(state.x, state.y, 'monsterSheet', state.frame)
        .setScale(state.scale).setDepth(4);
      this.restoreEnemyTint(sprite, state.type);
      const hpBg = this.scene.add.rectangle(state.x, state.y, 40, 6, UI_COLORS.panelDeep).setDepth(25);
      const hpBar = this.scene.add.rectangle(state.x, state.y, 40, 4, UI_COLORS.primary).setOrigin(0, 0.5).setDepth(26);
      view = {
        sprite,
        hpBg,
        hpBar,
        target: state,
        targetAt: performance.now(),
        hitRevision: state.hitRevision,
      };
      this.enemies.set(state.id, view);
    }
    if (state.hitRevision > view.hitRevision) {
      view.hitRevision = state.hitRevision;
      this.showEnemyHitFeedback(view, state.type, state.hitRevision);
    }
    view.target = state;
    view.targetAt = performance.now();
    view.sprite.setFrame(state.frame).setScale(state.scale);
  }

  private showEnemyHitFeedback(view: EnemyView, type: NetEnemyState['type'], revision: number): void {
    const sprite = view.sprite as Phaser.GameObjects.Sprite & {
      setTintFill?: (color: number) => Phaser.GameObjects.Sprite;
    };
    if (typeof sprite.setTintFill === 'function') sprite.setTintFill(0xffffff);
    else sprite.setTint(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (!view.sprite.active || view.hitRevision !== revision) return;
      this.restoreEnemyTint(view.sprite, type);
    });
  }

  private restoreEnemyTint(sprite: Phaser.GameObjects.Sprite, type: NetEnemyState['type']): void {
    if (type === 'boss') sprite.setTint(0xd4d7de);
    else if (type === 'compressed') sprite.setTint(0xff8a65);
    else sprite.clearTint();
  }

  private upsertObject(state: NetObjectState): void {
    let view = this.objects.get(state.id);
    if (!view) {
      const sprite = this.scene.add.sprite(state.x, state.y, state.texture, state.frame)
        .setDepth(state.kind === 'projectile' ? 6 : 2);
      view = { sprite, target: state, targetAt: performance.now() };
      this.objects.set(state.id, view);
    }
    view.target = state;
    view.targetAt = performance.now();
  }

  private upsertRune(state: NetRuneState): void {
    let view = this.runes.get(state.id);
    if (!view) {
      view = {
        sprite: this.scene.add.sprite(state.x, state.y, 'rune').setDepth(7).setDisplaySize(62, 62),
        gaugeBackground: this.scene.add.rectangle(state.x, state.y + 40, 58, 8, UI_COLORS.panelDeep).setDepth(29),
        gaugeFill: this.scene.add.rectangle(state.x - 28, state.y + 40, 1, 6, UI_COLORS.primary)
          .setOrigin(0, 0.5).setDepth(30),
      };
      this.runes.set(state.id, view);
    }
    const size = 62 + state.chargeRatio * 8;
    view.sprite.setPosition(state.x, state.y).setDisplaySize(size, size)
      .setAlpha(0.75 + state.chargeRatio * 0.25);
    view.gaugeBackground.setPosition(state.x, state.y + 40).setVisible(state.chargeRatio > 0);
    view.gaugeFill.setPosition(state.x - 28, state.y + 40)
      .setDisplaySize(Math.max(1, 56 * state.chargeRatio), 6)
      .setVisible(state.chargeRatio > 0);
  }

  private removeAbsent<T>(map: Map<string, T>, present: string[], remove: (id: string) => void): void {
    const ids = new Set(present);
    for (const id of map.keys()) if (!ids.has(id)) remove(id);
  }

  private inCamera(x: number, y: number, margin: number): boolean {
    const view = this.scene.cameras.main.worldView;
    return x >= view.x - margin && x <= view.right + margin &&
      y >= view.y - margin && y <= view.bottom + margin;
  }

  private destroyEnemy(id: string): void {
    const view = this.enemies.get(id);
    view?.sprite.destroy(); view?.hpBg.destroy(); view?.hpBar.destroy();
    this.enemies.delete(id); this.canonicalEnemies.delete(id);
  }

  private destroyObject(id: string): void {
    this.objects.get(id)?.sprite.destroy();
    this.objects.delete(id); this.canonicalObjects.delete(id);
  }

  private destroyRune(id: string): void {
    const view = this.runes.get(id);
    view?.sprite.destroy();
    view?.gaugeBackground.destroy();
    view?.gaugeFill.destroy();
    this.runes.delete(id); this.canonicalRunes.delete(id);
  }
}
