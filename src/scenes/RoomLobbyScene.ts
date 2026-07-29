import { getSkinOption } from '../config/skins';
import { udpClient } from '../network/UdpClient';
import {
  isRoomMemberReady,
  UDP_MIN_PLAYERS,
  type GameStartPayload,
  type RoomMember,
  type RoomState,
  type UdpBridgeEvent,
} from '../network/types';
import { createUiButton, createUiPanel, createUiToast, UI_COLORS, uiTextStyle } from '../ui/theme';
import type { UiButton, UiToast } from '../ui/theme';

interface LobbyData { profileId?: string }

export class RoomLobbyScene extends Phaser.Scene {
  private profileId = '';
  private room: RoomState | null = null;
  private memberLayer!: Phaser.GameObjects.Container;
  private title!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private startButton!: UiButton;
  private toast!: UiToast;
  private unsubscribe?: () => void;
  private started = false;
  private leaving = false;

  constructor() { super('RoomLobbyScene'); }

  init(data: LobbyData): void {
    this.profileId = data.profileId ?? '';
    this.started = false;
    this.leaving = false;
  }

  create(): void {
    const { width, height } = this.scale.gameSize;
    this.room = udpClient.currentRoom;
    if (!this.room) { this.scene.start('RoomListScene', { profileId: this.profileId }); return; }
    this.add.rectangle(width / 2, height / 2, width, height, UI_COLORS.page);
    this.add.image(width / 2, height / 2, 'blueBg').setDisplaySize(width, height).setAlpha(0.12);
    this.title = this.add.text(width / 2, 48, this.room.name, uiTextStyle({
      fontSize: '30px', fontStyle: '800',
    })).setOrigin(0.5);
    this.hint = this.add.text(width / 2, 82, '', uiTextStyle({
      fontSize: '13px', color: '#a7acb7', fontStyle: '600',
    })).setOrigin(0.5);
    createUiPanel(this, width / 2, height / 2 + 5, Math.min(720, width - 32), Math.min(430, height - 180), {
      fill: UI_COLORS.panel, border: UI_COLORS.border, radius: 18,
    });
    this.memberLayer = this.add.container(0, 0);
    const footerWidth = Math.min(190, (width - 52) / 2);
    const footerOffset = footerWidth / 2 + 8;
    const leave = createUiButton(this, width / 2 - footerOffset, height - 52, '나가기', {
      width: footerWidth, fill: UI_COLORS.surfaceRaised, border: UI_COLORS.border,
    });
    this.startButton = createUiButton(this, width / 2 + footerOffset, height - 52, '게임 시작', {
      width: footerWidth, fill: UI_COLORS.primary, border: UI_COLORS.primary,
    });
    leave.on('pointerdown', () => { void this._leave(); });
    this.startButton.on('pointerdown', () => { void this._start(); });
    this.toast = createUiToast(this, width / 2, height - 108, { width: Math.min(430, width - 40) }).setDepth(2000);
    this.unsubscribe = udpClient.subscribe((event) => this._onUdpEvent(event));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubscribe?.());
    this._render();
    const pendingStart = udpClient.consumePendingGameStart();
    if (pendingStart) {
      this._enterGame(pendingStart);
      return;
    }
    if (this.room.status === 'playing' && this.room.activeGame) {
      this._enterGame({ room: this.room, ...this.room.activeGame });
      return;
    }
    if (this.room.status === 'waiting') void this._markLobbyReady();
  }

  private _onUdpEvent(event: UdpBridgeEvent): void {
    if (event.type === 'room-state') {
      this.room = event.room;
      this._render();
    } else if (event.type === 'game-start') {
      udpClient.consumePendingGameStart();
      this._enterGame(event.data);
    }
    else if (event.type === 'host-disconnected') {
      this._showToast('방장 연결이 종료되어 방 목록으로 이동합니다.', true);
      this.time.delayedCall(700, () => {
        void udpClient.leaveRoom('host-disconnected').finally(() => {
          this.scene.start('RoomListScene', { profileId: this.profileId });
        });
      });
    } else if (event.type === 'error') this._showToast(event.message, true);
  }

  private _render(): void {
    const room = this.room;
    if (!room) return;
    const { width } = this.scale.gameSize;
    const readyCount = room.members.filter(isRoomMemberReady).length;
    const allReady = room.members.length >= UDP_MIN_PLAYERS && readyCount === room.members.length;
    const waitingNames = room.members
      .filter((member) => !isRoomMemberReady(member))
      .map((member) => member.name)
      .join(', ');
    this.title.setText(room.name);
    this.hint.setText(room.status === 'playing'
      ? '이전 게임을 정리하고 있습니다. 잠시만 기다려 주세요.'
      : room.members.length < UDP_MIN_PLAYERS
        ? `${UDP_MIN_PLAYERS}명 이상 필요 · 현재 ${room.members.length}명`
        : !allReady
          ? `준비 ${readyCount}/${room.members.length} · ${waitingNames} 로비 복귀 대기`
          : room.isHost
            ? '게임을 시작할 수 있습니다. 시작 후에도 다른 플레이어가 참여할 수 있습니다.'
            : '모든 참가자 준비 완료 · 방장이 시작할 때까지 기다려 주세요.');
    this.memberLayer.removeAll(true);
    const compact = room.members.length > 4;
    const columns = compact ? 2 : 1;
    const contentWidth = Math.min(680, width - 52);
    const columnGap = compact ? 8 : 0;
    const compactRowWidth = (contentWidth - columnGap) / 2;
    room.members.forEach((member, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const rowWidth = compact ? compactRowWidth : Math.min(660, width - 72);
      const centerX = compact
        ? width / 2 - contentWidth / 2 + rowWidth / 2 + column * (rowWidth + columnGap)
        : width / 2;
      const y = compact ? 130 + row * 37 : 138 + row * 78;
      const rowHeight = compact ? 32 : 64;
      const panel = createUiPanel(this, centerX, y, rowWidth, rowHeight, {
        fill: UI_COLORS.panelDark,
        border: member.playerId === room.localPlayerId ? UI_COLORS.primary : UI_COLORS.border,
        borderWidth: member.playerId === room.localPlayerId ? 2 : 1,
        radius: compact ? 9 : 13,
      });
      const skin = getSkinOption(member.skin);
      const left = centerX - rowWidth / 2;
      const avatar = this.add.image(left + (compact ? 20 : 42), y, skin.thumbnailKey)
        .setDisplaySize(compact ? 26 : 50, compact ? 26 : 50);
      const name = this.add.text(left + (compact ? 39 : 82), y - (compact ? 8 : 11),
        `${member.name}${member.isHost ? ' · 방장' : ''}`, uiTextStyle({
          fontSize: compact ? '11px' : '16px', fontStyle: '800',
        }))
        .setOrigin(0, 0.5);
      const detail = this.add.text(left + (compact ? 39 : 82), y + (compact ? 8 : 13),
        `Lv.${member.level} · ${skin.name}`, uiTextStyle({
          fontSize: compact ? '8px' : '11px', color: '#a7acb7', fontStyle: '600',
        }))
        .setOrigin(0, 0.5);
      const stateLabel = this._memberStateLabel(member);
      const state = this.add.text(centerX + rowWidth / 2 - (compact ? 10 : 20), y, stateLabel, uiTextStyle({
        fontSize: compact ? '8px' : '12px',
        color: isRoomMemberReady(member) ? '#ffffff' : '#a7acb7',
        fontStyle: '800',
      })).setOrigin(1, 0.5);
      this.memberLayer.add([panel, avatar, name, detail, state]);
    });
    this.startButton
      .setVisible(room.isHost)
      .setLabel(allReady ? '게임 시작' : `준비 ${readyCount}/${room.members.length}`)
      .setEnabled(room.isHost && room.status === 'waiting' && allReady);
  }

  private async _start(): Promise<void> {
    if (
      !this.room?.isHost ||
      this.room.status !== 'waiting' ||
      !this.room.members.every(isRoomMemberReady) ||
      this.room.members.length < UDP_MIN_PLAYERS ||
      this.started
    ) return;
    try {
      this.startButton.setEnabled(false).setLabel('시작 중…');
      const start = await udpClient.startGame();
      this._enterGame(start);
    } catch (error) {
      this.startButton.setLabel('게임 시작');
      this._render();
      this._showToast(error instanceof Error ? error.message : '게임을 시작하지 못했습니다.', true);
    }
  }

  private _enterGame(data: GameStartPayload): void {
    udpClient.consumePendingGameStart();
    if (this.started) return;
    this.started = true;
    const remaining = data.startedAt - Date.now();
    // Host and guest clocks are not guaranteed to be synchronized. Only use
    // the host timestamp when it is a plausible short countdown.
    const delay = remaining >= 0 && remaining <= 1_000 ? remaining : 0;
    this.time.delayedCall(delay, () => {
      this.scene.start('MultiplayerGameScene', { profileId: this.profileId, start: data });
    });
  }

  private async _leave(): Promise<void> {
    if (this.leaving || this.started) return;
    this.leaving = true;
    try {
      await udpClient.leaveRoom('lobby-left');
      this.scene.start('RoomListScene', { profileId: this.profileId });
    } catch (error) {
      this.leaving = false;
      this._showToast(error instanceof Error ? error.message : '방에서 나가지 못했습니다.', true);
    }
  }

  private async _markLobbyReady(): Promise<void> {
    try {
      const room = await udpClient.setMemberPresence('lobby');
      if (!this.scene.isActive('RoomLobbyScene')) return;
      this.room = room;
      this._render();
    } catch (error) {
      if (!this.scene.isActive('RoomLobbyScene')) return;
      this._showToast(error instanceof Error ? error.message : '로비 준비 상태를 알리지 못했습니다.', true);
    }
  }

  private _memberStateLabel(member: RoomMember): string {
    if (member.connection === 'reconnecting') return '재연결 중';
    if (member.connection === 'left') return '나감';
    switch (member.presence) {
      case 'lobby': return '로비 · 준비 완료';
      case 'playing': return '게임 플레이 중';
      case 'results': return '결과 화면 · 복귀 대기';
    }
  }

  private _showToast(message: string, isError = false): void {
    this.toast.showMessage(message, isError);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 2200, duration: 250 });
  }
}
