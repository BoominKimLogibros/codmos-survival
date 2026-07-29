import type { NetPlayerState } from '../network/gameProtocol';
import { createUiPanel, UI_COLORS, uiTextStyle } from './theme';
import type { UiPanel } from './theme';

export class PartyHud {
  private readonly root: Phaser.GameObjects.Container;
  private readonly panel: UiPanel;
  private readonly worldText: Phaser.GameObjects.Text;
  private readonly connectionText: Phaser.GameObjects.Text;
  private lastSignature = '';

  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container(12, 12).setScrollFactor(0).setDepth(1000);
    this.panel = createUiPanel(scene, 170, 28, 340, 56, {
      fill: UI_COLORS.panelDark, border: UI_COLORS.border, radius: 12, shadow: true,
    });
    this.worldText = scene.add.text(10, 7, '00:00 · 처치 0', uiTextStyle({
      fontSize: '12px', fontStyle: '800',
    })).setOrigin(0, 0);
    this.connectionText = scene.add.text(10, 28, '접속 0명', uiTextStyle({
      fontSize: '9px', fontStyle: '700', color: '#d4d7de',
      lineSpacing: 2,
    })).setOrigin(0, 0);
    this.root.add([this.panel, this.worldText, this.connectionText]);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  update(players: NetPlayerState[], gameTime: number, kills: number): void {
    const minutes = String(Math.floor(gameTime / 60)).padStart(2, '0');
    const seconds = String(gameTime % 60).padStart(2, '0');
    this.worldText.setText(`${minutes}:${seconds} · 처치 ${kills}`);
    const signature = `${this.scene.scale.gameSize.width}|${players.map((player) => [
      player.id, player.name, player.alive, player.connected,
    ].join(':')).join('|')}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    const connectedCount = players.filter((player) => player.connected).length;
    const names = players.slice(0, 20).map((player) => {
      if (!player.connected) return `${player.name}(재연결)`;
      if (!player.alive) return `${player.name}(사망)`;
      return player.name;
    });
    const connectionLabel = players.length > 0
      ? `접속 ${connectedCount}/${players.length} · ${names.join(', ')}`
      : '접속 0명';
    const width = Math.min(360, Math.max(220, this.scene.scale.gameSize.width - 24));
    this.connectionText.setWordWrapWidth(width - 20).setText(connectionLabel);
    const height = Math.max(54, 37 + this.connectionText.height + 9);
    this.panel.setPosition(width / 2, height / 2).resizeUiPanel(width, height);
  }

  destroy(): void {
    this.root.destroy(true);
  }
}
