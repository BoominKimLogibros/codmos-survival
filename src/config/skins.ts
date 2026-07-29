// Source: codmos-enable3d/src/scripts/int/int_skn.ts > IntSkn.SPINE.SKIN_NM
export interface SkinOption {
  id: number;
  name: string;
  requiredLevel: number;
  thumbnailKey: string;
  thumbnailUrl: string;
}

const SKIN_DEFINITIONS = [
  { id: 1, name: 'basic' },
  { id: 2, name: 'pink' },
  { id: 3, name: 'yellow' },
  { id: 4, name: 'purple' },
  { id: 5, name: 'black' },
  { id: 22, name: 'pharos' },
  { id: 23, name: 'plant' },
  { id: 24, name: 'marble' },
  { id: 25, name: 'volta' },
  { id: 26, name: 'cloud' },
  { id: 27, name: 'pattern' },
  { id: 28, name: 'sherlock' },
  { id: 29, name: 'bookmon' },
  { id: 30, name: 'armstrong' },
  { id: 31, name: 'baker' },
  { id: 32, name: 'barista' },
  { id: 33, name: 'runner' },
  { id: 34, name: 'soldier' },
  { id: 35, name: 'wildland' },
  { id: 36, name: 'bear' },
  { id: 37, name: 'alien' },
  { id: 38, name: 'fairy' },
  { id: 39, name: 'dragon' },
  { id: 43, name: 'dino' },
  { id: 44, name: 'hero' },
  { id: 45, name: 'pierrot' },
  { id: 48, name: 'delicious' },
  { id: 49, name: 'flapint' },
  { id: 50, name: 'monitorhead' },
  { id: 51, name: 'rose' },
  { id: 52, name: 'snackking' },
  { id: 71, name: 'cloudbounce' },
  { id: 72, name: 'ecofarm' },
  { id: 73, name: 'miner' },
  { id: 95, name: 'wizard' },
] as const;

const SKIN_THUMBNAIL_BASE = `${import.meta.env.BASE_URL}assets/profile-thumbnails/`;

export const SKIN_OPTIONS: readonly SkinOption[] = SKIN_DEFINITIONS.map(({ id, name }) => ({
  id,
  name,
  requiredLevel: id,
  thumbnailKey: `skin-thumbnail-${id}`,
  thumbnailUrl: `${SKIN_THUMBNAIL_BASE}${id}.png`,
}));

export const SKIN_NAMES = SKIN_OPTIONS.map((skin) => skin.name);
const DEFAULT_SKIN = SKIN_OPTIONS[0];

export function normalizeSkinName(skinName: unknown): string {
  return typeof skinName === 'string' && SKIN_NAMES.includes(skinName) ? skinName : 'basic';
}

export function getSkinOption(skinName: unknown): SkinOption {
  const normalizedName = normalizeSkinName(skinName);
  return SKIN_OPTIONS.find((skin) => skin.name === normalizedName) ?? DEFAULT_SKIN;
}

export function isSkinUnlocked(skinName: unknown, level: number): boolean {
  return level >= getSkinOption(skinName).requiredLevel;
}

export function normalizeUnlockedSkinName(skinName: unknown, level: number): string {
  const normalizedName = normalizeSkinName(skinName);
  return isSkinUnlocked(normalizedName, level) ? normalizedName : DEFAULT_SKIN.name;
}
