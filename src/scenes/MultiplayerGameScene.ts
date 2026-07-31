import {
  ARENA_PLAYABLE_HALF_SIZE,
  PLAYER_SKIN,
  RETRY_BOSS_DELAY_MS,
} from '../config/constants';
import { AudioManager } from '../game/AudioManager';
import { BossSuccessCoordinator } from '../game/BossSuccessCoordinator';
import { DeathCameraController } from '../game/DeathCameraController';
import { EnemySystem } from '../game/EnemySystem';
import { applyLevelUpChoice, generateLevelUpChoices } from '../game/levelUp';
import { PlayerController } from '../game/PlayerController';
import { OrbitLinkCoordinator } from '../game/OrbitLinkCoordinator';
import {
  advanceOneLevelIfReady,
  applyDeathPenalty,
  PLAYER_STAT_LABELS,
} from '../game/progression';
import type { GameSaveState, LevelUpChoice, RunProgress } from '../game/types';
import { createInitialPlayerStats, createInitialRunProgress } from '../game/types';
import {
  applyWeaponDefinitionLevels,
  buildWeaponTooltipData,
  createWeaponDefinitions,
  WeaponSystem,
} from '../game/WeaponSystem';
import { ClientWorldRenderer } from '../network/ClientWorldRenderer';
import type {
  CombatEffectPayload,
  LevelOfferPayload,
  NetPlayerState,
  PlayerCheckpointPayload,
  RuneStateEvent,
  WorldSnapshot,
} from '../network/gameProtocol';
import { createRuntimeId, isRuneStateEvent } from '../network/gameProtocol';
import { HostRuneCoordinator } from '../network/HostRuneCoordinator';
import { HostReviveCoordinator } from '../network/HostReviveCoordinator';
import { HostSnapshotPublisher } from '../network/HostSnapshotPublisher';
import { NetworkInputSource } from '../network/NetworkInputSource';
import { udpClient } from '../network/UdpClient';
import { PLAYER_LEAVE_GHOST_DURATION_MS } from '../network/types';
import type {
  GameStartPayload,
  NetworkProfile,
  RoomMember,
  RoomState,
  UdpBridgeEvent,
  UdpGameMessage,
} from '../network/types';
import { WorldMap } from '../objects/WorldMap';
import { PlayerStatusPresentation } from '../objects/PlayerStatusPresentation';
import { RuneActivationPresentation } from '../objects/RuneActivationPresentation';
import { ShieldPresentation } from '../objects/ShieldPresentation';
import { getProfile, updateProfileState } from '../services/profileService';
import { MultiplayerLevelOverlay } from '../ui/MultiplayerLevelOverlay';
import { MultiplayerRuneOverlay } from '../ui/MultiplayerRuneOverlay';
import { OffscreenIndicatorHud } from '../ui/OffscreenIndicatorHud';
import type { OffscreenIndicatorTarget } from '../ui/OffscreenIndicatorHud';
import { PartyHud } from '../ui/PartyHud';
import { createUiButton, createUiPanel, createUiToast, UI_COLORS, uiTextStyle } from '../ui/theme';
import type { UiButton, UiToast } from '../ui/theme';
import { shouldShowTouchControls } from '../ui/TouchJoystick';
import { calculateExitButtonPosition } from '../ui/gameHudLayout';
import { WeaponStatusHud } from '../ui/WeaponStatusHud';

interface MultiplayerSceneData {
  profileId?: string;
  start?: GameStartPayload;
}

interface PendingOffer {
  payload: LevelOfferPayload;
  playerId: string;
  timer: Phaser.Time.TimerEvent;
}

function initialPlayerSpawn(
  center: { x: number; y: number },
  index: number,
  total: number,
): { x: number; y: number } {
  if (index === 0) return { ...center };
  const playersPerRing = 8;
  const ring = Math.floor((index - 1) / playersPerRing);
  const slot = (index - 1) % playersPerRing;
  const ringCount = Math.min(playersPerRing, total - 1 - ring * playersPerRing);
  const angle = (slot / Math.max(1, ringCount)) * Math.PI * 2 - Math.PI / 2;
  const radius = 76 + ring * 58;
  const boundary = ARENA_PLAYABLE_HALF_SIZE - 64;
  return {
    x: Phaser.Math.Clamp(center.x + Math.cos(angle) * radius, -boundary, boundary),
    y: Phaser.Math.Clamp(center.y + Math.sin(angle) * radius, -boundary, boundary),
  };
}

export class MultiplayerGameScene extends Phaser.Scene {
  private profileId = '';
  private startData!: GameStartPayload;
  private room!: RoomState;
  private isHost = false;
  private ended = false;
  private worldMap!: WorldMap;
  private audio!: AudioManager;
  private inputSource!: NetworkInputSource;
  private deathCamera!: DeathCameraController;
  private partyHud!: PartyHud;
  private offscreenIndicatorHud!: OffscreenIndicatorHud;
  private skillHud?: WeaponStatusHud;
  private toast!: UiToast;
  private exitButton!: UiButton;
  private levelOverlay!: MultiplayerLevelOverlay;
  private runeOverlay!: MultiplayerRuneOverlay;
  private unsubscribe?: () => void;
  private localWasAlive = true;
  private localSkillState?: GameSaveState;
  private localSkillDefinitions = createWeaponDefinitions();
  private localSkillSignature = '';

  private progress: RunProgress = createInitialRunProgress();
  private readonly hostPlayers = new Map<string, PlayerController>();
  private readonly hostInputs = new Map<string, number>();
  private readonly playerIds = new Map<PlayerController, string>();
  private readonly hostWeapons = new Map<string, WeaponSystem>();
  private readonly playerStatusViews = new Map<string, PlayerStatusPresentation>();
  private readonly shieldLabels = new Map<string, Phaser.GameObjects.Text>();
  private readonly hostShieldPresentations = new Map<string, ShieldPresentation>();
  private readonly pendingOffers = new Map<string, PendingOffer>();
  private enemySystem?: EnemySystem;
  private runeCoordinator?: HostRuneCoordinator;
  private reviveCoordinator?: HostReviveCoordinator;
  private publisher?: HostSnapshotPublisher;
  private orbitLinks?: OrbitLinkCoordinator;
  private bossSuccess?: BossSuccessCoordinator;
  private clientRenderer?: ClientWorldRenderer;
  private snapshotElapsed = 0;
  private checkpointElapsed = 0;
  private timeElapsed = 0;
  private roomResetPromise?: Promise<RoomState>;
  private leaving = false;
  private readonly leftRemovalTimers = new Map<string, Phaser.Time.TimerEvent>();

