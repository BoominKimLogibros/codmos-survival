import { PLAYER_SKIN, RETRY_BOSS_DELAY_MS } from '../config/constants';
import { AudioManager } from '../game/AudioManager';
import { BossSuccessCoordinator } from '../game/BossSuccessCoordinator';
import { DeathCameraController } from '../game/DeathCameraController';
import { EnemySystem } from '../game/EnemySystem';
import { GameHud } from '../game/GameHud';
import { PlayerController } from '../game/PlayerController';
import { RuneSystem } from '../game/RuneSystem';
import {
  createInitialRunProgress,
  type GameSaveState,
  type GameSceneData,
  type LevelUpChoice,
  type RunProgress,
  type WeaponKey,
} from '../game/types';
import { WeaponSystem } from '../game/WeaponSystem';
import { WorldMap } from '../objects/WorldMap';
import { DeathMarker } from '../objects/DeathMarker';
import { getProfile, updateProfileState } from '../services/profileService';
import { stableStringify } from '../services/saveService';
import { GameOverModal } from '../ui/GameOverModal';
import { applyLevelUpChoice } from '../game/levelUp';
import { NetworkInputSource } from '../network/NetworkInputSource';
import {
  advanceOneLevelIfReady,
  applyDeathPenalty,
  PLAYER_STAT_LABELS,
} from '../game/progression';

/**
 * Coordinates the gameplay systems. Object behavior lives in the dedicated
 * PlayerController, WeaponSystem, EnemySystem, and GameHud modules.
 */
export class GameScene extends Phaser.Scene {
  private pendingSaveState: GameSaveState | null = null;
  private profileId: string | null = null;
  private profileSkin = PLAYER_SKIN;
  private retryAssist = false;

  private progress: RunProgress = createInitialRunProgress();
  private isPaused = false;
  private runeChallengeActive = false;
  private gameOver = false;
  private levelUpActive = false;
  private levelUpCheckScheduled = false;
  private lastAutoSaveAt = 0;
  private lastAutoSaveSnapshot = '';

  private worldMap!: WorldMap;
  private player!: PlayerController;
  private audio!: AudioManager;
  private weapons!: WeaponSystem;
  private enemySystem!: EnemySystem;
  private runeSystem!: RuneSystem;
  private hud!: GameHud;
  private deathCamera!: DeathCameraController;
  private deathMarker?: DeathMarker;
  private gameOverModal?: GameOverModal;
  private inputSource!: NetworkInputSource;
  private bossSuccess?: BossSuccessCoordinator;
  private readonly toggleExitModal = (): void => this.hud?.toggleExitModal();

  constructor() {
    super('GameScene');
  }

  init(data: GameSceneData = {}): void {
    this.pendingSaveState = data.saveData ?? null;
    this.profileId = data.profileId ?? null;
    this.profileSkin = data.profileSkin ?? PLAYER_SKIN;
    this.retryAssist = data.retryAssist ?? false;
  }

