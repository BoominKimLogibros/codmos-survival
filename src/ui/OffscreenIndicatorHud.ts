import { createUiPanel, UI_COLORS, uiTextStyle } from './theme';
import type { UiPanel } from './theme';

export interface OffscreenIndicatorTarget {
  id: string;
  kind: 'player' | 'boss';
  label: string;
  /** Name used when multiple player indicators are merged. */
  groupLabel?: string;
  x: number;
  y: number;
  active: boolean;
}

export interface OffscreenProjection {
  x: number;
  y: number;
  angle: number;
}

interface IndicatorView {
  root: Phaser.GameObjects.Container;
  arrow: Phaser.GameObjects.Triangle;
  panel: UiPanel;
  label: Phaser.GameObjects.Text;
}

export interface ProjectedOffscreenIndicator {
  target: OffscreenIndicatorTarget;
  projection: OffscreenProjection;
}

interface IndexedProjectedIndicator extends ProjectedOffscreenIndicator {
  order: number;
}

type IndicatorSide = 'left' | 'right' | 'top' | 'bottom';

interface WorldViewRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Projects an off-camera world point onto a safe inset of the screen edge. */
export function projectOffscreenTarget(
  targetX: number,
  targetY: number,
  worldView: WorldViewRect,
  screenWidth: number,
  screenHeight: number,
  marginX = 60,
  marginY = 42,
): OffscreenProjection | null {
  if (
    targetX >= worldView.left && targetX <= worldView.right &&
    targetY >= worldView.top && targetY <= worldView.bottom
  ) return null;

  const centerX = (worldView.left + worldView.right) / 2;
  const centerY = (worldView.top + worldView.bottom) / 2;
  const dx = targetX - centerX;
  const dy = targetY - centerY;
  const halfWorldWidth = Math.max(1, (worldView.right - worldView.left) / 2);
  const halfWorldHeight = Math.max(1, (worldView.bottom - worldView.top) / 2);
  const normalizedX = dx / halfWorldWidth;
  const normalizedY = dy / halfWorldHeight;
  const edgeScale = 1 / Math.max(0.0001, Math.abs(normalizedX), Math.abs(normalizedY));
  const halfScreenWidth = Math.max(1, screenWidth / 2 - marginX);
  const halfScreenHeight = Math.max(1, screenHeight / 2 - marginY);

  return {
    x: screenWidth / 2 + normalizedX * edgeScale * halfScreenWidth,
    y: screenHeight / 2 + normalizedY * edgeScale * halfScreenHeight,
    angle: Math.atan2(dy, dx),
  };
}

