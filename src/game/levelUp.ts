import type { LevelUpChoice, PlayerStats, WeaponDefinitions, WeaponKey } from './types';
import { MAX_WEAPON_LEVEL } from '../config/constants';
import { PLAYER_STAT_ICONS } from '../config/statIcons';

export function canUpgradeWeapon(definition: WeaponDefinitions[WeaponKey]): boolean {
  return definition.level < MAX_WEAPON_LEVEL &&
    (definition.maxLevel === null || definition.level < definition.maxLevel);
}

export function generateLevelUpChoices(
  stats: PlayerStats,
  definitions: WeaponDefinitions,
): LevelUpChoice[] {
  const choices: LevelUpChoice[] = [];
  stats.weapons.forEach((key) => {
    const definition = definitions[key];
    if (canUpgradeWeapon(definition)) {
      choices.push({
        type: 'upgradeWeapon',
        key,
        name: `${definition.name} Lv${definition.level + 1}`,
        desc: definition.desc,
        levelText: `Lv${definition.level} → Lv${definition.level + 1}`,
        icon: definition.icon,
      });
    }
  });
  if (stats.weapons.length < 5) {
    (Object.keys(definitions) as WeaponKey[])
      .filter((key) => !stats.weapons.includes(key))
      .forEach((key) => {
        const definition = definitions[key];
        choices.push({
          type: 'newWeapon',
          key,
          name: `신규: ${definition.name}`,
          desc: definition.desc,
          levelText: '새 무기!',
          icon: definition.icon,
        });
      });
  }
  ([
    { stat: 'maxHp', name: '+20 최대 체력', desc: '최대 체력 증가', icon: PLAYER_STAT_ICONS.maxHp },
    { stat: 'speed', name: '+15 이동속도', desc: '더 빠르게 이동', icon: PLAYER_STAT_ICONS.speed },
    { stat: 'armor', name: '+2 방어력', desc: '받는 피해 감소', icon: PLAYER_STAT_ICONS.armor },
    { stat: 'magnet', name: '+30 자석', desc: '더 먼 거리의 경험치 흡수', icon: PLAYER_STAT_ICONS.magnet },
    { stat: 'recovery', name: '+0.5 회복', desc: '시간에 따라 체력 회복', icon: PLAYER_STAT_ICONS.recovery },
  ] as const).forEach((choice) => choices.push({ type: 'stat', ...choice }));
  Phaser.Utils.Array.Shuffle(choices);
  return choices.slice(0, 3);
}

export function applyLevelUpChoice(
  stats: PlayerStats,
  definitions: WeaponDefinitions,
  choice: LevelUpChoice,
): WeaponKey | null {
  let changedWeapon: WeaponKey | null = null;
  if (choice.type === 'newWeapon' && choice.key && !stats.weapons.includes(choice.key)) {
    stats.weapons.push(choice.key);
    changedWeapon = choice.key;
  } else if (choice.type === 'upgradeWeapon' && choice.key) {
    const definition = definitions[choice.key];
    definition.level = Math.min(
      definition.maxLevel ?? MAX_WEAPON_LEVEL,
      definition.level + 1,
    );
    changedWeapon = choice.key;
  } else if (choice.type === 'stat') {
    switch (choice.stat) {
      case 'maxHp': stats.maxHp += 20; stats.hp += 20; break;
      case 'speed': stats.speed += 15; break;
      case 'armor': stats.armor += 2; break;
      case 'magnet': stats.magnet += 30; break;
      case 'recovery': stats.recovery += 0.5; break;
    }
  }
  return changedWeapon;
}