  create(): void {
    this.resetRuntimeState();
    this.worldMap = new WorldMap(this);
    this.deathCamera = new DeathCameraController(this);
    this.inputSource = new NetworkInputSource(this);
    this.player = new PlayerController(this, {
      skin: this.profileSkin,
      spawn: this.worldMap.playerSpawn,
      isRunActive: () => !this.isPaused && !this.gameOver,
      inputProvider: () => this.inputSource.read(!this.isPaused && !this.gameOver),
    });
    this.audio = new AudioManager(this);
    this.enemySystem = new EnemySystem(
      this,
      this.player,
      this.audio,
      this.progress,
      {
        showToast: (message, isError) => this.hud?.showToast(message, isError),
        onLevelUp: () => this.startLevelUp(),
        onPlayerDeath: () => this.finishGame(),
        isGameOver: () => this.gameOver,
        tryBlockPlayerHit: () => this.runeSystem?.tryBlockPlayerHit() ?? false,
        getDifficultyGrowthProfiles: () => [{
          level: this.player.stats.level,
          enhancementLevel: this.player.stats.weapons.reduce((sum, key) => (
            sum + Math.max(0, (this.weapons?.definitions[key]?.level ?? 1) - 1)
          ), 0),
        }],
        onBossKilled: () => this.bossSuccess?.celebrate(),
      },
    );
    this.weapons = new WeaponSystem(this, this.player, {
      getEnemies: () => this.enemySystem.getActiveEnemies(),
      damageEnemy: (enemy, damage, knockback) => (
        this.enemySystem.damageEnemy(enemy, damage, knockback)
      ),
      effects: this.audio.effects,
    });
    this.bossSuccess = new BossSuccessCoordinator(
      this,
      () => [{ player: this.player, weapons: this.weapons }],
      () => this.enemySystem.getActiveEnemies(),
      (enemy, damage) => this.enemySystem.damageEnemy(enemy, damage),
    );
    this.runeSystem = new RuneSystem(
      this,
      this.player,
      this.audio,
      this.progress,
      {
        getEnemies: () => this.enemySystem.getActiveEnemies(),
        damageEnemy: (enemy, damage) => this.enemySystem.damageEnemy(enemy, damage),
        onChallengeOpened: () => this.pauseForRuneChallenge(),
        onChallengeCompleted: () => this.resumeFromRuneChallenge(),
        showToast: (message, isError) => this.hud?.showToast(message, isError),
      },
    );

    if (this.pendingSaveState) this.applySaveState(this.pendingSaveState);

    this.enemySystem.connectCombat(
      this.weapons,
      this.worldMap.environmentColliders,
      this.worldMap.waterLayer,
    );
    if (this.pendingSaveState) {
      this.enemySystem.resumeFromSavedProgress(this.retryAssist ? RETRY_BOSS_DELAY_MS : 0);
    }
    this.hud = new GameHud(this, {
      getStats: () => this.player.stats,
      getProgress: () => this.progress,
      getWeapons: () => this.weapons.definitions,
      getWeaponTooltip: (key) => this.weapons.getTooltipData(key),
      canOpenExit: () => (
        !this.gameOver &&
        !this.runeChallengeActive &&
        !this.scene.isActive('LevelUpScene')
      ),
      onExitOpened: () => this.pauseForExit(),
      onExitClosed: () => this.resumeFromExit(),
      onExitConfirmed: () => this.exitToMenu(),
    });

    const keyboard = this.input.keyboard!;
    keyboard.on('keydown-ESC', this.toggleExitModal);
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (!this.isPaused && !this.gameOver) this.progress.gameTime++;
      },
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard.off('keydown-ESC', this.toggleExitModal);
      this.autoSaveProfile(true);
    });
    this.autoSaveProfile(true);
    if (this.retryAssist) {
      this.hud.showToast('재도전 · 난이도는 최근 1분 전투 결과에 맞춰 자동 조정됩니다.');
    }
    this.schedulePendingLevelUp();
  }

  update(_time: number, delta: number): void {
    this.inputSource.update(!this.isPaused && !this.gameOver);
    if (this.gameOver) {
      this.deathCamera.update(delta);
      return;
    }
    if (this.isPaused) return;
    this.player.update();
    this.bossSuccess?.update(delta);
    this.weapons.update(delta);
    this.enemySystem.update(delta);
    this.runeSystem.update(delta);
    this.hud.update();
    this.autoSaveProfile();
  }

  resumeFromLevelUp(choice: LevelUpChoice): void {
    // Pointer and keyboard events can arrive in the same frame. Only the first
    // selection may mutate the player or close the current level-up cycle.
    if (this.gameOver || !this.levelUpActive) return;
    this.levelUpActive = false;
    const changedWeapon = applyLevelUpChoice(
      this.player.stats,
      this.weapons.definitions,
      choice,
    );
    if (changedWeapon) this.weapons.refreshWeapon(changedWeapon);
    this.hud.refreshWeaponIcons();
    this.autoSaveProfile(true);

    if (this.player.stats.xp >= this.player.stats.xpToNext) {
      // LevelUpScene is still active while its selection callback is running.
      // Launching it again synchronously and then stopping the old instance
      // leaves GameScene paused with no modal. Defer the next level until the
      // current overlay has completed its shutdown.
      this.isPaused = true;
      this.physics.pause();
      this.schedulePendingLevelUp();
      return;
    }

    this.isPaused = false;
    this.physics.resume();
  }

  private resetRuntimeState(): void {
    this.progress = createInitialRunProgress();
    this.isPaused = false;
    this.runeChallengeActive = false;
    this.gameOver = false;
    this.levelUpActive = false;
    this.levelUpCheckScheduled = false;
    this.lastAutoSaveAt = 0;
    this.lastAutoSaveSnapshot = '';
    this.bossSuccess = undefined;
  }

  private pauseForExit(): void {
    this.autoSaveProfile(true);
    this.isPaused = true;
    this.physics.pause();
    this.audio.pause();
  }

  private resumeFromExit(): void {
    this.isPaused = false;
    this.physics.resume();
    this.audio.resume();
  }

  private exitToMenu(): void {
    this.autoSaveProfile(true);
    this.scene.start('MenuScene');
  }

  private pauseForRuneChallenge(): void {
    this.runeChallengeActive = true;
    this.isPaused = true;
    this.physics.pause();
    this.audio.pause();
    this.autoSaveProfile(true);
  }

  private resumeFromRuneChallenge(): void {
    this.runeChallengeActive = false;
    this.isPaused = false;
    this.physics.resume();
    this.audio.resume();
    this.autoSaveProfile(true);
    this.schedulePendingLevelUp();
  }

  private schedulePendingLevelUp(delay = 0): void {
    if (
      this.levelUpCheckScheduled ||
      this.gameOver ||
      this.runeChallengeActive ||
      !this.player ||
      this.player.stats.xp < this.player.stats.xpToNext
    ) return;

    this.levelUpCheckScheduled = true;
    this.time.delayedCall(delay, () => {
      this.levelUpCheckScheduled = false;
      if (
        this.gameOver ||
        this.runeChallengeActive ||
        this.levelUpActive ||
        this.player.stats.xp < this.player.stats.xpToNext
      ) return;
      if (this.scene.isActive('LevelUpScene')) {
        this.schedulePendingLevelUp(16);
        return;
      }
      this.startLevelUp();
    });
  }

  private startLevelUp(): void {
    if (
      this.runeChallengeActive ||
      this.levelUpActive ||
      this.gameOver ||
      this.scene.isActive('LevelUpScene') ||
      this.player.stats.xp < this.player.stats.xpToNext
    ) return;
    const stats = this.player.stats;
    if (!advanceOneLevelIfReady(stats)) return;
    this.levelUpActive = true;
    this.audio.effects.jump.play();
    const effect = this.add.circle(this.player.sprite.x, this.player.sprite.y, 20, 0xffd54f, 0.5)
      .setDepth(10);
    this.tweens.add({
      targets: effect,
      scaleX: 4,
      scaleY: 4,
      alpha: 0,
      duration: 500,
      onComplete: () => effect.destroy(),
    });
    this.autoSaveProfile(true);
    this.isPaused = true;
    this.physics.pause();
    this.scene.launch('LevelUpScene', {
      stats,
      weaponDefinitions: this.weapons.definitions,
    });
  }

  private finishGame(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.levelUpActive = false;
    if (this.scene.isActive('LevelUpScene')) this.scene.stop('LevelUpScene');
    this.enemySystem.reduceDifficultyAfterDeath();
    const penalty = applyDeathPenalty(this.player.stats);
    const penaltyText = `사망 페널티 · Lv ${penalty.levelBefore} → ${penalty.levelAfter}` +
      (penalty.stat ? ` · ${PLAYER_STAT_LABELS[penalty.stat]} 감소` : '');
    this.autoSaveProfile(true);
    const deathPosition = { x: this.player.sprite.x, y: this.player.sprite.y };
    this.physics.pause();
    this.audio.stop();
    this.audio.effects.fail.play();
    this.bossSuccess?.remove(this.player);
    this.player.enterDefeatedState();
    this.weapons.setOwnerActive(false);
    this.hud.enterGameOverState();
    this.hud.update();
    this.deathMarker = new DeathMarker(this, deathPosition.x, deathPosition.y);
    this.deathCamera.start(deathPosition.x, deathPosition.y);
    this.cameras.main.shake(300, 0.02);
    this.cameras.main.flash(300, 255, 0, 0);
    this.gameOverModal = new GameOverModal(this, {
      time: this.progress.gameTime,
      kills: this.progress.killCount,
      level: this.player.stats.level,
      penalty: penaltyText,
      onRetry: () => this.restartProfile(),
      onMenu: () => this.exitToMenu(),
    });
  }

  private restartProfile(): void {
    const profile = getProfile(this.profileId);
    if (!profile) {
      this.scene.start('MenuScene');
      return;
    }
    this.scene.start('GameScene', {
      profileId: profile.id,
      profileSkin: profile.skin,
      saveData: profile.state,
      retryAssist: true,
    });
  }

  private buildSaveState(): GameSaveState {
    const stats = this.player.stats;
    return {
      gameTime: this.progress.gameTime,
      killCount: this.progress.killCount,
      player: { x: this.player.sprite.x, y: this.player.sprite.y },
      stats: { ...stats, weapons: [...stats.weapons] },
      weaponLevels: this.weapons.getLevels(),
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
  }

  private applySaveState(saveState: GameSaveState): void {
    const { adaptiveDifficulty, ...progression } = saveState.progression;
    Object.assign(this.progress, {
      gameTime: saveState.gameTime,
      killCount: saveState.killCount,
      ...progression,
    });
    Object.assign(this.progress.adaptiveDifficulty, adaptiveDifficulty);
    this.player.applySavedState(saveState.stats, saveState.player);
    this.weapons.applySavedLevels(saveState.weaponLevels);
  }

  private autoSaveProfile(force = false): boolean {
    if (!this.profileId || !this.player || !this.weapons) return false;
    const now = this.time?.now ?? performance.now();
    if (!force && now - this.lastAutoSaveAt < 300) return false;
    this.lastAutoSaveAt = now;
    const state = this.buildSaveState();
    const snapshot = stableStringify(state);
    if (!force && snapshot === this.lastAutoSaveSnapshot) return false;
    if (!updateProfileState(this.profileId, state)) return false;
    this.lastAutoSaveSnapshot = snapshot;
    return true;
  }
}
