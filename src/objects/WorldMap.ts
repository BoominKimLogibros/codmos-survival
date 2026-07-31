import { ARENA_PLAYABLE_HALF_SIZE, WORLD_SIZE } from '../config/constants';

export class WorldMap {
  readonly playerSpawn = { x: 0, y: 0 };
  readonly waterLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  readonly environmentColliders: Phaser.Types.Physics.Arcade.ArcadeColliderType | null = null;
  readonly environmentObjects: Phaser.GameObjects.Image[] = [];
  readonly treeCount = 0;
  readonly background: Phaser.GameObjects.Image;

  constructor(private readonly scene: Phaser.Scene) {
    this.background = this.create();
  }

  private create(): Phaser.GameObjects.Image {
    const scene = this.scene;
    const halfWorld = WORLD_SIZE / 2;
    const playableSize = ARENA_PLAYABLE_HALF_SIZE * 2;
    scene.physics.world.setBounds(
      -ARENA_PLAYABLE_HALF_SIZE,
      -ARENA_PLAYABLE_HALF_SIZE,
      playableSize,
      playableSize,
    );
    scene.cameras.main.setBounds(-halfWorld, -halfWorld, WORLD_SIZE, WORLD_SIZE);

    return scene.add.image(0, 0, 'fortressArena')
      .setDisplaySize(WORLD_SIZE, WORLD_SIZE)
      .setDepth(-20)
      .setName('fortress-arena-background');
  }
}
