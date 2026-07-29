import { getSkinOption } from '../config/skins';
import type { NetPlayerState } from '../network/gameProtocol';
import { createUiPanel, UI_COLORS, uiTextStyle } from './theme';

export class PartyHud {
  private readonly root: Phaser.GameObjects.Container;
  private readonly worldText: Phaser.GameObjects.Text;
  private playerRows: Phaser.GameObjects.GameObject[] = [];
  private lastSignature = '';

  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container(12, 12).setScrollFactor(0).setDepth(1000);
    const header = createUiPanel(scene, 129, 21, 258, 42, {
      fill: UI_COLORS.panelDark, border: UI_COLORS.border, radius: 12, shadow: true,
    });
    this.worldText = scene.add.text(12, 11, '00:00 · 처치 0', uiTextStyle({
      fontSize: '13px', fontStyle: '800',
    })).setOrigin(0, 0);
    this.root.add([header, this.worldText]);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  update(players: NetPlayerState[], gameTime: number, kills: number): void {
    const minutes = String(Math.floor(gameTime / 60)).padStart(2, '0');
    const seconds = String(gameTime % 60).padStart(2, '0');
    this.worldText.setText(`${minutes}:${seconds} · 처치 ${kills}`);
    const signature = players.map((player) => [
      player.id, player.hp, player.maxHp, player.level, player.alive, player.connected, player.shield,
    ].join(':')).join('|');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.playerRows.forEach((object) => object.destroy());
    this.playerRows = [];
    players.slice(0, 4).forEach((player, index) => {
      const y = 51 + index * 53;
      const panel = createUiPanel(this.scene, 129, y + 24, 258, 48, {
        fill: UI_COLORS.panelDark, border: UI_COLORS.border, radius: 10,
        alpha: player.connected ? 0.96 : 0.62,
      });
      const avatar = this.scene.add.image(26, y + 24, getSkinOption(player.skin).thumbnailKey)
        .setDisplaySize(38, 38).setAlpha(player.alive ? 1 : 0.38);
      const state = !player.connected ? '재연결' : !player.alive ? '사망' : `Lv.${player.level}`;
      const name = this.scene.add.text(51, y + 8, `${player.name} · ${state}`, uiTextStyle({
        fontSize: '11px', fontStyle: '800', color: player.alive ? '#ffffff' : '#a7acb7',
      })).setOrigin(0, 0);
      const barBg = this.scene.add.rectangle(51, y + 33, 178, 8, UI_COLORS.panelDeep).setOrigin(0, 0.5);
      const ratio = Math.max(0, player.hp / Math.max(1, player.maxHp));
      const bar = this.scene.add.rectangle(51, y + 33, Math.max(1, 178 * ratio), 6, UI_COLORS.health)
        .setOrigin(0, 0.5);
      const hp = this.scene.add.text(229, y + 31, `${Math.ceil(player.hp)}/${player.maxHp}`, uiTextStyle({
        fontSize: '8px', color: '#d4d7de', fontStyle: '800',
      })).setOrigin(1, 0.5);
      const shield = player.shield > 0
        ? this.scene.add.text(238, y + 8, `방어 ${player.shield}`, uiTextStyle({
          fontSize: '9px', color: '#d4d7de', fontStyle: '800',
        })).setOrigin(1, 0)
        : null;
      const objects = [panel, avatar, name, barBg, bar, hp, ...(shield ? [shield] : [])];
      this.root.add(objects);
      this.playerRows.push(...objects);
    });
  }

  destroy(): void {
    this.root.destroy(true);
  }
}
