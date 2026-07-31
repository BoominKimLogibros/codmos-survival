import { PlayerController } from '../game/PlayerController';
import { runeTextureKey, type RuneDropPhase } from '../game/runeDrop';
import type { PlayerStats } from '../game/types';
import { ExplosionPresentation } from '../objects/ExplosionPresentation';
import { DeathMarker } from '../objects/DeathMarker';
import { updateAuraPresentation } from '../objects/AuraPresentation';
import { BossPresentation } from '../objects/BossPresentation';
import { MultiAttackPresentation } from '../objects/MultiAttackPresentation';
import { MonsterPortalPresentation } from '../objects/MonsterPortalPresentation';
import { PlayerStatusPresentation } from '../objects/PlayerStatusPresentation';
import { ReviveMarker } from '../objects/ReviveMarker';
import { ShieldPresentation } from '../objects/ShieldPresentation';
import { shouldShowReviveMarker } from '../game/revive';
import { UI_COLORS, uiTextStyle } from '../ui/theme';
import { isCombatEffectPayload } from './gameProtocol';
import { PLAYER_LEAVE_GHOST_DURATION_MS } from './types';
import type {
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
  status: PlayerStatusPresentation;
  shield: Phaser.GameObjects.Text;
  shieldPresentation: ShieldPresentation | null;
  target?: NetPlayerState;
  targetAt: number;
  defeated: boolean;
  hitRevision: number;
  success: boolean;
  successRevision: number;
}

interface EnemyView {
  sprite: Phaser.GameObjects.Sprite;
  presentation: BossPresentation | null;
  spawnPresentation: MonsterPortalPresentation | null;
  hpBg: Phaser.GameObjects.Rectangle | null;
  hpBar: Phaser.GameObjects.Rectangle | null;
  target: NetEnemyState;
  targetAt: number;
  hitRevision: number;
  spawnReadyAt: number;
}

interface ObjectView {
  sprite: Phaser.GameObjects.Sprite;
  target: NetObjectState;
  targetAt: number;
}

