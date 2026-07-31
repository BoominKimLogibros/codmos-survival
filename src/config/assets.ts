const LOCAL_ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;
const localAsset = (filename: string): string => `${LOCAL_ASSET_BASE}${filename}`;

// Int character Spine assets (FRONT, SIDE, BACK views)
export const SPINE_ASSETS = {
  front: {
    json: localAsset('characters/player-front.json'),
    atlas: localAsset('characters/player-front.atlas'),
  },
  side: {
    json: localAsset('characters/player-side.json'),
    atlas: localAsset('characters/player-side.atlas'),
  },
  back: {
    json: localAsset('characters/player-back.json'),
    atlas: localAsset('characters/player-back.atlas'),
  },
};

// Tower Defense dokkaebi Spine monsters, used in order as survival bosses.
export const BOSS_SPINE_ASSETS = [
  {
    key: 'bossDokkaebi1',
    json: localAsset('bosses/dokkaebi-fire-slam.json'),
    atlas: localAsset('bosses/dokkaebi-fire-slam.atlas'),
    skin: 'default',
    scale: 0.58,
    visualHeight: 145,
  },
  {
    key: 'bossDokkaebi2',
    json: localAsset('bosses/dokkaebi-agile-striker.json'),
    atlas: localAsset('bosses/dokkaebi-agile-striker.atlas'),
    skin: 'default',
    scale: 0.43,
    visualHeight: 145,
  },
  {
    key: 'bossDokkaebi3',
    json: localAsset('bosses/dokkaebi-heavy-armored.json'),
    atlas: localAsset('bosses/dokkaebi-heavy-armored.atlas'),
    skin: 'armed01',
    scale: 0.38,
    visualHeight: 150,
  },
  {
    key: 'bossDokkaebi4',
    json: localAsset('bosses/dokkaebi-inline-dasher.json'),
    atlas: localAsset('bosses/dokkaebi-inline-dasher.atlas'),
    skin: 'armed01',
    scale: 0.3,
    visualHeight: 155,
  },
  {
    key: 'bossDokkaebi5',
    json: localAsset('bosses/dokkaebi-frost-mage.json'),
    atlas: localAsset('bosses/dokkaebi-frost-mage.atlas'),
    skin: 'default',
    scale: 0.34,
    visualHeight: 155,
  },
] as const;

// Shared summoning Spine played before each boss reveals its own spawn motion.
export const BOSS_SPAWN_SPINE_ASSET = {
  key: 'bossSpawnSpine',
  json: localAsset('effects/boss-spawn.json'),
  atlas: localAsset('effects/boss-spawn.atlas'),
  skin: 'default',
  animation: 'idle',
} as const;

export const MONSTER_PORTAL_SPINE_ASSET = {
  key: 'monsterPortalSpine',
  json: localAsset('effects/monster-portal.json'),
  atlas: localAsset('effects/monster-portal.atlas'),
  skin: 'default',
  animation: 'idle_round',
} as const;

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

export const EXPLOSION_SPINE_ASSET = {
  key: 'explosionSpine',
  json: localAsset('effects/explosion-spine.json'),
  atlas: localAsset('effects/explosion-spine.atlas'),
} as const;

// Local assets organized by category
export const ASSETS = {
  // --- Survival map ---
  fortressArena: localAsset('maps/fortress-arena-flat-v2.png'),

  // --- Menu / lobby backgrounds ---
  blueBg: localAsset('backgrounds/menu-blue.png'),
  redBg: localAsset('backgrounds/menu-red.png'),

  // --- Items / Drops ---
  goldCoin: localAsset('items/gold-coin.png'), // 90x90
  silverCoin: localAsset('items/silver-coin.png'), // 90x90
  star: localAsset('items/star.png'), // 90x90
  lightning: localAsset('items/lightning.png'), // 94x94
  dynamite: localAsset('items/dynamite.png'), // 94x94
  orbitOrb: localAsset('items/orbit-orb.png'), // resized 260x260 -> 64x64
  aura: localAsset('items/aura.png'),
  xpGem: localAsset('items/xp-gem.png'),
  bossXpReward: localAsset('items/boss-xp-reward.png'),
  healthPotion: localAsset('items/hp-potion.png'),
  flag: localAsset('items/flag.png'),
  flagAttack: localAsset('items/flag-attack.png'),
  runeItem: localAsset('items/rune-item.png'),
  runeEmbedded: localAsset('items/rune-embedded.png'),
  runeAttackActivation: localAsset('runes/activation-attack.svg'),
  runeDefenseActivation: localAsset('runes/activation-defense.svg'),
  runeKeyAtlasImage: localAsset('rune-key-atlas.png'),
  runeKeyAtlasJson: localAsset('rune-key-atlas.json'),

  // --- Player stats ---
  statMaxHpIcon: localAsset('stats/max-hp.svg'),
  statArmorIcon: localAsset('stats/armor.svg'),
  statMoveSpeedIcon: localAsset('stats/move-speed.svg'),
  statMagnetIcon: localAsset('stats/magnet.svg'),
  statRecoveryIcon: localAsset('stats/recovery.svg'),

  // --- Monster spritesheet (Cloud Bounce) ---
  monsterSheet: localAsset('monsters/cloud-bounce-sheet.png'), // 242x1089, 121x121 per frame
  // --- Audio ---
  coinSfx: localAsset('audio/sfx-coin.mp3'),
  failSfx: localAsset('audio/sfx-fail.mp3'),
  jumpSfx: localAsset('audio/sfx-jump.mp3'),
  explosionSfx: localAsset('audio/sfx-explosion.mp3'),
  bgmCyber: localAsset('audio/bgm-cyber.mp3'),
  bgmSpace: localAsset('audio/bgm-space.mp3'),
  bgmSea: localAsset('audio/bgm-sea.mp3'),
  boingSfx: localAsset('audio/sfx-boing.mp3'),
  springSfx: localAsset('audio/sfx-spring.mp3'),
  bombSfx: localAsset('audio/sfx-bomb.mp3'),
  screamSfx: localAsset('audio/sfx-scream.mp3'),
  thumpSfx: localAsset('audio/sfx-thump.mp3'),
  runeMultiAttackSfx: localAsset('rune-multi-attack.mp3'),
  runeShieldSfx: localAsset('rune-shield.mp3'),
};
