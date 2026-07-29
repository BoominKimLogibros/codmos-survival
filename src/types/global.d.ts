export {};

import type { CodmosUdpApi } from '../network/types';

declare global {
  interface SpineBone {
    a: number;
    b: number;
    worldX: number;
  }

  interface SpineSkeleton {
    bones: SpineBone[];
  }

  interface SpineGameObject extends Phaser.GameObjects.GameObject {
    skeleton: SpineSkeleton;
    _wantFlipX?: boolean;
    _currentAnim?: string;
    setScale(x: number, y?: number): SpineGameObject;
    setDepth(depth: number): SpineGameObject;
    setAlpha(alpha: number): SpineGameObject;
    setSkinByName(name: string): SpineGameObject;
    setSlotsToSetupPose(): SpineGameObject;
    setVisible(visible: boolean): SpineGameObject;
    setColor(color: number, slotName?: string): SpineGameObject;
    play(animation: string, loop: boolean): SpineGameObject;
    setPosition(x: number, y: number): SpineGameObject;
  }

  interface SpineSceneRenderer {
    drawSkeleton?: (
      skeleton: SpineSkeleton,
      premultipliedAlpha: boolean,
      slotRangeStart: number,
      slotRangeEnd: number,
    ) => void;
  }

  interface SpineScenePlugin {
    sceneRenderer?: SpineSceneRenderer;
  }

  interface Window {
    Phaser: typeof Phaser;
    SpinePlugin: unknown;
    game: Phaser.Game;
    codmosUdp?: CodmosUdpApi;
  }

  namespace Phaser {
    interface Scene {
      spine: SpineScenePlugin;
    }

    namespace GameObjects {
      interface GameObjectFactory {
        spine(
          x: number,
          y: number,
          key: string,
          animation: string,
          loop: boolean,
        ): SpineGameObject;
      }
    }

    namespace Loader {
      interface LoaderPlugin {
        spine(key: string, jsonUrl: string, atlasUrl: string, premultipliedAlpha?: boolean): void;
      }
    }
  }
}