interface RuneView {
  sprite: Phaser.GameObjects.Sprite;
  phase: RuneDropPhase;
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
  private readonly knownReviveIds = new Set<string>();
  private readonly canonicalEnemies = new Map<string, NetEnemyState>();
  private readonly canonicalObjects = new Map<string, NetObjectState>();
  private readonly canonicalRunes = new Map<string, NetRuneState>();
  private latestPlayers: NetPlayerState[] = [];
  private latestProgress = { gameTime: 0, killCount: 0, normalGeneration: 1, bossGeneration: 0 };
  private readonly playerRemovalTimers = new Map<string, Phaser.Time.TimerEvent>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly localPlayerId: string,
    private readonly localInput: () => number,
  ) {}

  get playerStates(): NetPlayerState[] { return this.latestPlayers; }
  get progress(): typeof this.latestProgress { return this.latestProgress; }
  get localPlayer(): PlayerController | undefined { return this.players.get(this.localPlayerId)?.controller; }
  get localAlive(): boolean { return this.latestPlayers.find((player) => player.id === this.localPlayerId)?.alive ?? true; }
  get bossStates(): NetEnemyState[] {
    return [...this.canonicalEnemies.values()].filter((enemy) => enemy.type === 'boss');
  }

  apply(snapshot: WorldSnapshot): void {
    this.latestProgress = snapshot.progress;
    this.latestPlayers = snapshot.players;
    snapshot.players.forEach((state) => this.queuePlayer(state));

    if (snapshot.keyframe) {
      const removedEnemyIds = new Set(snapshot.removedEnemies);
      this.removeAbsent(
        this.canonicalEnemies,
        snapshot.enemies.map((item) => item.id),
        (id) => this.destroyEnemy(id, removedEnemyIds.has(id)),
      );
      this.removeAbsent(this.canonicalObjects, snapshot.objects.map((item) => item.id), (id) => this.destroyObject(id));
      this.removeAbsent(this.canonicalRunes, snapshot.runes.map((item) => item.id), (id) => this.destroyRune(id));
    }
    snapshot.removedEnemies.forEach((id) => this.destroyEnemy(id, true));
    snapshot.removedObjects.forEach((id) => this.destroyObject(id));
    snapshot.removedRunes.forEach((id) => this.destroyRune(id));
    snapshot.enemies.forEach((state) => {
      this.canonicalEnemies.set(state.id, state);
      this.upsertEnemy(state, snapshot.serverTime);
    });
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
      view.status.setPosition(view.controller.sprite.x, view.controller.sprite.y - 49);
      view.shield.setPosition(view.controller.sprite.x + 30, view.controller.sprite.y - 34)
        .setText(state.shield > 0 ? `방어 ${state.shield}` : '').setVisible(state.shield > 0);
      view.shieldPresentation?.setPosition(view.controller.sprite.x, view.controller.sprite.y);
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
      view.presentation?.sync(view.sprite.x, view.sprite.y, state.vx < 0);
      const visible = this.inCamera(view.sprite.x, view.sprite.y, CLIENT_RENDER_MARGIN);
      const bossReady = state.type !== 'boss' || (state.bossSpawnRemainingMs ?? 0) <= 0;
      const monsterReady = state.type === 'boss' || now >= view.spawnReadyAt;
      view.sprite.setVisible(
        visible && monsterReady && (Boolean(view.presentation) || bossReady),
      );
      view.presentation?.setVisible(visible);
      view.spawnPresentation?.sync(view.sprite.x, view.sprite.y);
      view.spawnPresentation?.setVisible(visible);
      view.hpBg?.setVisible(visible && bossReady);
      view.hpBar?.setVisible(visible && bossReady);
      if (!visible) continue;
      if (view.hpBg && view.hpBar) {
        const width = Math.max(42, Math.min(120, state.maxHp / 3));
        const ratio = Math.max(0, state.hp / Math.max(1, state.maxHp));
        view.hpBg.setPosition(view.sprite.x, view.sprite.y - view.sprite.displayHeight / 2 - 9)
          .setDisplaySize(width, 6);
        view.hpBar.setPosition(view.sprite.x - width / 2, view.hpBg.y)
          .setDisplaySize(Math.max(1, width * ratio), 4);
      }
    }
    for (const view of this.objects.values()) {
      const state = view.target;
      const ageSeconds = Math.min(100, now - view.targetAt) / 1000;
      const targetX = state.x + (state.vx ?? 0) * ageSeconds;
      const targetY = state.y + (state.vy ?? 0) * ageSeconds;
      view.sprite.x = Phaser.Math.Linear(view.sprite.x, targetX, fastBlend);
      view.sprite.y = Phaser.Math.Linear(view.sprite.y, targetY, fastBlend);
      view.sprite.setRotation(state.rotation ?? 0)
        .setScale(state.scale ?? 1, state.scaleY ?? state.scale ?? 1)
        .setFlipX(state.flipX ?? false)
        .setOrigin(state.originX ?? 0.5, state.originY ?? 0.5)
        .setAlpha(state.alpha ?? 1)
        .setDepth(state.depth ?? (state.kind === 'projectile' ? 6 : 2));
      view.sprite.setVisible(this.inCamera(view.sprite.x, view.sprite.y, CLIENT_RENDER_MARGIN));
    }
  }

  playMultiAttack(playerId: string): void {
    const player = this.players.get(playerId)?.controller;
    if (!player) return;
    const targets = [...this.enemies.values()]
      .filter((view) => view.sprite.active)
      .map((view) => ({
        get active() { return view.sprite.active; },
        get x() { return view.sprite.x; },
        get y() { return view.sprite.y; },
        enemyType: view.target.type,
      }));
    MultiAttackPresentation.play(this.scene, player.sprite.x, player.sprite.y, {
      targets,
      onImpact: () => undefined,
    });
  }

  playCombatEffect(effect: unknown, onImpact?: () => void): void {
    if (!isCombatEffectPayload(effect)) return;
    ExplosionPresentation.play(this.scene, effect, onImpact);
  }

  markPlayerLeft(playerId: string, delayMs = PLAYER_LEAVE_GHOST_DURATION_MS): void {
    if (this.playerRemovalTimers.has(playerId)) return;
    const view = this.players.get(playerId);
    if (view?.target) {
      view.target = {
        ...view.target,
        alive: false,
        connected: false,
        hp: 0,
        vx: 0,
        vy: 0,
      };
    }
    if (view) {
      view.controller.stats.hp = 0;
      if (!view.defeated) {
        view.defeated = true;
        view.controller.enterDefeatedState('departure');
      }
      view.status.update({
        name: view.target?.name ?? '플레이어',
        level: view.target?.level ?? view.controller.stats.level,
        hp: 0,
        maxHp: view.target?.maxHp ?? view.controller.stats.maxHp,
        xp: view.target?.xp ?? view.controller.stats.xp,
        xpToNext: view.target?.xpToNext ?? view.controller.stats.xpToNext,
        status: '이탈',
      });
      view.shield.setVisible(false);
      view.shieldPresentation?.destroy(false);
      view.shieldPresentation = null;
    }
    this.auras.get(playerId)?.sprite.destroy();
    this.auras.delete(playerId);
    this.revives.get(playerId)?.destroy();
    this.revives.delete(playerId);
    this.knownReviveIds.delete(playerId);
    const timer = this.scene.time.delayedCall(delayMs, () => this.destroyPlayer(playerId));
    this.playerRemovalTimers.set(playerId, timer);
  }

  destroy(): void {
    this.playerRemovalTimers.forEach((timer) => timer.remove(false));
    this.playerRemovalTimers.clear();
    this.players.forEach((view) => {
      view.controller.destroy();
      view.status.destroy();
      view.shield.destroy();
      view.shieldPresentation?.destroy(false);
    });
    this.enemies.forEach((view) => {
      view.presentation?.destroy(false);
      view.sprite.destroy();
      view.hpBg?.destroy();
      view.hpBar?.destroy();
    });
    this.objects.forEach((view) => view.sprite.destroy());
    this.runes.forEach((rune) => {
      rune.sprite.destroy();
      rune.gaugeBackground.destroy();
      rune.gaugeFill.destroy();
    });
    this.auras.forEach((aura) => aura.sprite.destroy());
    this.revives.forEach((revive) => revive.destroy());
    this.knownReviveIds.clear();
  }

  private queuePlayer(state: NetPlayerState): void {
    if (this.playerRemovalTimers.has(state.id)) return;
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
      const status = new PlayerStatusPresentation(this.scene, state.x, state.y - 49, {
        name: state.name,
        level: state.level,
        hp: state.hp,
        maxHp: state.maxHp,
        xp: state.xp,
        xpToNext: state.xpToNext,
      });
      const shield = this.scene.add.text(state.x + 30, state.y - 34, '', uiTextStyle({
        fontSize: '9px', color: '#d4d7de', fontStyle: '800',
        stroke: '#0b0d12', strokeThickness: 2,
      })).setOrigin(0.5).setDepth(20);
      view = {
        controller,
        status,
        shield,
        shieldPresentation: null,
        targetAt: performance.now(),
        defeated: false,
        hitRevision: state.hitRevision,
        success: false,
        successRevision: 0,
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
    view.status.update({
      name: state.name,
      level: state.level,
      hp: state.hp,
      maxHp: state.maxHp,
      xp: state.xp,
      xpToNext: state.xpToNext,
      status: !state.connected ? '재연결' : !state.alive ? '유령' : undefined,
    });
    if (state.alive && state.hitRevision > view.hitRevision) {
      view.controller.showDamageFeedback();
    }
    view.hitRevision = Math.max(view.hitRevision, state.hitRevision);
    this.syncShieldPresentation(view, state);
    if (!state.alive && !view.defeated) {
      view.defeated = true;
      view.controller.enterDefeatedState(state.connected ? 'death' : 'departure');
    } else if (state.alive && view.defeated) {
      view.defeated = false;
      view.controller.reviveAt(state.x, state.y, state.hp);
    }
    if (state.alive && state.success && (
      !view.success || state.successRevision > view.successRevision
    )) {
      view.controller.enterBossSuccessState();
    } else if ((!state.alive || !state.success) && view.success) {
      view.controller.exitBossSuccessState(false);
    }
    view.success = state.alive && state.success;
    view.successRevision = Math.max(view.successRevision, state.successRevision);
  }

  private syncShieldPresentation(view: PlayerView, state: NetPlayerState): void {
    if (state.alive && state.shield > 0) {
      if (!view.shieldPresentation) {
        view.shieldPresentation = new ShieldPresentation(
          this.scene,
          view.controller.sprite.x,
          view.controller.sprite.y,
          state.shield,
        );
      } else {
        view.shieldPresentation.sync(
          view.controller.sprite.x,
          view.controller.sprite.y,
          state.shield,
        );
      }
      return;
    }
    if (!view.shieldPresentation) return;
    const depleted = state.alive && view.shieldPresentation.charges > 0 && state.shield === 0;
    view.shieldPresentation.sync(view.controller.sprite.x, view.controller.sprite.y, state.shield);
    view.shieldPresentation.destroy(depleted);
    view.shieldPresentation = null;
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
    for (const playerId of this.knownReviveIds) {
      if (activeIds.has(playerId)) continue;
      this.knownReviveIds.delete(playerId);
    }
    for (const [playerId, revive] of this.revives) {
      const state = states.find((candidate) => candidate.playerId === playerId);
      if (state && shouldShowReviveMarker(state.chargingPlayerId)) continue;
      revive.destroy();
      this.revives.delete(playerId);
    }
    states.forEach((state) => {
      const playerName = this.latestPlayers.find((player) => player.id === state.playerId)?.name ?? '플레이어';
      if (!this.knownReviveIds.has(state.playerId)) {
        this.knownReviveIds.add(state.playerId);
        new DeathMarker(this.scene, state.x, state.y);
      }
      if (!shouldShowReviveMarker(state.chargingPlayerId)) return;
      let revive = this.revives.get(state.playerId);
      if (!revive) {
        revive = new ReviveMarker(this.scene, state.x, state.y, playerName);
        this.revives.set(state.playerId, revive);
      }
      revive.container.setPosition(state.x, state.y);
      revive.setProgress(state.chargeRatio, Boolean(state.chargingPlayerId), playerName);
    });
  }

  private upsertEnemy(state: NetEnemyState, serverTime: number): void {
    let view = this.enemies.get(state.id);
    if (!view) {
      const sprite = this.scene.add.sprite(state.x, state.y, 'monsterSheet', state.frame)
        .setScale(state.scale).setDepth(4);
      const presentation = state.type === 'boss'
        ? BossPresentation.create(
          this.scene,
          state.x,
          state.y,
          Math.max(1, state.bossTier),
          state.bossSpawnRemainingMs ?? 0,
        )
        : null;
      if (presentation) {
        // Keep the Arcade-compatible sprite as an invisible network/HP anchor.
        sprite.setAlpha(0).setDisplaySize(presentation.visualHeight, presentation.visualHeight);
      } else {
        this.restoreEnemyTint(sprite, state.type);
      }
      const hpBg = state.type === 'boss'
        ? this.scene.add.rectangle(state.x, state.y, 40, 6, UI_COLORS.panelDeep).setDepth(25)
        : null;
      const hpBar = state.type === 'boss'
        ? this.scene.add.rectangle(state.x, state.y, 40, 4, UI_COLORS.primary)
          .setOrigin(0, 0.5).setDepth(26)
        : null;
      view = {
        sprite,
        presentation,
        spawnPresentation: null,
        hpBg,
        hpBar,
        target: state,
        targetAt: performance.now(),
        hitRevision: state.hitRevision,
        spawnReadyAt: 0,
      };
      this.enemies.set(state.id, view);
    }
    const portalRemainingMs = state.type === 'boss'
      ? 0
      : Math.max(0, (state.portalSpawnEndsAt ?? 0) - serverTime);
    view.spawnReadyAt = portalRemainingMs > 0
      ? performance.now() + portalRemainingMs
      : 0;
    if (
      portalRemainingMs > 0 &&
      !view.spawnPresentation &&
      this.inCamera(state.x, state.y, CLIENT_RENDER_MARGIN)
    ) {
      view.spawnPresentation = MonsterPortalPresentation.create(
        this.scene,
        state.x,
        state.y,
        {
          texture: 'monsterSheet',
          frame: state.frame,
          scale: state.scale,
          tint: state.type === 'compressed' ? 0xff8a65 : undefined,
        },
        portalRemainingMs,
      );
    } else if (portalRemainingMs <= 0 && view.spawnPresentation) {
      view.spawnPresentation.destroy();
      view.spawnPresentation = null;
    }
    if (state.hitRevision > view.hitRevision) {
      const previousRevision = view.hitRevision;
      view.hitRevision = state.hitRevision;
      for (let revision = previousRevision + 1; revision <= state.hitRevision; revision++) {
        const delay = (revision - previousRevision - 1) * 35;
        this.scene.time.delayedCall(delay, () => {
          this.showEnemyHitFeedback(view!, state.type, revision);
        });
      }
    }
    view.target = state;
    view.targetAt = performance.now();
    view.sprite.setFrame(state.frame);
    view.sprite.setVisible(state.type === 'boss' || portalRemainingMs <= 0);
    if (view.presentation) {
      view.sprite.setAlpha(0).setDisplaySize(view.presentation.visualHeight, view.presentation.visualHeight);
      view.presentation.sync(state.x, state.y, state.vx < 0);
      view.presentation.syncBossAttack(state.bossAttack ?? null);
    } else {
      view.sprite.setAlpha(1).setScale(state.scale);
    }
  }

  private showEnemyHitFeedback(view: EnemyView, type: NetEnemyState['type'], revision: number): void {
    if (view.presentation) {
      view.presentation.showDamageFeedback();
      return;
    }
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
    if (view.sprite.texture.key !== state.texture || view.sprite.frame.name !== state.frame) {
      view.sprite.setTexture(state.texture, state.frame);
    }
    view.target = state;
    view.targetAt = performance.now();
  }

  private upsertRune(state: NetRuneState): void {
    let view = this.runes.get(state.id);
    if (!view) {
      view = {
        sprite: this.scene.add.sprite(state.x, state.y, runeTextureKey(state.phase))
          .setDepth(7).setDisplaySize(62, 62),
        phase: state.phase,
        gaugeBackground: this.scene.add.rectangle(state.x, state.y + 40, 58, 8, UI_COLORS.panelDeep).setDepth(29),
        gaugeFill: this.scene.add.rectangle(state.x - 28, state.y + 40, 1, 6, UI_COLORS.primary)
          .setOrigin(0, 0.5).setDepth(30),
      };
      this.runes.set(state.id, view);
    }
    if (view.phase !== state.phase) {
      view.phase = state.phase;
      view.sprite.setTexture(runeTextureKey(state.phase));
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

  private destroyEnemy(id: string, playDeathAnimation = false): void {
    const view = this.enemies.get(id);
    view?.presentation?.destroy(playDeathAnimation);
    view?.spawnPresentation?.destroy();
    view?.sprite.destroy(); view?.hpBg?.destroy(); view?.hpBar?.destroy();
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

  private destroyPlayer(playerId: string): void {
    const timer = this.playerRemovalTimers.get(playerId);
    timer?.remove(false);
    this.playerRemovalTimers.delete(playerId);
    const view = this.players.get(playerId);
    if (!view) return;
    view.controller.destroy();
    view.status.destroy();
    view.shield.destroy();
    view.shieldPresentation?.destroy(false);
    this.players.delete(playerId);
    this.knownReviveIds.delete(playerId);
    this.latestPlayers = this.latestPlayers.filter((player) => player.id !== playerId);
  }
}
