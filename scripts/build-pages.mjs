import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/pages');
const media = resolve(output, 'media');
const videos = resolve(output, 'videos');

await Promise.all([
  mkdir(media, { recursive: true }),
  mkdir(videos, { recursive: true }),
]);

for (const filename of ['index.html', 'styles.css', 'app.js']) {
  await cp(resolve(root, 'pages', filename), resolve(output, filename));
}

await cp(resolve(root, 'pages', 'videos'), videos, { recursive: true });

const assets = {
  'game-icon.png': 'public/assets/codmos-survivors-app-icon.png',
  'space-bg.png': 'public/assets/backgrounds/menu-blue.png',
  'avatar-71.png': 'public/assets/profile-thumbnails/71.png',
  'avatar-39.png': 'public/assets/profile-thumbnails/39.png',
  'avatar-52.png': 'public/assets/profile-thumbnails/52.png',
  'monster-sheet.png': 'public/assets/monsters/cloud-bounce-sheet.png',
  'item-flag.png': 'public/assets/items/flag.png',
  'item-armor.png': 'public/assets/items/armor-shield.png',
  'item-rune.png': 'public/assets/items/rune-item.png',
  'item-xp.png': 'public/assets/items/xp-gem.png',
  'Nunito-Regular.ttf': 'public/fonts/Nunito-Regular.ttf',
  'Nunito-SemiBold.ttf': 'public/fonts/Nunito-SemiBold.ttf',
  'Nunito-ExtraBold.ttf': 'public/fonts/Nunito-ExtraBold.ttf',
};

await Promise.all(Object.entries(assets).map(([target, source]) => (
  cp(resolve(root, source), resolve(media, target))
)));
