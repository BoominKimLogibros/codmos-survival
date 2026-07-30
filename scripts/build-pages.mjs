import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/pages');
const media = resolve(output, 'media');

await mkdir(media, { recursive: true });

for (const filename of ['index.html', 'styles.css', 'app.js']) {
  await cp(resolve(root, 'pages', filename), resolve(output, filename));
}

const assets = {
  'game-icon.png': 'public/assets/codmos-survivors-app-icon.png',
  'space-bg.png': 'public/assets/a0f3868b-7062-4b81-90aa-08a9d8dea9e2.png',
  'avatar-71.png': 'public/assets/profile-thumbnails/71.png',
  'avatar-39.png': 'public/assets/profile-thumbnails/39.png',
  'avatar-52.png': 'public/assets/profile-thumbnails/52.png',
  'monster-sheet.png': 'public/assets/fc98932d-11bf-4cc5-a5bc-742be86fdf29.png',
  'item-whip.png': 'public/assets/items/whip.png',
  'item-armor.png': 'public/assets/items/armor-shield.png',
  'item-rune.png': 'public/assets/items/rune-sign.png',
  'item-xp.png': 'public/assets/items/xp-gem.png',
  'Nunito-Regular.ttf': 'public/fonts/Nunito-Regular.ttf',
  'Nunito-SemiBold.ttf': 'public/fonts/Nunito-SemiBold.ttf',
  'Nunito-ExtraBold.ttf': 'public/fonts/Nunito-ExtraBold.ttf',
};

await Promise.all(Object.entries(assets).map(([target, source]) => (
  cp(resolve(root, source), resolve(media, target))
)));
