import { createDefaultGameState } from '../config/defaultState';
import {
  isSkinUnlocked,
  normalizeUnlockedSkinName,
} from '../config/skins';
import {
  createSignedSaveFile,
  normalizeSaveState,
  readProfileSaveFile,
} from './saveService';
import type { GameSaveState, Profile } from '../game/types';

const STORAGE_KEY = 'codmos-survival-profiles-v1';
const PROFILE_STORE_VERSION = 1;
const MAX_PROFILE_NAME_LENGTH = 20;

interface ProfileStore {
  version: number;
  selectedProfileId: string;
  profiles: Profile[];
}

interface CreateProfileOptions {
  name?: string;
  skin?: string;
  state?: GameSaveState | null;
}

let storeCache: ProfileStore | null = null;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createId(): string {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeProfileName(name: unknown, fallback = '프로필'): string {
  const normalized = String(name || '').trim().replace(/\s+/g, ' ');
  return (normalized || fallback).slice(0, MAX_PROFILE_NAME_LENGTH);
}

function makeUniqueName(name: unknown, profiles: Profile[]): string {
  const base = sanitizeProfileName(name, '프로필');
  if (!profiles.some((profile) => profile.name === base)) return base;
  let index = 2;
  while (profiles.some((profile) => profile.name === `${base.slice(0, 16)} ${index}`)) index++;
  return `${base.slice(0, 16)} ${index}`;
}

function createDefaultProfile(name = '프로필 1'): Profile {
  const now = new Date().toISOString();
  return {
    id: createId(),
    name,
    skin: 'basic',
    state: createDefaultGameState(),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeStoredProfile(rawProfile: unknown, index: number): Profile | null {
  if (!rawProfile || typeof rawProfile !== 'object') return null;
  const stored = rawProfile as Partial<Profile>;
  const legacy = rawProfile as Record<string, unknown>;
  try {
    const state = normalizeSaveState(
      stored.state ?? legacy.gameState ?? legacy.saveData ?? createDefaultGameState(),
    );
    return {
      id: typeof stored.id === 'string' && stored.id ? stored.id : createId(),
      name: sanitizeProfileName(stored.name, `프로필 ${index + 1}`),
      skin: normalizeUnlockedSkinName(stored.skin, state.stats.level),
      state,
      createdAt: typeof stored.createdAt === 'string' ? stored.createdAt : new Date().toISOString(),
      updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : new Date().toISOString(),
    };
  } catch (error) {
    console.warn('Ignoring invalid local profile:', error);
    return null;
  }
}

function persistStore(store: ProfileStore): boolean {
  storeCache = store;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch (error) {
    console.error('Failed to persist profiles:', error);
    return false;
  }
}

function loadStore(): ProfileStore {
  if (storeCache) return storeCache;
  let parsed: Partial<ProfileStore> | null = null;
  try {
    parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null') as Partial<ProfileStore> | null;
  } catch (error) {
    console.warn('Invalid local profile data; creating a default profile:', error);
  }

  const profiles = Array.isArray(parsed?.profiles)
    ? parsed.profiles.map(normalizeStoredProfile).filter((profile): profile is Profile => profile !== null)
    : [];
  if (profiles.length === 0) profiles.push(createDefaultProfile());
  const storedSelection = parsed?.selectedProfileId;
  const selectedProfileId = storedSelection && profiles.some((profile) => profile.id === storedSelection)
    ? storedSelection
    : profiles[0].id;
  const store: ProfileStore = {
    version: PROFILE_STORE_VERSION,
    selectedProfileId,
    profiles,
  };
  persistStore(store);
  return store;
}

export function getProfiles(): Profile[] {
  return clone(loadStore().profiles);
}

export function getProfile(profileId: string | null | undefined): Profile | null {
  const profile = loadStore().profiles.find((item) => item.id === profileId);
  return profile ? clone(profile) : null;
}

export function getSelectedProfileId(): string {
  return loadStore().selectedProfileId;
}

export function selectProfile(profileId: string): boolean {
  const store = loadStore();
  if (!store.profiles.some((profile) => profile.id === profileId)) return false;
  store.selectedProfileId = profileId;
  persistStore(store);
  return true;
}

export function createProfile({
  name,
  skin = 'basic',
  state = null,
}: CreateProfileOptions = {}): Profile {
  const store = loadStore();
  const now = new Date().toISOString();
  const normalizedState = normalizeSaveState(state || createDefaultGameState());
  const profile: Profile = {
    id: createId(),
    name: makeUniqueName(name || `프로필 ${store.profiles.length + 1}`, store.profiles),
    skin: normalizeUnlockedSkinName(skin, normalizedState.stats.level),
    state: normalizedState,
    createdAt: now,
    updatedAt: now,
  };
  store.profiles.push(profile);
  store.selectedProfileId = profile.id;
  persistStore(store);
  return clone(profile);
}

export function renameProfile(profileId: string, name: string): Profile | null {
  const store = loadStore();
  const profile = store.profiles.find((item) => item.id === profileId);
  if (!profile) return null;
  const requestedName = sanitizeProfileName(name, profile.name);
  profile.name = makeUniqueName(requestedName, store.profiles.filter((item) => item.id !== profileId));
  profile.updatedAt = new Date().toISOString();
  persistStore(store);
  return clone(profile);
}

export function changeProfileSkin(profileId: string, skin: string): Profile | null {
  const store = loadStore();
  const profile = store.profiles.find((item) => item.id === profileId);
  if (!profile) return null;
  if (!isSkinUnlocked(skin, profile.state.stats.level)) return null;
  profile.skin = normalizeUnlockedSkinName(skin, profile.state.stats.level);
  profile.updatedAt = new Date().toISOString();
  persistStore(store);
  return clone(profile);
}

export function updateProfileState(profileId: string, state: GameSaveState): boolean {
  const store = loadStore();
  const profile = store.profiles.find((item) => item.id === profileId);
  if (!profile) return false;
  const normalizedState = normalizeSaveState(state);
  profile.state = clone(normalizedState);
  profile.skin = normalizeUnlockedSkinName(profile.skin, normalizedState.stats.level);
  profile.updatedAt = new Date().toISOString();
  return persistStore(store);
}

/** Resets gameplay data while preserving the profile's identity and user-defined name. */
export function resetProfile(profileId: string): Profile | null {
  const store = loadStore();
  const profile = store.profiles.find((item) => item.id === profileId);
  if (!profile) return null;
  profile.skin = 'basic';
  profile.state = createDefaultGameState();
  profile.updatedAt = new Date().toISOString();
  persistStore(store);
  return clone(profile);
}

export async function importProfile(file: File): Promise<Profile> {
  const imported = await readProfileSaveFile(file);
  const fallbackName = file.name.replace(/\.codmos$/i, '').replace(/^codmos-save-?/i, '') || '가져온 프로필';
  return createProfile({
    name: imported.profile?.name || fallbackName,
    skin: imported.profile?.skin || 'basic',
    state: imported.state,
  });
}

export async function downloadProfile(profileId: string): Promise<void> {
  const profile = getProfile(profileId);
  if (!profile) throw new Error('Profile not found');
  const saveFile = await createSignedSaveFile(profile.state, {
    name: profile.name,
    skin: profile.skin,
  });
  const blob = new Blob([JSON.stringify(saveFile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = profile.name.replace(/[^a-zA-Z0-9가-힣_-]+/g, '-').replace(/^-|-$/g, '') || 'profile';
  link.href = url;
  link.download = `codmos-${safeName}.codmos`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function resetProfileStoreForTests(): void {
  storeCache = null;
}
