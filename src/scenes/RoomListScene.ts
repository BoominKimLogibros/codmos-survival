import type { Profile } from '../game/types';
import { udpClient } from '../network/UdpClient';
import type { RoomSummary, UdpBridgeEvent } from '../network/types';
import { getProfile } from '../services/profileService';
import { createUiButton, createUiPanel, createUiToast, UI_COLORS, uiTextStyle } from '../ui/theme';
import type { UiButton, UiToast } from '../ui/theme';

interface RoomListSceneData { profileId?: string }

export class RoomListScene extends Phaser.Scene {
  private profileId = '';
  private profile: Profile | null = null;
  private rooms: RoomSummary[] = [];
  private rows!: Phaser.GameObjects.Container;
  private statusText!: Phaser.GameObjects.Text;
  private toast!: UiToast;
  private unsubscribe?: () => void;
  private nameDialog: HTMLElement | null = null;
  private transitionBusy = false;

  constructor() { super('RoomListScene'); }

  init(data: RoomListSceneData): void {
    this.profileId = data.profileId ?? '';
    this.transitionBusy = false;
  }

  create(): void {
    const { width, height } = this.scale.gameSize;
    this.profile = getProfile(this.profileId);
    if (!this.profile || !udpClient.available) {
      this.scene.start('MenuScene');
      return;
    }
    this.add.rectangle(width / 2, height / 2, width, height, UI_COLORS.page);
    this.add.image(width / 2, height / 2, 'blueBg').setDisplaySize(width, height).setAlpha(0.12);
    this.add.text(width / 2, 44, 'LAN UDP 방 목록', uiTextStyle({
      fontSize: '30px', fontStyle: '800',
    })).setOrigin(0.5);
    this.add.text(width / 2, 78, `${this.profile.name} · Lv.${this.profile.state.stats.level}`, uiTextStyle({
      fontSize: '13px', color: '#a7acb7', fontStyle: '600',
    })).setOrigin(0.5);

    const panelWidth = Math.min(820, width - 32);
    createUiPanel(this, width / 2, height / 2 + 12, panelWidth, Math.min(470, height - 170), {
      fill: UI_COLORS.panel, border: UI_COLORS.border, radius: 18,
    });
    this.statusText = this.add.text(width / 2, 126, '같은 네트워크의 방을 찾는 중…', uiTextStyle({
      fontSize: '13px', color: '#a7acb7', fontStyle: '600',
    })).setOrigin(0.5);
    this.rows = this.add.container(0, 0);

    const footerWidth = Math.min(150, (width - 48) / 3);
    const footerGap = (width - 32 - footerWidth * 3) / 2;
    const footerStart = 16 + footerWidth / 2;
    const back = createUiButton(this, footerStart, height - 52, '메뉴로', {
      width: footerWidth, fill: UI_COLORS.surfaceRaised, border: UI_COLORS.border,
    });
    const refresh = createUiButton(this, footerStart + footerWidth + footerGap, height - 52, '새로고침', {
      width: footerWidth, fill: UI_COLORS.surfaceRaised, border: UI_COLORS.border,
    });
    const create = createUiButton(this, footerStart + (footerWidth + footerGap) * 2, height - 52, '방 만들기', {
      width: footerWidth, fill: UI_COLORS.primary, border: UI_COLORS.primary,
    });
    back.on('pointerdown', () => { void this._back(); });
    refresh.on('pointerdown', () => { void this._refresh(); });
    create.on('pointerdown', () => this._openCreateDialog());

    this.toast = createUiToast(this, width / 2, height - 106, { width: Math.min(440, width - 40) })
      .setDepth(2000);
    this.unsubscribe = udpClient.subscribe((event) => this._onUdpEvent(event));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      this._closeCreateDialog();
    });
    void this._refresh();
  }

  private _onUdpEvent(event: UdpBridgeEvent): void {
    if (event.type === 'rooms') {
      this.rooms = event.rooms;
      this._renderRooms();
    } else if (event.type === 'error') this._showToast(event.message, true);
  }

  private async _refresh(): Promise<void> {
    try {
      this.rooms = await udpClient.startDiscovery();
      this._renderRooms();
    } catch (error) {
      this._showToast(error instanceof Error ? error.message : '방을 검색하지 못했습니다.', true);
    }
  }

  private _renderRooms(): void {
    this.rows.removeAll(true);
    const { width, height } = this.scale.gameSize;
    const visible = this.rooms.slice(0, Math.max(1, Math.floor((height - 220) / 68)));
    this.statusText.setText(this.rooms.length ? `${this.rooms.length}개의 방을 찾았습니다.` : '참여 가능한 방이 없습니다.');
    visible.forEach((room, index) => {
      const y = 164 + index * 68;
      const rowWidth = Math.min(770, width - 70);
      const panel = createUiPanel(this, width / 2, y, rowWidth, 56, {
        fill: UI_COLORS.panelDark, border: UI_COLORS.border, radius: 12,
      });
      const title = this.add.text(width / 2 - rowWidth / 2 + 18, y - 10, room.name, uiTextStyle({
        fontSize: '16px', fontStyle: '800',
      })).setOrigin(0, 0.5);
      const detail = this.add.text(
        width / 2 - rowWidth / 2 + 18,
        y + 12,
        `${room.hostName} · 기준 Lv.${room.hostLevel} · ${room.playerCount}/${room.maxPlayers}명 · ${room.ping}ms`,
        uiTextStyle({ fontSize: '11px', color: '#a7acb7', fontStyle: '600' }),
      ).setOrigin(0, 0.5);
      const canJoin = room.status === 'waiting' && room.playerCount < room.maxPlayers;
      const join = createUiButton(this, width / 2 + rowWidth / 2 - 62, y, canJoin ? '참여' : '진행 중', {
        width: 94, height: 36,
        fill: UI_COLORS.surfaceRaised, border: UI_COLORS.border, fontSize: '13px',
      }).setEnabled(canJoin);
      join.on('pointerdown', () => { void this._join(room, join); });
      this.rows.add([panel, title, detail, join]);
    });
  }

  private async _join(room: RoomSummary, button: UiButton): Promise<void> {
    if (!this.profile || this.transitionBusy) return;
    this.transitionBusy = true;
    button.setEnabled(false).setLabel('연결 중…');
    try {
      await udpClient.joinRoom(room, this.profile);
      this.scene.start('RoomLobbyScene', { profileId: this.profileId });
    } catch (error) {
      this.transitionBusy = false;
      button.setEnabled(true).setLabel('참여');
      this._showToast(error instanceof Error ? error.message : '방에 참여하지 못했습니다.', true);
    }
  }

  private _openCreateDialog(): void {
    if (!this.profile) return;
    this._closeCreateDialog();
    const root = document.createElement('div');
    root.className = 'profile-name-dialog';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    const form = document.createElement('form');
    form.className = 'profile-name-dialog__panel';
    const title = document.createElement('h2');
    title.textContent = 'UDP 방 만들기';
    const description = document.createElement('p');
    description.textContent = '같은 네트워크의 플레이어에게 표시할 방 이름입니다.';
    const input = document.createElement('input');
    input.className = 'profile-name-dialog__input';
    input.maxLength = 30;
    input.value = `${this.profile.name}의 방`;
    const actions = document.createElement('div');
    actions.className = 'profile-name-dialog__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'profile-name-dialog__button profile-name-dialog__button--secondary';
    cancel.textContent = '취소';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'profile-name-dialog__button profile-name-dialog__button--primary';
    submit.textContent = '만들기';
    actions.append(cancel, submit);
    form.append(title, description, input, actions);
    root.append(form);
    document.body.append(root);
    this.nameDialog = root;
    cancel.addEventListener('click', () => this._closeCreateDialog());
    root.addEventListener('pointerdown', (event) => { if (event.target === root) this._closeCreateDialog(); });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this._createRoom(input.value.trim() || `${this.profile!.name}의 방`);
    });
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  private async _createRoom(name: string): Promise<void> {
    if (!this.profile || this.transitionBusy) return;
    this.transitionBusy = true;
    this._closeCreateDialog();
    try {
      await udpClient.createRoom(name, this.profile);
      this.scene.start('RoomLobbyScene', { profileId: this.profileId });
    } catch (error) {
      this.transitionBusy = false;
      this._showToast(error instanceof Error ? error.message : '방을 만들지 못했습니다.', true);
    }
  }

  private _closeCreateDialog(): void {
    this.nameDialog?.remove();
    this.nameDialog = null;
  }

  private async _back(): Promise<void> {
    if (this.transitionBusy) return;
    this.transitionBusy = true;
    try {
      await udpClient.stopDiscovery();
      this.scene.start('MenuScene');
    } catch (error) {
      this.transitionBusy = false;
      this._showToast(error instanceof Error ? error.message : '메뉴로 이동하지 못했습니다.', true);
    }
  }

  private _showToast(message: string, isError = false): void {
    this.toast.showMessage(message, isError);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 2200, duration: 250 });
  }
}
