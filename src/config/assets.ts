import pathfinderTilesetUrl from '../../assets/pathfinder-tileset-64.png?url';

const LOCAL_ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;
const localAsset = (filename: string): string => `${LOCAL_ASSET_BASE}${filename}`;

// Int character Spine assets (FRONT, SIDE, BACK views)
export const SPINE_ASSETS = {
  front: {
    json: localAsset('f213ac35-2632-4b44-b0cb-74733abe020d.json'),
    atlas: localAsset('12ddc5da-6af0-43aa-94a8-dd236b82340c.atlas'),
  },
  side: {
    json: localAsset('8192e35c-9b89-4ae2-8cac-0786a29c4007.json'),
    atlas: localAsset('5c450607-179b-4634-8189-ef27caaebb73.atlas'),
  },
  back: {
    json: localAsset('5d3d8a38-bc12-4118-aac0-f14cc836c308.json'),
    atlas: localAsset('d35c7175-072e-4780-8f38-0e7a929b201c.atlas'),
  },
};

// Tower Defense dokkaebi Spine monsters, used in order as survival bosses.
export const BOSS_SPINE_ASSETS = [
  {
    key: 'bossDokkaebi1',
    json: localAsset('91881bdf-bacb-42b9-af78-199a40ffeef7.json'),
    atlas: localAsset('3ea03937-60f7-4fd4-b781-ec09f672c699.atlas'),
    skin: 'default',
    scale: 0.58,
    visualHeight: 145,
  },
  {
    key: 'bossDokkaebi2',
    json: localAsset('a04f9cff-4783-4a6b-8912-593315e3540f.json'),
    atlas: localAsset('fd98f130-ed43-47a8-8183-0bbfcf1c956a.atlas'),
    skin: 'default',
    scale: 0.43,
    visualHeight: 145,
  },
  {
    key: 'bossDokkaebi3',
    json: localAsset('7ba6feea-d762-4584-a320-132b54580855.json'),
    atlas: localAsset('6d1d5685-21c5-47f9-9883-baa9e4df68a8.atlas'),
    skin: 'armed01',
    scale: 0.38,
    visualHeight: 150,
  },
  {
    key: 'bossDokkaebi4',
    json: localAsset('31172676-f1cd-488e-89a6-6f94e77e1cb5.json'),
    atlas: localAsset('02e6ad0e-617b-47f4-88f1-4295d4dc57f2.atlas'),
    skin: 'armed01',
    scale: 0.3,
    visualHeight: 155,
  },
  {
    key: 'bossDokkaebi5',
    json: localAsset('977f3f49-f3cf-45cc-a84c-f9f48436ae6b.json'),
    atlas: localAsset('72580f3c-eee3-40dc-9d17-35ffcdd33c56.atlas'),
    skin: 'default',
    scale: 0.34,
    visualHeight: 155,
  },
] as const;

export const RUNE_SPINE_ASSETS = {
  multiAttack: {
    key: 'runeMultiAttack',
    json: localAsset('rune-multi-attack.json'),
    atlas: localAsset('rune-multi-attack.atlas'),
  },
  shield: {
    key: 'runeShield',
    json: localAsset('rune-shield.json'),
    atlas: localAsset('rune-shield.atlas'),
  },
} as const;

