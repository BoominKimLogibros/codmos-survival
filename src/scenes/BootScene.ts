import {
  ASSETS,
  BOSS_SPINE_ASSETS,
  RUNE_SPINE_ASSETS,
  SPINE_ASSETS,
} from '../config/assets';
import { TILE_SIZE } from '../config/constants';
import { SKIN_OPTIONS } from '../config/skins';
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

    // --- Locally resized 64x64 tile spritesheet ---
    this.load.spritesheet('survivalTileset', ASSETS.pathfinderTileset, {
      frameWidth: TILE_SIZE,
      frameHeight: TILE_SIZE,
    });

    // --- CDN Images ---
    // Backgrounds
    this.load.image('forestAM1', ASSETS.forestAM1);
    this.load.image('forestAM2', ASSETS.forestAM2);
    this.load.image('forestAM3', ASSETS.forestAM3);
    this.load.image('forestAM4', ASSETS.forestAM4);
    this.load.image('forestPM1', ASSETS.forestPM1);
    this.load.image('forestPM2', ASSETS.forestPM2);
    this.load.image('forestPM3', ASSETS.forestPM3);
    this.load.image('forestPM4', ASSETS.forestPM4);
    this.load.image('groundAM1', ASSETS.groundAM1);
    this.load.image('groundAM2', ASSETS.groundAM2);
    this.load.image('blueBg', ASSETS.blueBg);
    this.load.image('greenBg', ASSETS.greenBg);
    this.load.image('redBg', ASSETS.redBg);

    // Decorations
    this.load.image('blueStone', ASSETS.blueStone);
    this.load.image('greenStone', ASSETS.greenStone);
    this.load.image('redStone', ASSETS.redStone);
    this.load.image('bluePillar', ASSETS.bluePillar);
    this.load.image('greenPillar', ASSETS.greenPillar);
    this.load.image('redPillar', ASSETS.redPillar);
    this.load.image('obstacleBottom', ASSETS.obstacleBottom);
    this.load.image('obstacleMid', ASSETS.obstacleMid);
    this.load.image('minePile', ASSETS.minePile);
    this.load.image('nutObstacle', ASSETS.nutObstacle);
    this.load.image('flag', ASSETS.flag);
    this.load.image('laserLauncher', ASSETS.laserLauncher);

    // Items / Drops
    this.load.image('goldCoin', ASSETS.goldCoin);
    this.load.image('silverCoin', ASSETS.silverCoin);
    this.load.image('star', ASSETS.star);
    this.load.image('lightning', ASSETS.lightning);
    this.load.image('dynamite', ASSETS.dynamite);
    this.load.image('dynamiteIcon', ASSETS.dynamiteIcon);
    this.load.image('orbitOrb', ASSETS.orbitOrb);
    this.load.image('aura', ASSETS.aura);
    this.load.image('xpGem', ASSETS.xpGem);
    this.load.image('healthOrb', ASSETS.healthHeart);
    this.load.image('magnet', ASSETS.magnet);
    this.load.image('speedIcon', ASSETS.speedIcon);
    this.load.image('armorIcon', ASSETS.armorIcon);
    this.load.image('whipIcon', ASSETS.whipIcon);
    this.load.image('rune', ASSETS.runeSign);
    this.load.atlas('runeKeyAtlas', ASSETS.runeKeyAtlasImage, ASSETS.runeKeyAtlasJson);

    // Monster spritesheet (CB): 242x1089, each frame 121x121, 2 cols x 9 rows = 18 frames
    this.load.spritesheet('monsterSheet', ASSETS.monsterSheet, {
      frameWidth: 121,
      frameHeight: 121,
    });

    // UI
    this.load.image('gameover', ASSETS.gameover);
    this.load.image('gaugeBase', ASSETS.gaugeBase);
    this.load.image('gaugeClear', ASSETS.gaugeClear);
    this.load.image('gaugeBreak', ASSETS.gaugeBreak);
    this.load.image('gaugeOver', ASSETS.gaugeOver);
    SKIN_OPTIONS.forEach((skin) => {
      this.load.image(skin.thumbnailKey, skin.thumbnailUrl);
    });
    for (let i = 0; i <= 9; i++) {
      const assetKey = `number${i}` as keyof typeof ASSETS;
      this.load.image(assetKey, ASSETS[assetKey]);
    }

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
    this.load.audio('giggleSfx', ASSETS.giggleSfx);
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
    Object.values(RUNE_SPINE_ASSETS).forEach((effect) => {
      this.load.spine(effect.key, effect.json, effect.atlas);
    });
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
    // Whip slash: curved crescent blade shape (160x80 canvas)
    this._makeTexture('whipSlash', 160, 80, (g) => {
      // Build a crescent from thick arcs (no opaque fill cut-out)
      // Outer glow (wide, soft)
      g.lineStyle(18, 0xfff176, 0.25);
      g.beginPath(); g.arc(80, 90, 70, Math.PI + 0.4, 2 * Math.PI - 0.4, false); g.strokePath();
      // Main slash arc (bright gold, medium width)
      g.lineStyle(10, 0xffd54f, 0.85);
      g.beginPath(); g.arc(80, 90, 65, Math.PI + 0.35, 2 * Math.PI - 0.35, false); g.strokePath();
      // Inner bright highlight (thin white)
      g.lineStyle(3, 0xffffff, 0.9);
      g.beginPath(); g.arc(80, 90, 60, Math.PI + 0.4, 2 * Math.PI - 0.4, false); g.strokePath();
      // Tip sparkle at both ends of the arc
      const r = 65;
      const a1 = Math.PI + 0.35, a2 = 2 * Math.PI - 0.35;
      g.fillStyle(0xffffff, 0.95);
      g.fillCircle(80 + Math.cos(a1) * r, 90 + Math.sin(a1) * r, 5);
      g.fillCircle(80 + Math.cos(a2) * r, 90 + Math.sin(a2) * r, 5);
      g.fillStyle(0xfff176, 0.5);
      g.fillCircle(80 + Math.cos(a1) * r, 90 + Math.sin(a1) * r, 9);
      g.fillCircle(80 + Math.cos(a2) * r, 90 + Math.sin(a2) * r, 9);
      // Extra particle dots along the arc for trail effect
      for (let t = 0; t < 5; t++) {
        const a = a1 + (a2 - a1) * (t + 0.5) / 5;
        g.fillStyle(0xfff9c4, 0.4 + t * 0.1);
        g.fillCircle(80 + Math.cos(a) * (r + 5), 90 + Math.sin(a) * (r + 5), 2 + Math.random() * 2);
      }
    });
    this._makeTexture('bolt', 16, 20, (g) => {
      g.fillStyle(0xffeb3b, 1);
      g.fillTriangle(8, 0, 0, 12, 10, 10);
      g.fillTriangle(6, 8, 16, 8, 8, 20);
    });
    this._makeTexture('explosionFx', 64, 64, (g) => {
      g.fillStyle(0xff6e40, 0.6); g.fillCircle(32, 32, 32);
      g.fillStyle(0xffab40, 0.4); g.fillCircle(32, 32, 20);
    });
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
