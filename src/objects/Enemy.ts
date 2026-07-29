import type { EnemySprite, EnemyType, MonsterFrames } from '../game/types';

interface CreateEnemyOptions {
  x: number;
  y: number;
  frames: MonsterFrames;
  scale: number;
  enemyType: EnemyType;
  bodyRadius?: number;
  collideWorldBounds?: boolean;
}

export function createEnemySprite(
  scene: Phaser.Scene,
  enemies: Phaser.Physics.Arcade.Group,
  {
    x,
    y,
    frames,
    scale,
    enemyType,
    bodyRadius = 45,
    collideWorldBounds = true,
  }: CreateEnemyOptions,
): EnemySprite {
  const enemy = enemies.create(x, y, 'monsterSheet', frames.idle).setDepth(3) as EnemySprite;
  enemy.setScale(scale);
  enemy.setCollideWorldBounds(collideWorldBounds);
  const bodyOffset = (121 - bodyRadius * 2) / 2;
  (enemy.body as Phaser.Physics.Arcade.Body).setCircle(bodyRadius, bodyOffset, bodyOffset);
  enemy.enemyType = enemyType;
  enemy.monsterFrames = frames;
  return enemy;
}
