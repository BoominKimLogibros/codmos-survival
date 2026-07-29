export const GAME_WIDTH = 800;
export const GAME_HEIGHT = 600;
export const PLAYER_SKIN = 'basic';
export const PLAYER_SCALE = 0.06;
export const PLAYER_HIT_FEEDBACK_DURATION_MS = 150;
export const TILE_SIZE = 64;
export const WORLD_TILES = 32;
export const WORLD_SIZE = TILE_SIZE * WORLD_TILES;
export const GROUND_TILE_FRAMES = [0, 1];
export const TREE_TILE_FRAMES = [66, 67, 68, 69, 70];
export const BOSS_KILL_INTERVAL = 1000;
export const BOSS_EVOLUTION_MULTIPLIER = 1.5;
export const BOSS_XP_REWARD_BASE = 300;
export const BOSS_XP_REWARD_MULTIPLIER = 1.35;
export const RETRY_BOSS_DELAY_MS = 30 * 1000;
export const ADAPTIVE_DIFFICULTY_INTERVAL_MS = 60 * 1000;
export const ADAPTIVE_INITIAL_ACTIVE_TARGET = 80;
export const ADAPTIVE_MIN_ACTIVE_TARGET = 30;
export const ADAPTIVE_MAX_ENEMIES = 1000;
export const ADAPTIVE_INITIAL_SPAWN_BATCH = 3;
export const ADAPTIVE_MAX_SPAWN_BATCH = 40;
export const ADAPTIVE_INITIAL_SPAWN_INTERVAL_MS = 1500;
export const ADAPTIVE_MIN_SPAWN_INTERVAL_MS = 300;
export const ADAPTIVE_MAX_SPAWN_INTERVAL_MS = 5000;
export const ADAPTIVE_MAX_HP_MULTIPLIER = 12;
export const ADAPTIVE_MIN_BOSS_KILL_INTERVAL = 250;
export const COMPRESSED_EQUIVALENT_MONSTERS = 100;
export const COMPRESSED_SPAWN_INTERVAL_SECONDS = 60;
export const COMPRESSED_SPAWN_CHANCE = 0.001;
export const COMPRESSED_SIZE_MULTIPLIER = 5;
export const COMPRESSED_ATTACK_MULTIPLIER = 5;
export const MAX_VISIBLE_HP_GRID_CELLS = 30;
export const MELEE_HIT_INTERVAL_MS = 200;
export const RUNE_ROLL_INTERVAL_SECONDS = 5 * 60;
export const RUNE_SPAWN_CHANCE = 0.5;
export const RUNE_SPAWN_ENEMY_THRESHOLD = 100;
export const RUNE_SPAWN_ENEMY_BONUS_PER_100 = 0.05;
export const RUNE_SPAWN_MAX_CHANCE = 0.95;
export const RUNE_RETRY_DELAY_MS = 3000;
export const RUNE_SEQUENCE_LENGTH = 4;
export const RUNE_SHIELD_BLOCK_COUNT = 10;
export const RUNE_CHARGE_DURATION_MS = 3000;
export const RUNE_CHARGE_RADIUS = 42;
export const SHIELD_KNOCKBACK_SPEED = 260;
export const SHIELD_KNOCKBACK_DURATION_MS = 200;
export const SAVE_FORMAT = 'codmos-survivors-save';
export const SAVE_VERSION = 1;
export const MAX_SAVE_FILE_SIZE = 1024 * 1024;
// Gameplay treats weapon progression as unlimited. This high validation ceiling
// only prevents corrupted or hand-crafted saves from overflowing runtime math.
export const MAX_WEAPON_LEVEL = 1_000_000;
export const SAVE_WEAPON_MAX_LEVELS = {
  whip: MAX_WEAPON_LEVEL,
  bolt: MAX_WEAPON_LEVEL,
  aura: MAX_WEAPON_LEVEL,
  explosion: MAX_WEAPON_LEVEL,
  shield: MAX_WEAPON_LEVEL,
};

// Monster frame mapping (from CB monster spritesheet: 242x1089, 121x121 grid)
// Row layout: 2 columns per row. Frame order: col0=destroyed, col1=idle (per pair)
// Frames 0-17: cyber1_destr, cyber1_idle, cyber2_destr, cyber2_idle, ...
export const MONSTER_FRAMES = {
  cyber1: { idle: 1, destroyed: 0 },
  cyber2: { idle: 3, destroyed: 2 },
  cyber3: { idle: 5, destroyed: 4 },
  sea1:   { idle: 7, destroyed: 6 },
  sea2:   { idle: 9, destroyed: 8 },
  sea3:   { idle: 11, destroyed: 10 },
  space1: { idle: 13, destroyed: 12 },
  space2: { idle: 15, destroyed: 14 },
  space3: { idle: 17, destroyed: 16 },
};