// Local assets organized by category
export const ASSETS = {
  // --- Pathfinder tilemap ---
  pathfinderTileset: pathfinderTilesetUrl,

  // --- Runner backgrounds (Forest AM layers - parallax) ---
  forestAM1: localAsset('ec90bf13-ef74-4f17-8890-3b763718c93b.png'),   // 851x1001 - sky/far
  forestAM2: localAsset('32bd4c70-e151-41b1-8cdc-371c2b46f05f.png'),   // 1247x1001 - mid trees
  forestAM3: localAsset('7f17d1b3-f04c-4c95-8b09-4714a601908d.png'),   // 1703x1001 - near trees
  forestAM4: localAsset('1dd255dc-a249-412b-9083-88f9f6e6f1a0.png'),   // 1900x1000 - ground
  // Runner backgrounds (Forest PM layers)
  forestPM1: localAsset('eb60145c-aeb3-458b-9d14-0659fcf379f0.png'),   // 1457x1001
  forestPM2: localAsset('3ae0ebbb-0e96-4350-8769-af820f9fe1e7.png'),
  forestPM3: localAsset('d585a95a-b8ff-40dd-b99c-8da92db6fbc3.png'),
  forestPM4: localAsset('d5fda054-3972-4359-a5ed-7e12941005c1.png'),
  // Runner backgrounds (Ground AM layers)
  groundAM1: localAsset('5ff130c0-41f2-40db-b6f8-2eb193c25888.png'),   // 2352x1001
  groundAM2: localAsset('d4f5adfa-e61f-489c-8d0b-06d4bf65d399.png'),   // 1049x1001
  groundAM3: localAsset('1394cb26-ee44-4174-928a-9d8a62578aae.png'),
  groundAM4: localAsset('575714c6-c74c-4089-aaf6-4fe99d30b09e.png'),
  groundAM5: localAsset('1bda3d9c-b703-407e-8dae-70c63291878c.png'),
  // Flap Int backgrounds
  blueBg:    localAsset('a0f3868b-7062-4b81-90aa-08a9d8dea9e2.png'),   // 850x500
  greenBg:   localAsset('29469ae2-b87a-43cd-9995-2e6c71f1d05e.png'),   // 850x500
  redBg:     localAsset('be1b0489-664b-4ad2-be25-7152792a8ecc.png'),   // 850x500

  // --- Decorations ---
  blueStone:   localAsset('3e48f4f5-b3a9-468e-afc3-85fca0c42f2a.png'),  // 85x128
  greenStone:  localAsset('610992b6-e90f-4da5-b312-a93c3cbaf2fe.png'),  // 85x128
  redStone:    localAsset('3382a52c-2762-4579-93b5-41af7ea8cbec.png'),  // 85x128
  bluePillar:  localAsset('ab4c3be7-b04b-4d38-bc24-de3408f803a6.png'),  // 32x287
  greenPillar: localAsset('a5820d62-27dc-4586-aea3-a482b7bb4641.png'),  // 32x285
  redPillar:   localAsset('44e4dd98-84e5-49d6-b756-533a2bbb9919.png'),  // 32x287

  // --- Obstacles (used as world obstacles AND enemy-related) ---
  obstacleBottom: localAsset('a728547f-8470-497f-81e1-911973fe64b0.png'), // 91x91
  obstacleMid:    localAsset('ab757c91-40f4-428d-b28b-9a6fe49d8b12.png'), // 91x91
  minePile:       localAsset('f3d05a97-259b-4560-ae2b-ca9e5357445e.png'), // 94x94
  nutObstacle:    localAsset('57e97185-484a-4f9b-a324-e2f82e4b62f7.png'), // 94x94
  flag:           localAsset('8f748aa7-42d8-43fe-9f0b-25a653266c9e.png'), // 91x181
  laserLauncher:  localAsset('eca79f2b-2c31-443f-8ee8-50f36e5090e2.png'), // 200x200

  // --- Items / Drops ---
  goldCoin:    localAsset('363bf833-23b3-4770-8380-0ae2fc81ccff.png'),  // 90x90
  silverCoin:  localAsset('1b249c1e-92d6-4e2f-af2f-3271891ab8ec.png'),  // 90x90
  star:        localAsset('ce05000e-96bf-4077-8924-d058682eca31.png'),  // 90x90
  lightning:   localAsset('342df3bd-a813-4f63-8d39-d3422b58d391.png'),  // 94x94
  dynamite:    localAsset('29337efb-9056-475f-909a-ffeb0f7e9be5.png'),  // 94x94
  dynamiteIcon: localAsset('250e8420-7ee1-4cc1-858d-1f205b84479d.png'),
  orbitOrb: localAsset('4f8ae5f9-dc7b-444e-a583-ba35a1f713c2-64.png'), // resized 260x260 -> 64x64
  aura: localAsset('7ea2d2cb-be52-4449-b8c1-74af45dd4ca2.png'),
  xpGem: localAsset('items/xp-gem.png'),
  healthHeart: localAsset('items/health-heart.png'),
  magnet: localAsset('items/magnet.png'),
  speedIcon: localAsset('items/speed-boot.png'),
  armorIcon: localAsset('items/armor-shield.png'),
  whipIcon: localAsset('items/whip.png'),
  runeSign: localAsset('items/rune-sign.png'),
  runeKeyAtlasImage: localAsset('rune-key-atlas.png'),
  runeKeyAtlasJson: localAsset('rune-key-atlas.json'),

  // --- Monster spritesheet (Cloud Bounce) ---
  monsterSheet: localAsset('fc98932d-11bf-4cc5-a5bc-742be86fdf29.png'), // 242x1089, 121x121 per frame
  // CB general atlas PNG (explosions, bullets, platforms, etc.)
  cbAtlasImg:  localAsset('f24b9ddb-5fe0-4d5c-b304-7803f2f79387.png'), // 935x367

  // --- UI ---
  gameover: localAsset('532684c0-b1a3-437e-a1c7-780cb88ebaea.png'),    // 483x96
  gaugeBase:  localAsset('3bddec15-30a7-4704-8f23-a7c63c7288b8.png'),
  gaugeClear: localAsset('7ea2d2cb-be52-4449-b8c1-74af45dd4ca2.png'),
  gaugeBreak: localAsset('0a5d07db-039c-4369-aeb1-92c3d6834eac.png'),
  gaugeOver:  localAsset('159c5956-e383-4553-8669-e9571720e7e6.png'),

  // --- Numbers ---
  number0: localAsset('242ec8e8-a19f-477c-9992-02314e882505.png'),
  number1: localAsset('1596d393-e837-4220-972e-4c07a67089ce.png'),
  number2: localAsset('9bbf58eb-7101-479b-a009-eceab2cc38b2.png'),
  number3: localAsset('cae8d90c-fa01-4e4d-8cdc-2410d01303cd.png'),
  number4: localAsset('dedabb95-cdd5-4a47-bda0-6a36d75e8154.png'),
  number5: localAsset('efd139e9-8a4b-43a8-a597-508b648b771f.png'),
  number6: localAsset('e469f1e2-f2c7-4983-afd2-d5ff36a285ee.png'),
  number7: localAsset('6eb65000-0abf-4dc0-b8ad-51e2a1a40044.png'),
  number8: localAsset('84b4a370-02d1-42ff-af56-150075b1ef36.png'),
  number9: localAsset('91481688-eb7c-46cf-b3c2-afaf4652f395.png'),

  // --- Audio ---
  coinSfx:      localAsset('5b5a07ec-518d-4e8c-abaa-cfc0aec650ef.mp3'),
  failSfx:      localAsset('c57613ac-c5e2-4006-84a1-837481634284.mp3'),
  jumpSfx:      localAsset('b2d321ed-2b20-4566-8c2f-95ff4f634f23.mp3'),
  explosionSfx: localAsset('34b93d64-6a89-43e9-a9b1-1da8b0db67c7.mp3'),
  bgmCyber:     localAsset('8d55e3ce-c97a-49df-99cc-bec98f78030a.mp3'),
  bgmSpace:     localAsset('83191c3f-ceb4-488c-bec4-52e4ea5d0e17.mp3'),
  bgmSea:       localAsset('c91905b4-0fef-44c5-b946-56ea6f9780df.mp3'),
  boingSfx:     localAsset('851ce369-3f7b-4ddd-8f22-bdaeac579036.mp3'),
  springSfx:    localAsset('f4fd425f-c45c-4c6a-a38e-eb6a29e46951.mp3'),
  bombSfx:      localAsset('3e10debb-6ef3-4cd8-9782-bbff0c05e13c.mp3'),
  giggleSfx:    localAsset('55f37dbe-4758-4400-b971-bba910a0bf82.mp3'),
  screamSfx:    localAsset('af818056-9e02-40d7-b0d0-a52f21e04ddd.mp3'),
  thumpSfx:     localAsset('0ab09aab-32fe-4152-8ffb-825b42f780e9.mp3'),
  runeMultiAttackSfx: localAsset('rune-multi-attack.mp3'),
  runeShieldSfx: localAsset('rune-shield.mp3'),
};