/** Keeps the requested compact naming rule independent from render objects. */
export function formatOffscreenPlayerGroup(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]}, ${labels[1]}`;
  return `${labels[0]} 외 ${labels.length - 1}명`;
}

function indicatorSide(projection: OffscreenProjection): IndicatorSide {
  const directionX = Math.cos(projection.angle);
  const directionY = Math.sin(projection.angle);
  if (Math.abs(directionX) >= Math.abs(directionY)) return directionX >= 0 ? 'right' : 'left';
  return directionY >= 0 ? 'bottom' : 'top';
}

function estimatedPanelWidth(label: string, screenWidth: number): number {
  let textWidth = 0;
  for (const character of Array.from(label)) {
    textWidth += /^[\x00-\x7f]$/.test(character) ? 5.8 : 10;
  }
  return Math.min(Math.max(80, textWidth + 26), Math.max(80, screenWidth - 24));
}

/**
 * Merges player markers whose panels would overlap on the same screen edge.
 * Boss markers intentionally remain independent from player groups.
 */
export function groupOffscreenIndicators(
  entries: ProjectedOffscreenIndicator[],
  screenWidth: number,
): ProjectedOffscreenIndicator[] {
  const indexed: IndexedProjectedIndicator[] = entries.map((entry, order) => ({ ...entry, order }));
  const output: IndexedProjectedIndicator[] = indexed
    .filter(({ target }) => target.kind !== 'player');
  const playersBySide = new Map<IndicatorSide, IndexedProjectedIndicator[]>();

  for (const entry of indexed) {
    if (entry.target.kind !== 'player') continue;
    const side = indicatorSide(entry.projection);
    const sideEntries = playersBySide.get(side) ?? [];
    sideEntries.push(entry);
    playersBySide.set(side, sideEntries);
  }

  for (const [side, sideEntries] of playersBySide) {
    const usesHorizontalAxis = side === 'top' || side === 'bottom';
    const tangent = (entry: IndexedProjectedIndicator): number => (
      usesHorizontalAxis ? entry.projection.x : entry.projection.y
    );
    const halfExtent = (entry: IndexedProjectedIndicator): number => (
      usesHorizontalAxis
        ? estimatedPanelWidth(entry.target.label, screenWidth) / 2
        : 14
    );
    const sorted = [...sideEntries].sort((a, b) => tangent(a) - tangent(b));
    let cluster: IndexedProjectedIndicator[] = [];
    let clusterEnd = Number.NEGATIVE_INFINITY;

    const flush = (): void => {
      if (cluster.length === 0) return;
      const orderedMembers = [...cluster].sort((a, b) => a.order - b.order);
      const first = orderedMembers[0];
      const labels = orderedMembers.map(({ target }) => target.groupLabel ?? target.label);
      const count = cluster.length;
      const averageX = cluster.reduce((sum, entry) => sum + entry.projection.x, 0) / count;
      const averageY = cluster.reduce((sum, entry) => sum + entry.projection.y, 0) / count;
      const averageDirectionX = cluster.reduce((sum, entry) => sum + Math.cos(entry.projection.angle), 0);
      const averageDirectionY = cluster.reduce((sum, entry) => sum + Math.sin(entry.projection.angle), 0);
      output.push({
        order: first.order,
        target: count === 1 ? first.target : {
          ...first.target,
          // Reuse the representative player's view so merge/split transitions
          // do not create and destroy a graphics container every frame.
          id: first.target.id,
          label: formatOffscreenPlayerGroup(labels),
        },
        projection: count === 1 ? first.projection : {
          x: averageX,
          y: averageY,
          angle: Math.atan2(averageDirectionY, averageDirectionX),
        },
      });
      cluster = [];
      clusterEnd = Number.NEGATIVE_INFINITY;
    };

    for (const entry of sorted) {
      const entryStart = tangent(entry) - halfExtent(entry);
      if (cluster.length > 0 && entryStart > clusterEnd + 6) flush();
      cluster.push(entry);
      clusterEnd = Math.max(clusterEnd, tangent(entry) + halfExtent(entry));
    }
    flush();
  }

  return output.sort((a, b) => a.order - b.order).map(({ target, projection }) => ({
    target,
    projection,
  }));
}

/** Screen-fixed direction markers for remote party members and active bosses. */
export class OffscreenIndicatorHud {
  private readonly views = new Map<string, IndicatorView>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  update(targets: OffscreenIndicatorTarget[]): void {
    const camera = this.scene.cameras.main;
    const { width, height } = this.scene.scale.gameSize;
    const worldView = {
      left: camera.worldView.x,
      right: camera.worldView.right,
      top: camera.worldView.y,
      bottom: camera.worldView.bottom,
    };
    const projected = targets.flatMap((target): ProjectedOffscreenIndicator[] => {
      const projection = target.active && Number.isFinite(target.x) && Number.isFinite(target.y)
        ? projectOffscreenTarget(target.x, target.y, worldView, width, height)
        : null;
      return projection ? [{ target, projection }] : [];
    });
    const indicators = groupOffscreenIndicators(projected, width);
    const currentIds = new Set(indicators.map(({ target }) => target.id));

    indicators.forEach(({ target, projection }) => {
      const view = this.ensureView(target);
      const directionX = Math.cos(projection.angle);
      const directionY = Math.sin(projection.angle);
      const horizontal = Math.abs(directionX) >= Math.abs(directionY);
      const panelWidth = target.kind === 'boss'
        ? 76
        : estimatedPanelWidth(target.label, width);
      view.panel.resizeUiPanel(panelWidth, 24);
      const inwardDistance = horizontal ? panelWidth / 2 + 8 : 31;
      view.root.setPosition(projection.x, projection.y).setVisible(true);
      view.arrow.setRotation(projection.angle + Math.PI / 2);
      view.panel.setPosition(-directionX * inwardDistance, -directionY * inwardDistance);
      view.label
        .setPosition(-directionX * inwardDistance, -directionY * inwardDistance - 1)
        .setText(target.label);
    });

    for (const [id, view] of this.views) {
      if (currentIds.has(id)) continue;
      view.root.destroy(true);
      this.views.delete(id);
    }
  }

  destroy(): void {
    this.views.forEach((view) => view.root.destroy(true));
    this.views.clear();
  }

  private ensureView(target: OffscreenIndicatorTarget): IndicatorView {
    const existing = this.views.get(target.id);
    if (existing) return existing;
    const color = target.kind === 'boss' ? UI_COLORS.white : UI_COLORS.primary;
    const root = this.scene.add.container(0, 0)
      .setScrollFactor(0)
      .setDepth(3600)
      .setVisible(false);
    const panel = createUiPanel(this.scene, 0, 0, target.kind === 'boss' ? 76 : 108, 24, {
      fill: UI_COLORS.panelDark,
      border: color,
      borderWidth: 1,
      radius: 10,
      alpha: 0.94,
      shadow: true,
    });
    const label = this.scene.add.text(0, -1, target.label, uiTextStyle({
      fontSize: target.kind === 'boss' ? '11px' : '10px',
      fontStyle: '800',
      color: target.kind === 'boss' ? '#ffffff' : '#d4d7de',
    })).setOrigin(0.5);
    const arrow = this.scene.add.triangle(0, 0, 0, -9, 7, 6, -7, 6, color, 1)
      .setStrokeStyle(2, UI_COLORS.panelDeep, 0.9);
    root.add([panel, label, arrow]);
    const view = { root, arrow, panel, label };
    this.views.set(target.id, view);
    return view;
  }
}