  constructor() { super('MultiplayerGameScene'); }

  init(data: MultiplayerSceneData): void {
    this.profileId = data.profileId ?? '';
    if (!data.start) throw new Error('멀티플레이 시작 정보가 없습니다.');
    this.startData = data.start;
    this.room = data.start.room;
    this.isHost = data.start.room.isHost;
  }

  create(): void {
    this.ended = false;
    this.hostPlayers.clear();
    this.hostInputs.clear();
    this.playerIds.clear();
    this.hostWeapons.clear();
    this.playerStatusViews.clear();
    this.shieldLabels.clear();
    this.hostShieldPresentations.clear();
    this.pendingOffers.clear();
    this.enemySystem = undefined;
    this.runeCoordinator = undefined;
    this.reviveCoordinator = undefined;
    this.publisher = undefined;
    this.orbitLinks = undefined;
    this.bossSuccess = undefined;
    this.clientRenderer = undefined;
    this.skillHud = undefined;
    this.localSkillState = undefined;
    this.localSkillDefinitions = createWeaponDefinitions();
    this.localSkillSignature = '';
    this.snapshotElapsed = 0;
    this.checkpointElapsed = 0;
    this.timeElapsed = 0;
    this.roomResetPromise = undefined;
    this.leaving = false;
    this.leftRemovalTimers.forEach((timer) => timer.remove(false));
    this.leftRemovalTimers.clear();
    const localProfile = getProfile(this.profileId);
    if (localProfile) this.syncLocalSkills(localProfile.state);
    this.worldMap = new WorldMap(this);
    this.audio = new AudioManager(this);
    this.deathCamera = new DeathCameraController(this);
    this.inputSource = new NetworkInputSource(
      this,
      this.isHost ? undefined : (mask) => udpClient.sendInput(mask),
    );
    this.partyHud = new PartyHud(this);
    this.offscreenIndicatorHud = new OffscreenIndicatorHud(this);
    this.toast = createUiToast(this, this.scale.gameSize.width / 2, this.scale.gameSize.height - 96, {
      width: Math.min(460, this.scale.gameSize.width - 32),
    }).setScrollFactor(0).setDepth(4500);
    this.levelOverlay = new MultiplayerLevelOverlay(this, (offerId, index) => {
      if (this.isHost) this.handleLevelChoice(this.room.localPlayerId, offerId, index);
      else udpClient.send('level-choice', { offerId, index }, { reliable: true });
    });
    this.runeOverlay = new MultiplayerRuneOverlay(this, (challengeId, direction) => {
      if (this.isHost) this.runeCoordinator?.handleInput(this.room.localPlayerId, challengeId, direction);
      else udpClient.send('rune-input', { challengeId, direction }, { reliable: true });
    });
    this.createExitButton();
    this.scale.on('resize', this.handleResize, this);
    this.unsubscribe = udpClient.subscribe((event) => this.onUdpEvent(event));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      this.scale.off('resize', this.handleResize, this);
      this.inputSource.stop();
      this.clientRenderer?.destroy();
      this.reviveCoordinator?.destroy();
      this.playerStatusViews.forEach((presentation) => presentation.destroy());
      this.playerStatusViews.clear();
      this.hostShieldPresentations.forEach((presentation) => presentation.destroy(false));
      this.hostShieldPresentations.clear();
      this.pendingOffers.forEach((offer) => offer.timer.remove(false));
      this.pendingOffers.clear();
      this.leftRemovalTimers.forEach((timer) => timer.remove(false));
      this.leftRemovalTimers.clear();
    });

    if (this.isHost) this.createHostWorld();
    else this.createClientWorld();
    this.createSkillHud();
  }

  update(_time: number, delta: number): void {
    this.syncResponsiveHud();
    if (this.ended) {
      this.inputSource.stop();
      this.deathCamera.update(delta);
      this.runeOverlay.update();
      return;
    }
    if (this.isHost) this.updateHost(delta);
    else this.updateClient(delta);
    this.skillHud?.update();
    this.runeOverlay.update();
  }

  private createHostWorld(): void {
    const profiles = this.room.privateProfiles ?? {};
    const baselineProfile = profiles[this.startData.baselinePlayerId]
      ?? profiles[this.room.hostPlayerId]
      ?? Object.values(profiles)[0];
    if (!baselineProfile) throw new Error('방장이 참가자 프로필을 받지 못했습니다.');
    const isContinuedRun = baselineProfile.state.gameTime > 0 || baselineProfile.state.killCount > 0;
    this.progress = {
      gameTime: baselineProfile.state.gameTime,
      killCount: baselineProfile.state.killCount,
      ...baselineProfile.state.progression,
    };
    const center = baselineProfile.state.player;
    const members = [...this.room.members].sort((a, b) => a.joinOrder - b.joinOrder);
    members.forEach((member, index) => {
      const profile = profiles[member.playerId];
      if (!profile) return;
      const spawn = initialPlayerSpawn(center, index, members.length);
      this.hostInputs.set(member.playerId, 0);
      const player = new PlayerController(this, {
        skin: profile.skin || PLAYER_SKIN,
        spawn,
        isRunActive: () => !this.ended && player.stats.hp > 0,
        inputProvider: () => this.hostInputs.get(member.playerId) ?? 0,
        cameraFollow: member.playerId === this.room.localPlayerId,
      });
      player.applySavedState(profile.state.stats, spawn);
      this.hostPlayers.set(member.playerId, player);
      this.playerIds.set(player, member.playerId);
      const status = new PlayerStatusPresentation(this, spawn.x, spawn.y - 49, {
        name: member.name,
        level: player.stats.level,
        hp: player.stats.hp,
        maxHp: player.stats.maxHp,
        xp: player.stats.xp,
        xpToNext: player.stats.xpToNext,
      });
      const shield = this.add.text(spawn.x + 28, spawn.y - 34, '', uiTextStyle({
        fontSize: '9px', color: '#d4d7de', fontStyle: '800', stroke: '#0b0d12', strokeThickness: 2,
      })).setOrigin(0.5).setDepth(20);
      this.playerStatusViews.set(member.playerId, status);
      this.shieldLabels.set(member.playerId, shield);
    });
    const leader = this.hostPlayers.get(this.startData.baselinePlayerId)
      ?? this.hostPlayers.get(this.room.localPlayerId)
      ?? [...this.hostPlayers.values()][0];
    if (!leader) throw new Error('플레이어를 생성할 수 없습니다.');
    this.enemySystem = new EnemySystem(this, leader, this.audio, this.progress, {
      showToast: (message) => this.showToast(message),
      onLevelUp: (player) => this.beginLevelUp(player),
      onPlayerDeath: (player) => this.handlePlayerDeath(player),
      isGameOver: () => this.ended,
      tryBlockPlayerHit: (player) => this.runeCoordinator?.tryBlock(this.playerIds.get(player) ?? '') ?? false,
      getPlayers: () => [...this.hostPlayers.values()],
      getDifficultyGrowthProfiles: () => [...this.hostPlayers].map(([playerId, player]) => {
        const definitions = this.hostWeapons.get(playerId)?.definitions;
        return {
          level: player.stats.level,
          enhancementLevel: player.stats.weapons.reduce((sum, key) => (
            sum + Math.max(0, (definitions?.[key]?.level ?? 1) - 1)
          ), 0),
        };
      }),
      onSharedXp: (value) => this.giveSharedXp(value),
      onBossKilled: () => this.bossSuccess?.celebrate(),
    });
    for (const [playerId, player] of this.hostPlayers) {
      const profile = profiles[playerId];
      const weapon = new WeaponSystem(this, player, {
        getEnemies: () => this.enemySystem!.getActiveEnemies(),
        damageEnemy: (enemy, damage, knockback) => (
          this.enemySystem!.damageEnemy(enemy, damage, knockback)
        ),
        effects: this.audio.effects,
        ownerCenteredExplosionViewport: true,
        onExplosion: (effect) => udpClient.send('combat-effect', {
          type: 'explosion',
          ...effect,
        } satisfies CombatEffectPayload, { reliable: true }),
      });
      if (profile) weapon.applySavedLevels(profile.state.weaponLevels);
      this.hostWeapons.set(playerId, weapon);
    }
    this.bossSuccess = new BossSuccessCoordinator(
      this,
      () => [...this.hostPlayers].flatMap(([playerId, player]) => {
        const weapons = this.hostWeapons.get(playerId);
        return weapons ? [{ player, weapons }] : [];
      }),
      () => this.enemySystem?.getActiveEnemies() ?? [],
      (enemy, damage) => this.enemySystem?.damageEnemy(enemy, damage),
    );
    this.runeCoordinator = new HostRuneCoordinator(
      this,
      this.hostPlayers,
      this.progress,
      this.enemySystem,
      this.audio,
      (playerId, kind, payload, reliable) => this.deliver(playerId, kind, payload, reliable),
      (kind, payload, reliable) => udpClient.send(kind, payload, { reliable }),
      (message) => this.showToast(message),
    );
    this.reviveCoordinator = new HostReviveCoordinator(
      this,
      this.hostPlayers,
      (playerId) => this.room.members.some((member) => (
        member.playerId === playerId && member.connection === 'connected'
      )),
      (playerId, reviverPlayerId, position) => {
        this.revivePlayer(playerId, reviverPlayerId, position);
      },
    );
    this.enemySystem.connectCombat(
      [...this.hostWeapons.values()],
      this.worldMap.environmentColliders,
      this.worldMap.waterLayer,
    );
    this.enemySystem.resumeFromSavedProgress(isContinuedRun ? RETRY_BOSS_DELAY_MS : 0);
    this.publisher = new HostSnapshotPublisher(
      this.hostPlayers,
      () => this.room.members,
      this.enemySystem,
      this.hostWeapons,
      this.runeCoordinator,
      this.progress,
      () => this.reviveCoordinator?.snapshot() ?? [],
      (playerId) => this.runeCoordinator?.getShieldCharges(playerId) ?? 0,
      (target, snapshot) => udpClient.send('snapshot', snapshot, { targetPlayerId: target }),
    );
    this.orbitLinks = new OrbitLinkCoordinator(this.hostPlayers, this.hostWeapons);
    this.localWasAlive = true;
    this.updateHostHud();
    this.updateHostOffscreenIndicators();
    this.sendAllCheckpoints();
    this.time.delayedCall(0, () => {
      for (const player of this.hostPlayers.values()) {
        if (player.stats.xp >= player.stats.xpToNext) this.beginLevelUp(player);
      }
    });
  }

  private createClientWorld(): void {
    this.clientRenderer = new ClientWorldRenderer(
      this,
      this.room.localPlayerId,
      () => this.inputSource.read(this.localWasAlive && !this.isLocalInputBlocked()),
    );
    this.localWasAlive = true;
    // A late joiner may have entered after the host's first reliable
    // checkpoint was acknowledged by the lobby scene. Request one again only
    // after the gameplay scene is subscribed and ready to persist it.
    udpClient.send('checkpoint-request', {}, { reliable: true });
  }

  private updateHost(delta: number): void {
    const local = this.hostPlayers.get(this.room.localPlayerId);
    const localAlive = Boolean(local && local.stats.hp > 0 && local.sprite.active);
    this.hostInputs.set(
      this.room.localPlayerId,
      this.inputSource.update(localAlive && !this.isLocalInputBlocked()),
    );
    for (const [playerId, player] of this.hostPlayers) {
      if (player.stats.hp <= 0 || !player.sprite.active) {
        this.syncHostShieldPresentation(playerId, player, 0);
        continue;
      }
      player.update();
      this.hostWeapons.get(playerId)?.update(delta);
      this.syncHostPlayerStatus(playerId, player);
      const charges = this.runeCoordinator?.getShieldCharges(playerId) ?? 0;
      this.shieldLabels.get(playerId)?.setPosition(player.sprite.x + 28, player.sprite.y - 34)
        .setText(charges > 0 ? `방어 ${charges}` : '').setVisible(charges > 0);
      this.syncHostShieldPresentation(playerId, player, charges);
    }
    this.bossSuccess?.update(delta);
    this.orbitLinks?.update(delta);
    this.enemySystem?.update(delta);
    this.runeCoordinator?.update(delta);
    this.reviveCoordinator?.update(delta);
    this.timeElapsed += delta;
    while (this.timeElapsed >= 1_000) { this.timeElapsed -= 1_000; this.progress.gameTime++; }
    this.snapshotElapsed += delta;
    if (this.snapshotElapsed >= 50) { this.snapshotElapsed %= 50; this.publisher?.publish(); }
    this.checkpointElapsed += delta;
    if (this.checkpointElapsed >= 5_000) { this.checkpointElapsed %= 5_000; this.sendAllCheckpoints(); }
    this.updateHostHud();
    // Host indicators must follow the authoritative player positions instead
    // of retaining the spawn positions captured when the match began.
    this.updateHostOffscreenIndicators();
    if (this.localWasAlive && !localAlive && local) this.startSpectating(local.sprite.x, local.sprite.y);
    if (!this.localWasAlive && localAlive && local) this.resumePlaying(local);
    if (!localAlive) this.deathCamera.update(delta);
    this.localWasAlive = localAlive;
  }

  private updateClient(delta: number): void {
    const alive = this.clientRenderer?.localAlive ?? true;
    this.inputSource.update(alive && !this.isLocalInputBlocked());
    this.clientRenderer?.update(delta);
    const players = this.clientRenderer?.playerStates ?? [];
    const progress = this.clientRenderer?.progress;
    if (progress) this.partyHud.update(players, progress.gameTime, progress.killCount);
    this.updateClientOffscreenIndicators(players);
    if (this.localWasAlive && !alive) {
      const local = players.find((player) => player.id === this.room.localPlayerId);
      if (local) this.startSpectating(local.x, local.y);
    }
    if (!this.localWasAlive && alive) {
      const local = this.clientRenderer?.localPlayer;
      if (local) this.resumePlaying(local);
    }
    if (!alive) this.deathCamera.update(delta);
    this.localWasAlive = alive;
  }

  private onUdpEvent(event: UdpBridgeEvent): void {
    if (event.type === 'room-state') {
      this.room = event.room;
      if (this.isHost && !this.ended && event.room.status === 'playing') {
        this.addLateJoinedPlayers();
      }
      return;
    }
    if (event.type === 'host-disconnected') {
      if (!this.isHost) this.handleHostDisconnected(event.checkpointReceived);
      return;
    }
    if (event.type === 'error') {
      this.showToast(event.message, true);
      return;
    }
    if (event.type !== 'game-message') return;
    this.handleGameMessage(event.message);
  }

  private handleGameMessage(message: UdpGameMessage): void {
    if (this.isHost) {
      if (message.kind === 'input') {
        const payload = message.payload as { mask?: number };
        this.hostInputs.set(message.fromPlayerId, Number(payload.mask ?? 0) & 15);
      } else if (message.kind === 'level-choice') {
        const payload = message.payload as { offerId: string; index: number };
        this.handleLevelChoice(message.fromPlayerId, payload.offerId, payload.index);
      } else if (message.kind === 'rune-input') {
        const payload = message.payload as { challengeId: string; direction: number };
        this.runeCoordinator?.handleInput(message.fromPlayerId, payload.challengeId, payload.direction);
      } else if (message.kind === 'checkpoint-request') {
        this.sendCheckpoint(message.fromPlayerId);
      } else if (message.kind === 'member-left') {
        const payload = message.payload as { playerId: string };
        this.markMemberLeft(payload.playerId);
      }
      return;
    }

    switch (message.kind) {
      case 'snapshot': this.clientRenderer?.apply(message.payload as WorldSnapshot); break;
      case 'checkpoint': this.applyCheckpoint(message.payload as PlayerCheckpointPayload); break;
      case 'level-offer': this.levelOverlay.show(message.payload as LevelOfferPayload); break;
      case 'level-applied': this.levelOverlay.complete((message.payload as { offerId: string }).offerId); break;
      case 'rune-state': this.handleRuneState(message.payload); break;
      case 'rune-effect': {
        const payload = message.payload as { playerId: string; runeType: 'shield' | 'multiAttack' };
        RuneActivationPresentation.play(this, payload.runeType);
        if (payload.runeType === 'multiAttack') {
          this.audio.effects.multiAttack.play();
          this.clientRenderer?.playMultiAttack(payload.playerId);
        } else this.audio.effects.shield.play();
        break;
      }
      case 'combat-effect': {
        const effect = message.payload as CombatEffectPayload;
        this.clientRenderer?.playCombatEffect(effect, () => {
          if (effect.type === 'explosion') this.audio.effects.explosion.play();
        });
        break;
      }
      case 'player-revived': {
        const payload = message.payload as { playerId?: string; playerName?: string };
        if (payload.playerId !== this.room.localPlayerId) {
          this.showToast(`${payload.playerName ?? '플레이어'}님이 부활했습니다.`);
        }
        break;
      }
      case 'difficulty-reduced': {
        const payload = message.payload as { playerName?: string };
        this.showToast(`${payload.playerName ?? '최고 레벨 플레이어'} 사망 · 난이도가 10% 낮아졌습니다.`);
        break;
      }
      case 'death-penalty': {
        const payload = message.payload as { levelBefore?: number; levelAfter?: number; statLabel?: string };
        this.showToast(
          `사망 페널티 · Lv ${payload.levelBefore ?? '?'} → ${payload.levelAfter ?? '?'}` +
          (payload.statLabel ? ` · ${payload.statLabel} 감소` : ''),
        );
        break;
      }
      case 'session-ended': this.showResultModal(); break;
      case 'member-left': {
        const payload = message.payload as { playerId?: string };
        if (payload.playerId) this.clientRenderer?.markPlayerLeft(payload.playerId);
        this.showToast('참가자가 게임에서 나갔습니다.');
        break;
      }
    }
  }

  private handleLocalDelivery(kind: string, payload: unknown): void {
    switch (kind) {
      case 'level-offer': this.levelOverlay.show(payload as LevelOfferPayload); break;
      case 'level-applied': this.levelOverlay.complete((payload as { offerId: string }).offerId); break;
      case 'rune-state': this.handleRuneState(payload); break;
      case 'checkpoint': this.applyCheckpoint(payload as PlayerCheckpointPayload); break;
      case 'death-penalty': {
        const result = payload as { levelBefore?: number; levelAfter?: number; statLabel?: string };
        this.showToast(
          `사망 페널티 · Lv ${result.levelBefore ?? '?'} → ${result.levelAfter ?? '?'}` +
          (result.statLabel ? ` · ${result.statLabel} 감소` : ''),
        );
        break;
      }
    }
  }

  private handleRuneState(payload: unknown): void {
    if (!isRuneStateEvent(payload)) return;
    const event: RuneStateEvent = payload;
    if (event.event === 'challenge') {
      if (event.challenge.playerId !== this.room.localPlayerId) return;
      this.runeOverlay.show(event.challenge);
      return;
    }
    if (!this.runeOverlay.matches(event.challengeId)) return;
    if (event.event === 'progress') this.runeOverlay.markAccepted(event.index, event.attempt);
    else if (event.event === 'retry') this.runeOverlay.retry(event.retryAt, event.attempt);
    else this.runeOverlay.complete(
      event.challengeId,
      event.attempt,
      event.index,
      event.cancelled === true,
    );
  }

  private giveSharedXp(value: number): void {
    for (const player of this.hostPlayers.values()) {
      if (player.stats.hp <= 0 || !player.sprite.active) continue;
      player.stats.xp += value;
      if (player.stats.xp >= player.stats.xpToNext) this.beginLevelUp(player);
    }
  }

  private beginLevelUp(player: PlayerController): void {
    const playerId = this.playerIds.get(player);
    const weapon = playerId ? this.hostWeapons.get(playerId) : undefined;
    if (!playerId || !weapon || [...this.pendingOffers.values()].some((offer) => offer.playerId === playerId)) return;
    if (player.stats.xp < player.stats.xpToNext) return;
    if (!advanceOneLevelIfReady(player.stats)) return;
    const payload: LevelOfferPayload = {
      offerId: createRuntimeId('level'),
      playerId,
      choices: generateLevelUpChoices(player.stats, weapon.definitions),
      expiresAt: Date.now() + 10_000,
    };
    const timer = this.time.delayedCall(10_000, () => this.handleLevelChoice(playerId, payload.offerId, 0));
    this.pendingOffers.set(payload.offerId, { payload, playerId, timer });
    this.deliver(playerId, 'level-offer', payload, true);
    this.audio.effects.jump.play();
  }

  private handleLevelChoice(playerId: string, offerId: string, index: number): void {
    const pending = this.pendingOffers.get(offerId);
    if (!pending || pending.playerId !== playerId) return;
    const choice: LevelUpChoice | undefined = pending.payload.choices[index];
    if (!choice) return;
    pending.timer.remove(false);
    this.pendingOffers.delete(offerId);
    const player = this.hostPlayers.get(playerId);
    const weapon = this.hostWeapons.get(playerId);
    if (!player || !weapon) return;
    const changed = applyLevelUpChoice(player.stats, weapon.definitions, choice);
    if (changed) weapon.refreshWeapon(changed);
    this.deliver(playerId, 'level-applied', { offerId, choice }, true);
    this.sendCheckpoint(playerId);
    if (player.stats.xp >= player.stats.xpToNext) this.beginLevelUp(player);
  }

  private handlePlayerDeath(player: PlayerController): void {
    const playerId = this.playerIds.get(player);
    if (!playerId || !player.sprite.active) return;
    const x = player.sprite.x;
    const y = player.sprite.y;
    const highestLevel = Math.max(...[...this.hostPlayers.values()].map((candidate) => (
      candidate.stats.level
    )));
    const reducesDifficulty = player.stats.level === highestLevel;
    const playerName = this.room.members.find((member) => member.playerId === playerId)?.name ?? '플레이어';
    const penalty = applyDeathPenalty(player.stats);
    this.deliver(playerId, 'death-penalty', {
      levelBefore: penalty.levelBefore,
      levelAfter: penalty.levelAfter,
      statLabel: penalty.stat ? PLAYER_STAT_LABELS[penalty.stat] : undefined,
    }, true);
    this.bossSuccess?.remove(player);
    player.enterDefeatedState('death');
    this.hostWeapons.get(playerId)?.setOwnerActive(false);
    this.cancelLevelOffers(playerId);
    this.runeCoordinator?.cancelPlayer(playerId);
    this.syncHostPlayerStatus(playerId, player, '유령');
    this.shieldLabels.get(playerId)?.setVisible(false);
    this.reviveCoordinator?.registerDeath(playerId, playerName, x, y);
    if (reducesDifficulty) {
      this.enemySystem?.reduceDifficultyAfterDeath();
      this.showToast(`${playerName} 사망 · 난이도가 10% 낮아졌습니다.`);
      udpClient.send('difficulty-reduced', { playerId, playerName }, { reliable: true });
      this.sendAllCheckpoints();
    } else {
      this.sendCheckpoint(playerId);
    }
    udpClient.send('player-died', { playerId, x, y }, { reliable: true });
    if ([...this.hostPlayers.values()].every((candidate) => candidate.stats.hp <= 0 || !candidate.sprite.active)) {
      this.finishSession();
    }
  }

  private markMemberLeft(playerId: string): void {
    if (this.leftRemovalTimers.has(playerId)) return;
    this.reviveCoordinator?.remove(playerId);
    this.cancelLevelOffers(playerId);
    this.runeCoordinator?.cancelPlayer(playerId);
    const player = this.hostPlayers.get(playerId);
    if (!player) return;
    player.stats.hp = 0;
    this.bossSuccess?.remove(player);
    player.enterDefeatedState('departure');
    this.hostWeapons.get(playerId)?.setOwnerActive(false);
    const playerName = this.room.members.find((member) => member.playerId === playerId)?.name ?? '플레이어';
    this.syncHostPlayerStatus(playerId, player, '이탈');
    this.shieldLabels.get(playerId)?.setVisible(false);
    const timer = this.time.delayedCall(
      PLAYER_LEAVE_GHOST_DURATION_MS,
      () => this.removeHostPlayer(playerId),
    );
    this.leftRemovalTimers.set(playerId, timer);
    if ([...this.hostPlayers.values()].every((candidate) => candidate.stats.hp <= 0 || !candidate.sprite.active)) {
      this.finishSession();
    }
  }

  private removeHostPlayer(playerId: string): void {
    this.leftRemovalTimers.delete(playerId);
    this.reviveCoordinator?.remove(playerId);
    this.cancelLevelOffers(playerId);
    this.runeCoordinator?.cancelPlayer(playerId);
    this.orbitLinks?.removePlayer(playerId);
    const weapon = this.hostWeapons.get(playerId);
    weapon?.destroy();
    this.hostWeapons.delete(playerId);
    const player = this.hostPlayers.get(playerId);
    if (player) {
      this.bossSuccess?.remove(player);
      this.playerIds.delete(player);
      player.destroy();
    }
    this.hostPlayers.delete(playerId);
    this.hostInputs.delete(playerId);
    this.playerStatusViews.get(playerId)?.destroy();
    this.playerStatusViews.delete(playerId);
    this.shieldLabels.get(playerId)?.destroy();
    this.shieldLabels.delete(playerId);
    this.hostShieldPresentations.get(playerId)?.destroy(false);
    this.hostShieldPresentations.delete(playerId);
    this.publisher?.removePlayer(playerId);
  }

  private sendAllCheckpoints(): void {
    for (const playerId of this.hostPlayers.keys()) this.sendCheckpoint(playerId);
  }

  private cancelLevelOffers(playerId: string): void {
    for (const [offerId, pending] of this.pendingOffers) {
      if (pending.playerId !== playerId) continue;
      pending.timer.remove(false);
      this.pendingOffers.delete(offerId);
      this.deliver(playerId, 'level-applied', { offerId, cancelled: true }, true);
    }
  }

  private sendCheckpoint(playerId: string): void {
    const checkpoint = this.buildCheckpoint(playerId);
    if (!checkpoint) return;
    this.deliver(playerId, 'checkpoint', checkpoint, true);
  }

  private buildCheckpoint(playerId: string): PlayerCheckpointPayload | null {
    const player = this.hostPlayers.get(playerId);
    const weapon = this.hostWeapons.get(playerId);
    const profile = this.room.privateProfiles?.[playerId];
    if (!player || !weapon || !profile) return null;
    const state: GameSaveState = {
      gameTime: this.progress.gameTime,
      killCount: this.progress.killCount,
      player: { x: player.sprite.x, y: player.sprite.y },
      stats: { ...player.stats, weapons: [...player.stats.weapons] },
      weaponLevels: weapon.getLevels(),
      progression: {
        normalGeneration: this.progress.normalGeneration,
        normalSpawnedInGeneration: this.progress.normalSpawnedInGeneration,
        normalKillCount: this.progress.normalKillCount,
        lastCompressedRollMinute: this.progress.lastCompressedRollMinute,
        bossGeneration: this.progress.bossGeneration,
        lastBossKillMilestone: this.progress.lastBossKillMilestone,
        lastRuneRollInterval: this.progress.lastRuneRollInterval,
        adaptiveDifficulty: { ...this.progress.adaptiveDifficulty },
      },
    };
    return { profileId: profile.profileId, state };
  }

  private applyCheckpoint(checkpoint: PlayerCheckpointPayload): void {
    if (checkpoint.profileId !== this.profileId) return;
    updateProfileState(this.profileId, checkpoint.state);
    this.syncLocalSkills(getProfile(this.profileId)?.state ?? checkpoint.state);
  }

  private deliver(playerId: string, kind: string, payload: unknown, reliable = false): void {
    if (playerId === this.room.localPlayerId) this.handleLocalDelivery(kind, payload);
    else udpClient.send(kind, payload, { targetPlayerId: playerId, reliable });
  }

  private updateHostHud(): void {
    const states = this.publisher?.playerStates() ?? [];
    this.partyHud.update(states, this.progress.gameTime, this.progress.killCount);
  }

  private createSkillHud(): void {
    this.skillHud = new WeaponStatusHud(this, {
      getWeaponKeys: () => (
        this.hostPlayers.get(this.room.localPlayerId)?.stats.weapons
        ?? this.localSkillState?.stats.weapons
        ?? ['whip']
      ),
      getWeapons: () => (
        this.hostWeapons.get(this.room.localPlayerId)?.definitions
        ?? this.localSkillDefinitions
      ),
      getWeaponTooltip: (key) => (
        this.hostWeapons.get(this.room.localPlayerId)?.getTooltipData(key)
        ?? buildWeaponTooltipData(this.localSkillDefinitions[key])
      ),
      getStats: () => (
        this.hostPlayers.get(this.room.localPlayerId)?.stats
        ?? this.localSkillState?.stats
        ?? createInitialPlayerStats()
      ),
    });
  }

  private addLateJoinedPlayers(): void {
    const profiles = this.room.privateProfiles ?? {};
    const addedPlayerIds: string[] = [];
    for (const member of this.room.members) {
      if (
        member.isHost ||
        member.presence !== 'playing' ||
        member.connection === 'left' ||
        this.hostPlayers.has(member.playerId)
      ) continue;
      const profile = profiles[member.playerId];
      if (!profile) continue;
      this.addLateJoinedPlayer(member, profile);
      addedPlayerIds.push(member.playerId);
    }
    if (addedPlayerIds.length === 0) return;
    this.publisher?.publish();
    addedPlayerIds.forEach((playerId) => this.sendCheckpoint(playerId));
  }

  private addLateJoinedPlayer(member: RoomMember, profile: NetworkProfile): void {
    const livingAnchor = [...this.hostPlayers.values()].find((player) => (
      player.stats.hp > 0 && player.sprite.active
    ));
    const anchor = livingAnchor?.sprite ?? this.hostPlayers.get(this.room.localPlayerId)?.sprite;
    const angle = member.joinOrder * 2.399963229728653;
    const radius = 82 + Math.floor(Math.max(0, member.joinOrder - 1) / 6) * 48;
    const boundary = ARENA_PLAYABLE_HALF_SIZE - 64;
    const spawn = {
      x: Phaser.Math.Clamp((anchor?.x ?? 0) + Math.cos(angle) * radius, -boundary, boundary),
      y: Phaser.Math.Clamp((anchor?.y ?? 0) + Math.sin(angle) * radius, -boundary, boundary),
    };
    this.hostInputs.set(member.playerId, 0);
    const player = new PlayerController(this, {
      skin: profile.skin || PLAYER_SKIN,
      spawn,
      isRunActive: () => !this.ended && player.stats.hp > 0,
      inputProvider: () => this.hostInputs.get(member.playerId) ?? 0,
      cameraFollow: false,
    });
    player.applySavedState(profile.state.stats, spawn);
    this.hostPlayers.set(member.playerId, player);
    this.playerIds.set(player, member.playerId);
    member.hp = player.stats.hp;
    member.maxHp = player.stats.maxHp;
    member.alive = true;

    const status = new PlayerStatusPresentation(this, spawn.x, spawn.y - 49, {
      name: member.name,
      level: player.stats.level,
      hp: player.stats.hp,
      maxHp: player.stats.maxHp,
      xp: player.stats.xp,
      xpToNext: player.stats.xpToNext,
    });
    const shield = this.add.text(spawn.x + 28, spawn.y - 34, '', uiTextStyle({
      fontSize: '9px', color: '#d4d7de', fontStyle: '800', stroke: '#0b0d12', strokeThickness: 2,
    })).setOrigin(0.5).setDepth(20);
    this.playerStatusViews.set(member.playerId, status);
    this.shieldLabels.set(member.playerId, shield);

    const weapon = new WeaponSystem(this, player, {
      getEnemies: () => this.enemySystem!.getActiveEnemies(),
      damageEnemy: (enemy, damage, knockback) => (
        this.enemySystem!.damageEnemy(enemy, damage, knockback)
      ),
      effects: this.audio.effects,
      ownerCenteredExplosionViewport: true,
      onExplosion: (effect) => udpClient.send('combat-effect', {
        type: 'explosion',
        ...effect,
      } satisfies CombatEffectPayload, { reliable: true }),
    });
    weapon.applySavedLevels(profile.state.weaponLevels);
    this.hostWeapons.set(member.playerId, weapon);
    this.enemySystem?.connectCombat(
      weapon,
      this.worldMap.environmentColliders,
      this.worldMap.waterLayer,
    );
    this.showToast(`${member.name}님이 진행 중인 게임에 참여했습니다.`);
    this.time.delayedCall(800, () => {
      if (!this.ended && player.stats.xp >= player.stats.xpToNext) this.beginLevelUp(player);
    });
  }

  private syncHostShieldPresentation(
    playerId: string,
    player: PlayerController,
    charges: number,
  ): void {
    let presentation = this.hostShieldPresentations.get(playerId);
    if (player.sprite.active && player.stats.hp > 0 && charges > 0) {
      if (!presentation) {
        presentation = new ShieldPresentation(this, player.sprite.x, player.sprite.y, charges);
        this.hostShieldPresentations.set(playerId, presentation);
      } else {
        presentation.sync(player.sprite.x, player.sprite.y, charges);
      }
      return;
    }
    if (!presentation) return;
    const depleted = player.sprite.active && player.stats.hp > 0 && presentation.charges > 0 && charges === 0;
    presentation.sync(player.sprite.x, player.sprite.y, charges);
    presentation.destroy(depleted);
    this.hostShieldPresentations.delete(playerId);
  }

  private syncHostPlayerStatus(
    playerId: string,
    player: PlayerController,
    status?: string,
  ): void {
    const name = this.room.members.find((member) => member.playerId === playerId)?.name ?? '플레이어';
    this.playerStatusViews.get(playerId)
      ?.setPosition(player.sprite.x, player.sprite.y - 49)
      .update({
        name,
        level: player.stats.level,
        hp: player.stats.hp,
        maxHp: player.stats.maxHp,
        xp: player.stats.xp,
        xpToNext: player.stats.xpToNext,
        status,
      });
  }

  private syncLocalSkills(state: GameSaveState): void {
    const signature = JSON.stringify([
      state.stats.weapons,
      state.weaponLevels,
    ]);
    this.localSkillState = state;
    applyWeaponDefinitionLevels(this.localSkillDefinitions, state.weaponLevels);
    if (signature === this.localSkillSignature) return;
    this.localSkillSignature = signature;
    this.skillHud?.refresh();
  }

  private updateHostOffscreenIndicators(): void {
    const targets: OffscreenIndicatorTarget[] = [];
    for (const member of this.room.members) {
      if (member.playerId === this.room.localPlayerId || member.connection === 'left') continue;
      const player = this.hostPlayers.get(member.playerId);
      if (!player) continue;
      targets.push({
        id: `player:${member.playerId}`,
        kind: 'player',
        label: `${member.name}${player.stats.hp <= 0 ? ' · 사망' : ''}`,
        groupLabel: member.name,
        x: player.sprite.x,
        y: player.sprite.y,
        active: true,
      });
    }
    this.enemySystem?.getActiveEnemies()
      .filter((enemy) => enemy.enemyType === 'boss')
      .forEach((boss) => targets.push({
        id: `boss:${boss.bossTier ?? 0}`,
        kind: 'boss',
        label: 'BOSS',
        x: boss.x,
        y: boss.y,
        active: boss.active,
      }));
    this.offscreenIndicatorHud.update(targets);
  }

  private updateClientOffscreenIndicators(players: NetPlayerState[]): void {
    const targets: OffscreenIndicatorTarget[] = players
      .filter((player) => player.id !== this.room.localPlayerId && player.connected)
      .map((player) => ({
        id: `player:${player.id}`,
        kind: 'player',
        label: `${player.name}${!player.alive ? ' · 사망' : ''}`,
        groupLabel: player.name,
        x: player.x,
        y: player.y,
        active: true,
      }));
    (this.clientRenderer?.bossStates ?? []).forEach((boss) => targets.push({
      id: `boss:${boss.id}`,
      kind: 'boss',
      label: 'BOSS',
      x: boss.x,
      y: boss.y,
      active: boss.hp > 0,
    }));
    this.offscreenIndicatorHud.update(targets);
  }

  private startSpectating(x: number, y: number): void {
    this.inputSource.stop();
    this.deathCamera.start(x, y);
    this.showToast('유령 상태 · 방향키로 맵을 둘러볼 수 있습니다.');
  }

  private resumePlaying(player: PlayerController): void {
    this.deathCamera.resumeFollowing(player.sprite);
    this.showToast('부활했습니다! 다시 전투에 참여합니다.');
  }

  private revivePlayer(
    playerId: string,
    reviverPlayerId: string,
    position: { x: number; y: number },
  ): void {
    const player = this.hostPlayers.get(playerId);
    if (!player) return;
    player.reviveAt(position.x, position.y, Math.ceil(player.stats.maxHp * 0.5));
    this.hostWeapons.get(playerId)?.setOwnerActive(true);
    const member = this.room.members.find((candidate) => candidate.playerId === playerId);
    if (member) {
      member.hp = player.stats.hp;
      member.maxHp = player.stats.maxHp;
      member.alive = true;
    }
    this.syncHostPlayerStatus(playerId, player);
    const reviverName = this.room.members.find((candidate) => candidate.playerId === reviverPlayerId)?.name;
    const playerName = member?.name ?? '플레이어';
    if (playerId !== this.room.localPlayerId) {
      this.showToast(reviverName ? `${reviverName}님이 ${playerName}님을 부활시켰습니다.` : `${playerName}님이 부활했습니다.`);
    }
    udpClient.send('player-revived', { playerId, playerName, reviverPlayerId }, { reliable: true });
    this.sendCheckpoint(playerId);
  }

  private finishSession(): void {
    if (this.ended) return;
    this.ended = true;
    this.sendAllCheckpoints();
    udpClient.send('session-ended', {
      gameTime: this.progress.gameTime,
      killCount: this.progress.killCount,
    }, { reliable: true });
    if (this.isHost) {
      this.roomResetPromise = udpClient.returnToLobby({ playerStates: this.buildReplayStates() });
      void this.roomResetPromise.then((room) => {
        this.room = room;
      }).catch((error) => {
        this.showToast(error instanceof Error ? error.message : '방을 다시 준비하지 못했습니다.', true);
      });
    }
    this.time.delayedCall(250, () => this.showResultModal());
  }

  private showResultModal(): void {
    if (this.children.getByName('multiplayer-result')) return;
    this.ended = true;
    const { width, height } = this.scale.gameSize;
    const root = this.add.container(width / 2, height / 2).setScrollFactor(0).setDepth(6000)
      .setName('multiplayer-result');
    const panel = createUiPanel(this, 0, 0, Math.min(390, width - 30), 210, {
      fill: UI_COLORS.panelDark, border: UI_COLORS.border, borderWidth: 2, radius: 18, shadow: true,
    });
    const title = this.add.text(0, -64, '협동 플레이 종료', uiTextStyle({
      fontSize: '24px', fontStyle: '800',
    })).setOrigin(0.5);
    const progress = this.isHost ? this.progress : this.clientRenderer?.progress;
    const result = this.add.text(0, -15,
      `생존 ${this.formatTime(progress?.gameTime ?? 0)} · 처치 ${progress?.killCount ?? 0}`,
      uiTextStyle({ fontSize: '14px', color: '#d4d7de', fontStyle: '700' })).setOrigin(0.5);
    const button = createUiButton(this, 0, 61, '방으로 돌아가기', {
      width: 220, fill: UI_COLORS.primary, border: UI_COLORS.primary,
    });
    button.on('pointerdown', () => { void this.returnToRoomLobby(); });
    root.add([panel, title, result, button]);
  }

  private buildReplayStates(): Record<string, GameSaveState> {
    const states: Record<string, GameSaveState> = {};
    for (const playerId of this.hostPlayers.keys()) {
      const checkpoint = this.buildCheckpoint(playerId);
      if (checkpoint) states[playerId] = checkpoint.state;
    }
    return states;
  }

  private async returnToRoomLobby(): Promise<void> {
    if (this.leaving) return;
    this.leaving = true;
    if (this.isHost && this.roomResetPromise) {
      try {
        await this.roomResetPromise;
      } catch {
        this.leaving = false;
        this.showToast('방을 다시 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.', true);
        return;
      }
    }
    if (!udpClient.currentRoom) {
      this.scene.start('RoomListScene', { profileId: this.profileId });
      return;
    }
    this.scene.start('RoomLobbyScene', { profileId: this.profileId });
  }

  private createExitButton(): void {
    const { width, height } = this.scale.gameSize;
    const position = calculateExitButtonPosition(width, height, shouldShowTouchControls());
    const button = createUiButton(
      this,
      position.x,
      position.y,
      '나가기',
      { width: 108, height: 42, fill: UI_COLORS.surfaceRaised, border: UI_COLORS.border },
    ).setScrollFactor(0).setDepth(4000);
    button.on('pointerdown', () => this.openExitModal());
    this.exitButton = button;
  }

  private openExitModal(): void {
    if (this.children.getByName('multiplayer-exit')) return;
    const { width, height } = this.scale.gameSize;
    const root = this.add.container(width / 2, height / 2).setScrollFactor(0).setDepth(5800)
      .setName('multiplayer-exit');
    const panel = createUiPanel(this, 0, 0, 350, 178, {
      fill: UI_COLORS.panelDark, border: UI_COLORS.border, borderWidth: 2, radius: 18, shadow: true,
    });
    const title = this.add.text(0, -51, this.isHost ? '방을 종료할까요?' : '게임에서 나갈까요?', uiTextStyle({
      fontSize: '19px', fontStyle: '800',
    })).setOrigin(0.5);
    const guide = this.add.text(0, -20,
      this.isHost ? '방장이 나가면 모든 참가자가 방 목록으로 이동합니다.' : '마지막 체크포인트를 저장한 뒤 나갑니다.',
      uiTextStyle({ fontSize: '11px', color: '#a7acb7', fontStyle: '600' })).setOrigin(0.5);
    const cancel = createUiButton(this, -82, 47, '취소', {
      width: 130, fill: UI_COLORS.surfaceRaised, border: UI_COLORS.border,
    });
    const exit = createUiButton(this, 82, 47, '나가기', {
      width: 130, fill: UI_COLORS.primary, border: UI_COLORS.primary,
    });
    cancel.on('pointerdown', () => root.destroy(true));
    exit.on('pointerdown', () => { void this.leaveToRoomList('game-left'); });
    root.add([panel, title, guide, cancel, exit]);
  }

  private isLocalInputBlocked(): boolean {
    return this.leaving
      || this.ended
      || this.levelOverlay.isOpen
      || this.runeOverlay.isOpen
      || Boolean(this.children.getByName('multiplayer-exit'));
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.syncResponsiveHud(gameSize);
  }

  private syncResponsiveHud(gameSize = this.scale.gameSize): void {
    const position = calculateExitButtonPosition(
      gameSize.width,
      gameSize.height,
      shouldShowTouchControls(),
    );
    this.exitButton?.setPosition(position.x, position.y);
    this.toast.setPosition(gameSize.width / 2, gameSize.height - 96);
    const exitModal = this.children.getByName('multiplayer-exit') as
      Phaser.GameObjects.Container | null;
    exitModal?.setPosition(gameSize.width / 2, gameSize.height / 2);
  }

  private async leaveToRoomList(reason: string): Promise<void> {
    if (this.leaving) return;
    this.leaving = true;
    try {
      if (this.isHost) this.sendAllCheckpoints();
      else udpClient.send('checkpoint-request', {}, { reliable: true });
      await new Promise((resolve) => window.setTimeout(resolve, 320));
      await udpClient.leaveRoom(reason);
      this.scene.start('RoomListScene', { profileId: this.profileId });
    } catch (error) {
      this.leaving = false;
      this.showToast(error instanceof Error ? error.message : '게임에서 나가지 못했습니다.', true);
    }
  }

  private handleHostDisconnected(checkpointReceived: boolean): void {
    if (this.leaving) return;
    this.leaving = true;
    this.ended = true;
    this.showToast(checkpointReceived
      ? '방장 연결이 종료되었습니다. 마지막 체크포인트를 저장했습니다.'
      : '방장 연결이 종료되었습니다.', true);
    this.time.delayedCall(900, () => {
      void udpClient.leaveRoom('host-disconnected').finally(() => {
        if (this.scene.isActive()) this.scene.start('RoomListScene', { profileId: this.profileId });
      });
    });
  }

  private showToast(message: string, isError = false): void {
    this.toast.showMessage(message, isError);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 1900, duration: 260 });
  }

  private formatTime(secondsTotal: number): string {
    const minutes = String(Math.floor(secondsTotal / 60)).padStart(2, '0');
    const seconds = String(secondsTotal % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }
}
