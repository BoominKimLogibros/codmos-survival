import {
  ASSETS,
  BOSS_SPAWN_SPINE_ASSET,
  BOSS_SPINE_ASSETS,
  EXPLOSION_SPINE_ASSET,
  MONSTER_PORTAL_SPINE_ASSET,
  RUNE_SPINE_ASSETS,
  SPINE_ASSETS,
} from '../config/assets';
import { SKIN_OPTIONS } from '../config/skins';
import { createFlagSwingEffectTexture } from '../objects/FlagPresentation';
import { createUiPanel, UI_COLORS, uiTextStyle } from '../ui/theme';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const progressBar = this.add.graphics();
    const progressBox = createUiPanel(this, w / 2, h / 2, 340, 108, {
      fill: UI_COLORS.panel, border: UI_COLORS.border, borderWidth: 5, radius: 24,
    });
    const loadingText = this.add.text(w / 2, h / 2 - 28, '로딩 중...', uiTextStyle({
      fontSize: '20px', fontStyle: '800',
    })).setOrigin(0.5);
    const percentText = this.add.text(w / 2, h / 2 + 23, '0%', uiTextStyle({
      fontSize: '14px', color: '#d4d7de', fontStyle: '800',
    })).setOrigin(0.5);

    this.load.on('progress', (v: number) => {
      progressBar.clear();
      progressBar.fillStyle(UI_COLORS.panelDeep, 1);
      progressBar.fillRoundedRect(w / 2 - 145, h / 2 - 4, 290, 14, 7);
      progressBar.fillStyle(UI_COLORS.primary, 1);
      progressBar.fillRoundedRect(w / 2 - 145, h / 2 - 4, 290 * v, 14, 7);
      percentText.setText(Math.floor(v * 100) + '%');
    });
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.warn('Failed to load asset:', file.key, file.src);
    });
    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
      percentText.destroy();
    });

    this.load.image('fortressArena', ASSETS.fortressArena);

    // Menu / lobby backgrounds
    this.load.image('blueBg', ASSETS.blueBg);
    this.load.image('redBg', ASSETS.redBg);

    // Items / Drops
    this.load.image('goldCoin', ASSETS.goldCoin);
    this.load.image('silverCoin', ASSETS.silverCoin);
    this.load.image('star', ASSETS.star);
    this.load.image('lightning', ASSETS.lightning);
    this.load.image('dynamite', ASSETS.dynamite);
    this.load.image('orbitOrb', ASSETS.orbitOrb);
    this.load.image('aura', ASSETS.aura);
    this.load.image('xpGem', ASSETS.xpGem);
    this.load.image('bossXpReward', ASSETS.bossXpReward);
    this.load.image('healthPotion', ASSETS.healthPotion);
    this.load.image('flag', ASSETS.flag);
    this.load.image('flagAttack', ASSETS.flagAttack);
    this.load.image('runeItem', ASSETS.runeItem);
    this.load.image('runeEmbedded', ASSETS.runeEmbedded);
    this.load.svg('runeAttackActivation', ASSETS.runeAttackActivation);
    this.load.svg('runeDefenseActivation', ASSETS.runeDefenseActivation);
    this.load.atlas('runeKeyAtlas', ASSETS.runeKeyAtlasImage, ASSETS.runeKeyAtlasJson);
    this.load.svg('statMaxHpIcon', ASSETS.statMaxHpIcon);
    this.load.svg('statArmorIcon', ASSETS.statArmorIcon);
    this.load.svg('statMoveSpeedIcon', ASSETS.statMoveSpeedIcon);
    this.load.svg('statMagnetIcon', ASSETS.statMagnetIcon);
    this.load.svg('statRecoveryIcon', ASSETS.statRecoveryIcon);

    // Monster spritesheet (CB): 242x1089, each frame 121x121, 2 cols x 9 rows = 18 frames
    this.load.spritesheet('monsterSheet', ASSETS.monsterSheet, {
      frameWidth: 121,
      frameHeight: 121,
    });

    SKIN_OPTIONS.forEach((skin) => {
      this.load.image(skin.thumbnailKey, skin.thumbnailUrl);
    });

    // Audio
    this.load.audio('coinSfx', ASSETS.coinSfx);
    this.load.audio('failSfx', ASSETS.failSfx);
    this.load.audio('jumpSfx', ASSETS.jumpSfx);
    this.load.audio('explosionSfx', ASSETS.explosionSfx);
    this.load.audio('bgmCyber', ASSETS.bgmCyber);
    this.load.audio('bgmSpace', ASSETS.bgmSpace);
    this.load.audio('bgmSea', ASSETS.bgmSea);
    this.load.audio('boingSfx', ASSETS.boingSfx);
    this.load.audio('springSfx', ASSETS.springSfx);
    this.load.audio('bombSfx', ASSETS.bombSfx);
    this.load.audio('screamSfx', ASSETS.screamSfx);
    this.load.audio('thumpSfx', ASSETS.thumpSfx);
    this.load.audio('runeMultiAttackSfx', ASSETS.runeMultiAttackSfx);
    this.load.audio('runeShieldSfx', ASSETS.runeShieldSfx);

    // Spine character (Int) - FRONT, SIDE, BACK
    this.load.spine('intFront', SPINE_ASSETS.front.json, SPINE_ASSETS.front.atlas);
    this.load.spine('intSide', SPINE_ASSETS.side.json, SPINE_ASSETS.side.atlas);
    this.load.spine('intBack', SPINE_ASSETS.back.json, SPINE_ASSETS.back.atlas);
    BOSS_SPINE_ASSETS.forEach((boss) => {
      this.load.spine(boss.key, boss.json, boss.atlas);
    });
    this.load.spine(
      BOSS_SPAWN_SPINE_ASSET.key,
      BOSS_SPAWN_SPINE_ASSET.json,
      BOSS_SPAWN_SPINE_ASSET.atlas,
    );
    this.load.spine(
      MONSTER_PORTAL_SPINE_ASSET.key,
      MONSTER_PORTAL_SPINE_ASSET.json,
      MONSTER_PORTAL_SPINE_ASSET.atlas,
    );
    Object.values(RUNE_SPINE_ASSETS).forEach((effect) => {
      this.load.spine(effect.key, effect.json, effect.atlas);
    });
    this.load.spine(
      EXPLOSION_SPINE_ASSET.key,
      EXPLOSION_SPINE_ASSET.json,
      EXPLOSION_SPINE_ASSET.atlas,
    );
  }

  create(): void {
    // Generate minimal procedural textures only for things that have no CDN asset
    this._makeTexture('player', 32, 32, (g) => {
      g.fillStyle(0x4fc3f7, 1); g.fillCircle(16, 16, 14);
      g.fillStyle(0xffffff, 1); g.fillCircle(11, 12, 4); g.fillCircle(21, 12, 4);
      g.fillStyle(0x1a237e, 1); g.fillCircle(12, 12, 2); g.fillCircle(22, 12, 2);
      g.fillStyle(0xff7043, 1); g.fillRect(10, 22, 12, 3);
    });
    this._makeTexture('projectile', 8, 8, (g) => {
      g.fillStyle(0x00e5ff, 1); g.fillCircle(4, 4, 4);
    });
    this._makeTexture('bolt', 16, 20, (g) => {
      g.fillStyle(0xffeb3b, 1);
      g.fillTriangle(8, 0, 0, 12, 10, 10);
      g.fillTriangle(6, 8, 16, 8, 8, 20);
    });
    createFlagSwingEffectTexture(this);
    this.scene.start('MenuScene');
  }

  _makeTexture(
    key: string,
    w: number,
    h: number,
    draw: (graphics: Phaser.GameObjects.Graphics) => void,
  ): void {
    const g = this.add.graphics();
    draw(g);
    g.generateTexture(key, w, h);
    g.destroy();
  }
}
