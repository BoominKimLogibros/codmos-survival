import {
  GROUND_TILE_FRAMES,
  TILE_SIZE,
  TREE_TILE_FRAMES,
  WORLD_SIZE,
  WORLD_TILES,
} from '../config/constants';

export class WorldMap {
  readonly playerSpawn = { x: 0, y: 0 };
  readonly waterLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  readonly environmentColliders: Phaser.Types.Physics.Arcade.ArcadeColliderType | null = null;
  readonly environmentObjects: Phaser.GameObjects.Image[];
  readonly treeCount: number;
  readonly tilemap: Phaser.Tilemaps.Tilemap;
  readonly groundLayer: ReturnType<Phaser.Tilemaps.Tilemap['createLayer']>;

  constructor(private readonly scene: Phaser.Scene) {
    const result = this.create();
    this.treeCount = result.treeCount;
    this.environmentObjects = result.environmentObjects;
    this.tilemap = result.tilemap;
    this.groundLayer = result.groundLayer;
  }

  private create() {
    const scene = this.scene;
    const halfWorld = WORLD_SIZE / 2;
    scene.physics.world.setBounds(-halfWorld, -halfWorld, WORLD_SIZE, WORLD_SIZE);
    scene.cameras.main.setBounds(-halfWorld, -halfWorld, WORLD_SIZE, WORLD_SIZE);

    const groundData = Array.from({ length: WORLD_TILES }, (_, row) => (
      Array.from({ length: WORLD_TILES }, (_, column) => (
        GROUND_TILE_FRAMES[(row + column) % GROUND_TILE_FRAMES.length]
      ))
    ));
    const tilemap = scene.make.tilemap({
      data: groundData,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const tileset = tilemap.addTilesetImage(
      'survivalTileset', 'survivalTileset', TILE_SIZE, TILE_SIZE, 0, 0, 0,
    );
    if (!tileset) throw new Error('Local tileset could not be attached to the ground tilemap');
    const groundLayer = tilemap.createLayer(0, tileset, -halfWorld, -halfWorld);
    if (groundLayer) groundLayer.setDepth(-20);

    const treeCandidates = [];
    for (let row = 0; row < WORLD_TILES; row++) {
      for (let column = 0; column < WORLD_TILES; column++) {
        const x = -halfWorld + column * TILE_SIZE + TILE_SIZE / 2;
        const y = -halfWorld + row * TILE_SIZE + TILE_SIZE / 2;
        if (Math.abs(x) < TILE_SIZE * 2 && Math.abs(y) < TILE_SIZE * 2) continue;
        treeCandidates.push({ x, y });
      }
    }
    const treeCount = Math.max(1, Math.round((WORLD_TILES * WORLD_TILES) / 100));
    // Keep LAN peers on the same visual map without synchronizing decorative trees.
    // The deterministic score still produces a sparse, irregular 1% distribution.
    const scoredTrees = treeCandidates.map(({ x, y }, index) => ({
      x,
      y,
      index,
      score: ((index + 17) * 2_654_435_761) >>> 0,
    })).sort((first, second) => first.score - second.score);
    const environmentObjects = scoredTrees.slice(0, treeCount).map(({ x, y, score }) => (
      scene.add.image(
        x + (score % 21) - 10,
        y + ((score >>> 8) % 21) - 10,
        'survivalTileset',
        TREE_TILE_FRAMES[(score >>> 16) % TREE_TILE_FRAMES.length],
      ).setDepth(-5).setName('tree')
    ));
    return { treeCount, environmentObjects, tilemap, groundLayer };
  }
}
