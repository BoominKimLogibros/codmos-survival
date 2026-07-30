import { getSkinOption, SKIN_OPTIONS } from '../config/skins';
import type { Profile, WeaponDefinition, WeaponKey, WeaponRuntimeStats } from '../game/types';
import {
  calculateWeaponRuntimeStats,
  createWeaponDefinitions,
} from '../game/WeaponSystem';
import {
  changeProfileSkin,
  downloadProfile,
  getProfile,
  getProfiles,
  getSelectedProfileId,
  importProfile,
  renameProfile,
  resetProfile,
  selectProfile,
} from '../services/profileService';
import {
  createUiButton,
  createUiPanel,
  createUiToast,
  UI_COLORS,
  uiTextStyle,
} from '../ui/theme';
import type { UiButton, UiToast } from '../ui/theme';
import { udpClient } from '../network/UdpClient';

interface ProfileGridLayout {
  columns: number;
  rows: number;
  perPage: number;
  cardWidth: number;
  cardHeight: number;
  columnGap: number;
  rowGap: number;
  top: number;
}

function seconds(milliseconds: number): string {
  return `${Number((milliseconds / 1000).toFixed(2))}초`;
}

function formatSkillStats(
  definition: WeaponDefinition,
  runtime: WeaponRuntimeStats,
): string {
  switch (definition.type) {
    case 'melee':
      return `피해 ${runtime.damage} · 주기 ${seconds(runtime.cooldownMs!)} · 범위 ${runtime.range}`;
    case 'projectile':
      return `피해 ${runtime.damage} · ${runtime.count}발 연사 · 연사 후 ${seconds(runtime.cooldownMs!)} 대기`;
    case 'aura':
      return `피해 ${runtime.damage} · 주기 ${seconds(runtime.cooldownMs!)} · 반경 ${runtime.radius}`;
    case 'explosion':
      return `피해 ${runtime.damage} · ${runtime.count}개 · 주기 ${seconds(runtime.cooldownMs!)} · 반경 ${runtime.radius}`;
    case 'orbit':
      return `피해 ${runtime.damage} · ${runtime.count}개 · 공전 반경 ${runtime.radius}`;
  }
}

export class MenuScene extends Phaser.Scene {
  private page = 0;
  private skinPage = 0;
  private profiles: Profile[] = [];
  private selectedProfileId: string | null = null;
  private menuBackground!: Phaser.GameObjects.Image;
  private menuShade!: Phaser.GameObjects.Rectangle;
  private decorations: Phaser.GameObjects.Image[] = [];
  private title!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private importButton!: UiButton;
  private profileCardsLayer!: Phaser.GameObjects.Container;
  private previousButton!: UiButton;
  private nextButton!: UiButton;
  private pageText!: Phaser.GameObjects.Text;
  private startButton!: UiButton;
  private udpButton!: UiButton;
  private udpHint!: Phaser.GameObjects.Text;
  private menuToast!: UiToast;
  private menuToastTween?: Phaser.Tweens.Tween;
  private saveFileInput!: HTMLInputElement;
  private onSaveFileChange!: (event: Event) => void;
  private renameDialog: HTMLElement | null = null;
  private skinModalProfileId: string | null = null;
  private skinModalRoot: Phaser.GameObjects.Container | null = null;
  private skinOptionsLayer: Phaser.GameObjects.Container | null = null;
  private resetModalRoot: Phaser.GameObjects.Container | null = null;
  private skillModalRoot: Phaser.GameObjects.Container | null = null;
  private readonly startFromKeyboard = (): void => this._startSelectedProfile();
  private readonly closeActiveModal = (): void => {
    if (this.renameDialog) this._closeRenameDialog();
    else if (this.resetModalRoot) this._closeResetModal();
    else if (this.skillModalRoot) this._closeSkillModal();
    else this._closeSkinModal();
  };

  constructor() {
    super('MenuScene');
  }

  create(): void {
    const { width, height } = this.scale.gameSize;
    this.page = 0;
    this.skinPage = 0;

    this.menuBackground = this.add.image(width / 2, height / 2, 'blueBg')
      .setDisplaySize(width, height).setAlpha(0.42);
    this.menuShade = this.add.rectangle(width / 2, height / 2, width, height, UI_COLORS.page, 0.86);

    const decorationKeys = ['goldCoin', 'silverCoin', 'star', 'lightning'];
    this.decorations = Array.from({ length: 12 }, () => {
      const image = this.add.image(
        Phaser.Math.Between(25, Math.max(26, width - 25)),
        Phaser.Math.Between(25, Math.max(26, height - 25)),
        Phaser.Utils.Array.GetRandom(decorationKeys),
      ).setAlpha(0.12).setScale(Phaser.Math.FloatBetween(0.18, 0.35));
      this.tweens.add({
        targets: image,
        y: image.y + Phaser.Math.Between(-18, 18),
        duration: Phaser.Math.Between(2200, 4200),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      return image;
    });

    this.title = this.add.text(width / 2, 36, 'CODMOS SURVIVORS', {
      ...uiTextStyle({ fontSize: '34px', fontStyle: '800' }),
      stroke: '#0b0d12', strokeThickness: 2,
    }).setOrigin(0.5);
    this.subtitle = this.add.text(width / 2, 72, '플레이할 프로필을 선택하세요', uiTextStyle({
      fontSize: '14px', color: '#a7acb7', fontStyle: '600',
    })).setOrigin(0.5);

    const compactHeader = width < 620;
    this.importButton = this._makeTextButton(
      compactHeader ? width / 2 : width - 100,
      compactHeader ? 108 : 38,
      '+ 프로필 불러오기',
      '#20242d',
      '14px',
    );
    this.importButton.on('pointerdown', () => this._openProfilePicker());

    this.profileCardsLayer = this.add.container(0, 0);
    this.previousButton = this._makeTextButton(width / 2 - 90, height - 91, '‹ 이전', '#20242d', '13px');
    this.nextButton = this._makeTextButton(width / 2 + 90, height - 91, '다음 ›', '#20242d', '13px');
    this.pageText = this.add.text(width / 2, height - 91, '1 / 1', uiTextStyle({
      fontSize: '12px', color: '#a7acb7', fontStyle: '600',
    })).setOrigin(0.5);
    this.previousButton.on('pointerdown', () => this._changePage(-1));
    this.nextButton.on('pointerdown', () => this._changePage(1));

    const soloOnly = !udpClient.available;
    const actionWidth = soloOnly
      ? Math.min(360, width - 48)
      : Math.min(250, (width - 48) / 2);
    const actionOffset = actionWidth / 2 + 7;
    this.startButton = createUiButton(this, soloOnly ? width / 2 : width / 2 - actionOffset, height - 42, '혼자하기', {
      width: actionWidth, height: 50, fill: UI_COLORS.primary, border: UI_COLORS.primary,
      color: '#ffffff', fontSize: width < 580 ? '15px' : '19px',
    });
    this.startButton.on('pointerdown', () => this._startSelectedProfile());
    this.udpButton = createUiButton(this, width / 2 + actionOffset, height - 42, '같이하기', {
      width: actionWidth, height: 50, fill: UI_COLORS.surfaceRaised, border: UI_COLORS.border,
      color: '#ffffff', fontSize: '16px',
    });
    this.udpButton.uiLabel.setPosition(0, -9);
    this.udpButton.on('pointerdown', () => this._startUdp());
    this.udpHint = this.add.text(0, 12,
      '(같은 네트워크 · 최대 20명)',
      uiTextStyle({ fontSize: '9px', color: '#a7acb7', fontStyle: '600' }),
    ).setOrigin(0.5);
    this.udpButton.add(this.udpHint);
    this.udpButton.setVisible(!soloOnly);

    this.menuToast = createUiToast(this, width / 2, height - 145, {
      width: Math.min(430, width - 32),
    }).setDepth(3000);

    const saveFileInputElement = document.getElementById('save-file-input');
    if (!(saveFileInputElement instanceof HTMLInputElement)) {
      throw new Error('Missing #save-file-input element');
    }
    this.saveFileInput = saveFileInputElement;
    this.onSaveFileChange = (event) => { void this._importProfileFile(event); };
    this.saveFileInput.addEventListener('change', this.onSaveFileChange);
    const saveFileInput = this.saveFileInput;
    const onSaveFileChange = this.onSaveFileChange;

    const keyboard = this.input.keyboard!;
    keyboard.on('keydown-ENTER', this.startFromKeyboard);
    keyboard.on('keydown-ESC', this.closeActiveModal);
    this.scale.on('resize', this._layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this._layout, this);
      keyboard.off('keydown-ENTER', this.startFromKeyboard);
      keyboard.off('keydown-ESC', this.closeActiveModal);
      saveFileInput.removeEventListener('change', onSaveFileChange);
      this._closeRenameDialog();
      this._closeResetModal();
      this._closeSkillModal();
    });

    this._refreshProfiles();
  }

  private _makeTextButton(
    x: number,
    y: number,
    label: string,
    backgroundColor: string | number,
    fontSize = '12px',
  ): UiButton {
    const px = Number.parseFloat(fontSize) || 12;
    const longestLine = String(label).split('\n').reduce((max, line) => Math.max(max, [...line].length), 0);
    const buttonWidth = Phaser.Math.Clamp(longestLine * px * 0.82 + 30, 66, 190);
    const buttonHeight = String(label).includes('\n') ? 52 : Phaser.Math.Clamp(px + 24, 34, 46);
    const fill = typeof backgroundColor === 'number'
      ? backgroundColor
      : Phaser.Display.Color.HexStringToColor(backgroundColor).color;
    return createUiButton(this, x, y, label, {
      width: buttonWidth,
      height: buttonHeight,
      fill,
      border: UI_COLORS.border,
      borderWidth: 2,
      fontSize,
    });
  }

  private _gridLayout(): ProfileGridLayout {
    const { width, height } = this.scale.gameSize;
    const compact = width < 760 || height < 570;
    const columns = compact ? 1 : 2;
    const rows = compact ? 2 : 2;
    const cardWidth = compact ? Math.min(width - 36, 540) : Math.min(420, (width - 66) / 2);
    const cardHeight = compact ? 112 : 132;
    const columnGap = 18;
    const rowGap = 16;
    const top = compact ? (width < 620 ? 140 : 92) : 104;
    return { columns, rows, perPage: columns * rows, cardWidth, cardHeight, columnGap, rowGap, top };
  }

  private _refreshProfiles(): void {
    this.profiles = getProfiles();
    this.selectedProfileId = getSelectedProfileId();
    const { perPage } = this._gridLayout();
    const maxPage = Math.max(0, Math.ceil(this.profiles.length / perPage) - 1);
    this.page = Phaser.Math.Clamp(this.page, 0, maxPage);
    this._renderProfiles();
  }

  private _renderProfiles(): void {
    this.profileCardsLayer.removeAll(true);
    const { width } = this.scale.gameSize;
    const layout = this._gridLayout();
    const pageCount = Math.max(1, Math.ceil(this.profiles.length / layout.perPage));
    const visibleProfiles = this.profiles.slice(
      this.page * layout.perPage,
      this.page * layout.perPage + layout.perPage,
    );

    visibleProfiles.forEach((profile, index) => {
      const column = index % layout.columns;
      const row = Math.floor(index / layout.columns);
      const totalWidth = layout.columns * layout.cardWidth + (layout.columns - 1) * layout.columnGap;
      const x = (width - totalWidth) / 2 + layout.cardWidth / 2 + column * (layout.cardWidth + layout.columnGap);
      const y = layout.top + layout.cardHeight / 2 + row * (layout.cardHeight + layout.rowGap);
      this._createProfileCard(profile, x, y, layout.cardWidth, layout.cardHeight);
    });

    this.pageText.setText(`${this.page + 1} / ${pageCount}`);
    this.previousButton.setEnabled(this.page > 0);
    this.nextButton.setEnabled(this.page < pageCount - 1);
    const hasSelection = Boolean(getProfile(this.selectedProfileId));
    this.startButton
      .setButtonFill(hasSelection ? UI_COLORS.primary : UI_COLORS.panelDark, UI_COLORS.border)
      .setEnabled(hasSelection);
    this.udpButton.setEnabled(hasSelection && udpClient.available);
  }

  private _createProfileCard(
    profile: Profile,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const isSelected = profile.id === this.selectedProfileId;
    const background = createUiPanel(this, x, y, width, height, {
      fill: isSelected ? UI_COLORS.surfaceRaised : UI_COLORS.panelDark,
      border: isSelected ? UI_COLORS.primary : UI_COLORS.border,
      borderWidth: isSelected ? 2 : 1,
      radius: 16,
    }).setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    background.on('pointerdown', () => this._selectProfile(profile.id));

    const skinOption = getSkinOption(profile.skin);
    const avatarX = x - width / 2 + 49;
    const avatarFrame = this.add.circle(
      avatarX,
      y - 7,
      33,
      isSelected ? UI_COLORS.primary : UI_COLORS.surfaceRaised,
    ).setStrokeStyle(1, isSelected ? UI_COLORS.primary : UI_COLORS.border);
    const avatar = this.add.image(avatarX, y - 7, skinOption.thumbnailKey)
      .setDisplaySize(60, 60);
    const name = this.add.text(x - width / 2 + 92, y - 35, profile.name, uiTextStyle({
      fontSize: '18px', fontStyle: '800',
    })).setOrigin(0, 0.5);
    const level = this.add.text(
      x - width / 2 + 92,
      y - 8,
      `Lv. ${profile.state.stats.level}  ·  ${skinOption.name}`,
      uiTextStyle({
        fontSize: '14px', color: '#d4d7de', fontStyle: '800',
      }),
    ).setOrigin(0, 0.5);
    const progress = this.add.text(
      x - width / 2 + 92,
      y + 13,
      `처치 ${profile.state?.killCount || 0}  ·  ${profile.state?.progression?.normalGeneration || 1}세대`,
      uiTextStyle({ fontSize: '10px', color: '#a7acb7', fontStyle: '600' }),
    ).setOrigin(0, 0.5);

    const actionsY = y + height / 2 - 22;
    const actionGap = 6;
    const actionCount = 5;
    const actionWidth = Phaser.Math.Clamp(
      (width - 24 - actionGap * (actionCount - 1)) / actionCount,
      50,
      74,
    );
    const actionStartX = x - ((actionCount - 1) * (actionWidth + actionGap)) / 2;
    const makeAction = (index: number, label: string) => createUiButton(
      this,
      actionStartX + index * (actionWidth + actionGap),
      actionsY,
      label,
      {
        width: actionWidth,
        height: 34,
        fill: UI_COLORS.surfaceRaised,
        border: UI_COLORS.border,
        fontSize: '10px',
      },
    );
    const rename = makeAction(0, '이름 수정');
    const skin = makeAction(1, '스킨 변경');
    const skills = makeAction(2, '스킬 현황');
    const download = makeAction(3, '다운로드');
    const reset = makeAction(4, '초기화');
    rename.on('pointerdown', (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ) => {
      event?.stopPropagation();
      this._renameProfile(profile.id);
    });
    skin.on('pointerdown', (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ) => {
      event?.stopPropagation();
      this._openSkinModal(profile.id);
    });
    skills.on('pointerdown', (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ) => {
      event?.stopPropagation();
      this._openSkillModal(profile.id);
    });
    download.on('pointerdown', (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ) => {
      event?.stopPropagation();
      void this._downloadProfile(profile.id);
    });
    reset.on('pointerdown', (
      _pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ) => {
      event?.stopPropagation();
      this._openResetModal(profile.id);
    });

    this.profileCardsLayer.add([
      background, avatarFrame, avatar, name, level, progress,
      rename, skin, skills, download, reset,
    ]);
  }

  private _selectProfile(profileId: string): void {
    if (!selectProfile(profileId)) return;
    this.selectedProfileId = profileId;
    this._renderProfiles();
  }

  private _changePage(direction: number): void {
    const { perPage } = this._gridLayout();
    const maxPage = Math.max(0, Math.ceil(this.profiles.length / perPage) - 1);
    this.page = Phaser.Math.Clamp(this.page + direction, 0, maxPage);
    this._renderProfiles();
  }

  private _startSelectedProfile(): void {
    const profile = getProfile(this.selectedProfileId);
    if (!profile) {
      this._showToast('먼저 프로필을 선택해 주세요.', true);
      return;
    }
    this.scene.start('GameScene', {
      profileId: profile.id,
      profileSkin: profile.skin,
      saveData: profile.state,
    });
  }

  private _startUdp(): void {
    const profile = getProfile(this.selectedProfileId);
    if (!profile) {
      this._showToast('먼저 프로필을 선택해 주세요.', true);
      return;
    }
    if (!udpClient.available) {
      this._showToast('UDP 플레이는 Electron 앱에서만 사용할 수 있습니다.', true);
      return;
    }
    this.scene.start('RoomListScene', { profileId: profile.id });
  }

  private _renameProfile(profileId: string): void {
    const profile = getProfile(profileId);
    if (!profile) return;
    this._closeResetModal();
    this._closeSkillModal();
    this._closeSkinModal();
    this._closeRenameDialog();

    const dialog = document.createElement('div');
    dialog.className = 'profile-name-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'profile-name-dialog-title');

    const form = document.createElement('form');
    form.className = 'profile-name-dialog__panel';
    const title = document.createElement('h2');
    title.id = 'profile-name-dialog-title';
    title.textContent = '프로필 이름 수정';
    const description = document.createElement('p');
    description.textContent = '사용할 이름을 20자 이내로 입력해 주세요.';
    const input = document.createElement('input');
    input.className = 'profile-name-dialog__input';
    input.type = 'text';
    input.maxLength = 20;
    input.value = profile.name;
    input.setAttribute('aria-label', '프로필 이름');
    input.autocomplete = 'off';
    const actions = document.createElement('div');
    actions.className = 'profile-name-dialog__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'profile-name-dialog__button profile-name-dialog__button--secondary';
    cancel.textContent = '취소';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'profile-name-dialog__button profile-name-dialog__button--primary';
    submit.textContent = '변경하기';

    actions.append(cancel, submit);
    form.append(title, description, input, actions);
    dialog.append(form);
    document.body.append(dialog);
    this.renameDialog = dialog;

    cancel.addEventListener('click', () => this._closeRenameDialog());
    dialog.addEventListener('pointerdown', (event) => {
      if (event.target === dialog) this._closeRenameDialog();
    });
    dialog.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') this._closeRenameDialog();
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) {
        input.classList.add('profile-name-dialog__input--error');
        input.focus();
        return;
      }
      renameProfile(profileId, name);
      this._closeRenameDialog();
      this._refreshProfiles();
      this._showToast('프로필 이름이 변경되었습니다.');
    });
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  private _closeRenameDialog(): void {
    if (this.renameDialog) this.renameDialog.remove();
    this.renameDialog = null;
  }

  private _openResetModal(profileId: string): void {
    const profile = getProfile(profileId);
    if (!profile) return;
    this._closeRenameDialog();
    this._closeSkinModal();
    this._closeSkillModal();
    this._closeResetModal();

    const { width, height } = this.scale.gameSize;
    const panelWidth = Math.min(390, width - 28);
    const root = this.add.container(width / 2, height / 2).setDepth(5000);
    const overlay = this.add.rectangle(0, 0, width, height, UI_COLORS.shadow, 0.78)
      .setInteractive();
    const panel = createUiPanel(this, 0, 0, panelWidth, 214, {
      fill: UI_COLORS.panelDark,
      border: UI_COLORS.border,
      borderWidth: 2,
      radius: 18,
      shadow: true,
    });
    const title = this.add.text(0, -68, '프로필을 초기화할까요?', uiTextStyle({
      fontSize: '20px', fontStyle: '800',
    })).setOrigin(0.5);
    const profileName = this.add.text(0, -32, `“${profile.name}”`, uiTextStyle({
      fontSize: '15px', color: '#d4d7de', fontStyle: '800',
    })).setOrigin(0.5);
    const description = this.add.text(
      0,
      2,
      '이름만 유지되고 레벨, 스킨, 진행도와\n모든 능력 및 무기 데이터가 초기화됩니다.',
      uiTextStyle({
        fontSize: '12px', color: '#a7acb7', fontStyle: '600', align: 'center', lineSpacing: 5,
      }),
    ).setOrigin(0.5);
    const cancel = createUiButton(this, -76, 69, '취소', {
      width: 132, fill: UI_COLORS.surfaceRaised, border: UI_COLORS.border,
    });
    const confirm = createUiButton(this, 76, 69, '초기화', {
      width: 132, fill: UI_COLORS.panelDeep, border: UI_COLORS.gray,
    });
    cancel.on('pointerdown', () => this._closeResetModal());
    confirm.on('pointerdown', () => {
      const reset = resetProfile(profileId);
      if (!reset) {
        this._closeResetModal();
        this._showToast('프로필을 초기화하지 못했습니다.', true);
        return;
      }
      this._closeResetModal();
      this._refreshProfiles();
      this._showToast(`“${reset.name}” 프로필을 초기화했습니다.`);
    });
    overlay.on('pointerdown', () => this._closeResetModal());
    root.add([overlay, panel, title, profileName, description, cancel, confirm]);
    this.resetModalRoot = root;
  }

  private _closeResetModal(): void {
    this.resetModalRoot?.destroy(true);
    this.resetModalRoot = null;
  }

  private _openSkillModal(profileId: string): void {
    const profile = getProfile(profileId);
    if (!profile) return;
    this._closeRenameDialog();
    this._closeResetModal();
    this._closeSkinModal();
    this._closeSkillModal();

    const definitions = createWeaponDefinitions();
    (Object.keys(definitions) as WeaponKey[]).forEach((key) => {
      definitions[key].level = profile.state.weaponLevels[key];
    });

    const { width, height } = this.scale.gameSize;
    const panelWidth = Math.min(700, width - 24);
    const panelHeight = Math.min(520, height - 24);
    const root = this.add.container(width / 2, height / 2).setDepth(5000);
    const overlay = this.add.rectangle(0, 0, width, height, UI_COLORS.shadow, 0.82)
      .setInteractive();
    const panel = createUiPanel(this, 0, 0, panelWidth, panelHeight, {
      fill: UI_COLORS.panel,
      border: UI_COLORS.border,
      borderWidth: 2,
      radius: 18,
      shadow: true,
    });
    const compact = panelWidth < 480;
    const title = this.add.text(
      0,
      -panelHeight / 2 + 31,
      `${profile.name} · 스킬 현황`,
      uiTextStyle({ fontSize: compact ? '17px' : '21px', fontStyle: '800' }),
    ).setOrigin(0.5).setWordWrapWidth(panelWidth - 110);
    const learnedCount = profile.state.stats.weapons.length;
    const hint = this.add.text(
      0,
      -panelHeight / 2 + 59,
      `습득한 스킬 ${learnedCount}/5 · 저장된 현재 레벨 기준`,
      uiTextStyle({ fontSize: '11px', color: '#a7acb7', fontStyle: '600' }),
    ).setOrigin(0.5);
    const close = createUiButton(this, panelWidth / 2 - 30, -panelHeight / 2 + 30, '×', {
      width: 40,
      height: 40,
      fill: UI_COLORS.surfaceRaised,
      border: UI_COLORS.border,
      fontSize: '18px',
    });
    close.on('pointerdown', () => this._closeSkillModal());

    const keys = Object.keys(definitions) as WeaponKey[];
    const columns = panelWidth >= 480 ? 2 : 1;
    const rows = Math.ceil(keys.length / columns);
    const columnGap = 12;
    const sidePadding = 20;
    const contentTop = -panelHeight / 2 + 82;
    const contentBottom = panelHeight / 2 - 15;
    const gridHeight = contentBottom - contentTop;
    const cellWidth = (panelWidth - sidePadding * 2 - columnGap * (columns - 1)) / columns;
    const cellHeight = gridHeight / rows;

    keys.forEach((key, index) => {
      const definition = definitions[key];
      const learned = profile.state.stats.weapons.includes(key);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cardWidth = cellWidth;
      const cardHeight = Math.max(52, cellHeight - 10);
      const x = -panelWidth / 2 + sidePadding + cardWidth / 2
        + column * (cardWidth + columnGap);
      const y = contentTop + cellHeight * row + cellHeight / 2;
      const card = createUiPanel(this, x, y, cardWidth, cardHeight, {
        fill: learned ? UI_COLORS.surfaceRaised : UI_COLORS.panelDark,
        border: learned ? UI_COLORS.primary : UI_COLORS.border,
        borderWidth: learned ? 2 : 1,
        radius: 13,
      });
      const iconSize = Phaser.Math.Clamp(cardHeight * 0.46, 30, 46);
      const iconX = x - cardWidth / 2 + 18 + iconSize / 2;
      const icon = this.add.image(iconX, y, definition.icon)
        .setDisplaySize(iconSize, iconSize)
        .setAlpha(learned ? 1 : 0.25);
      const textX = iconX + iconSize / 2 + 11;
      const textWidth = cardWidth - (textX - (x - cardWidth / 2)) - 12;
      const name = this.add.text(textX, y - cardHeight / 2 + 14, definition.name, uiTextStyle({
        fontSize: cardHeight < 70 ? '11px' : '14px',
        color: learned ? '#ffffff' : '#6f7480',
        fontStyle: '800',
      })).setOrigin(0, 0.5);
      const level = this.add.text(
        x + cardWidth / 2 - 11,
        y - cardHeight / 2 + 14,
        learned ? `Lv.${definition.level}/${definition.maxLevel ?? '∞'}` : '미습득',
        uiTextStyle({
          fontSize: '10px',
          color: learned ? '#d4d7de' : '#6f7480',
          fontStyle: '800',
        }),
      ).setOrigin(1, 0.5);
      const description = this.add.text(
        textX,
        y - 1,
        definition.desc,
        uiTextStyle({
          fontSize: cardHeight < 70 ? '8px' : '10px',
          color: learned ? '#d4d7de' : '#6f7480',
          fontStyle: '600',
          wordWrap: { width: textWidth, useAdvancedWrap: true },
        }),
      ).setOrigin(0, 0.5).setMaxLines(1);
      const stats = this.add.text(
        textX,
        y + cardHeight / 2 - 14,
        learned
          ? formatSkillStats(definition, calculateWeaponRuntimeStats(definition))
          : '레벨업 시 선택하여 습득할 수 있습니다.',
        uiTextStyle({
          fontSize: cardHeight < 70 ? '8px' : '9px',
          color: learned ? '#a7acb7' : '#6f7480',
          fontStyle: '600',
          wordWrap: { width: textWidth, useAdvancedWrap: true },
        }),
      ).setOrigin(0, 0.5).setMaxLines(2);
      root.add([card, icon, name, level, description, stats]);
    });

    overlay.on('pointerdown', () => this._closeSkillModal());
    root.addAt([overlay, panel, title, hint, close], 0);
    this.skillModalRoot = root;
  }

  private _closeSkillModal(): void {
    this.skillModalRoot?.destroy(true);
    this.skillModalRoot = null;
  }

  private async _downloadProfile(profileId: string): Promise<void> {
    try {
      await downloadProfile(profileId);
      this._showToast('프로필 다운로드 완료');
    } catch (error) {
      console.error('Failed to download profile:', error);
      this._showToast('프로필 다운로드에 실패했습니다.', true);
    }
  }

  private _openProfilePicker(): void {
    this.saveFileInput.value = '';
    this.saveFileInput.click();
  }

  private async _importProfileFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const profile = await importProfile(file);
      this.profiles = getProfiles();
      this.selectedProfileId = profile.id;
      const { perPage } = this._gridLayout();
      const index = this.profiles.findIndex((item) => item.id === profile.id);
      this.page = Math.max(0, Math.floor(index / perPage));
      this._renderProfiles();
      this._showToast(`“${profile.name}” 프로필을 추가했습니다.`);
    } catch (error) {
      console.warn('Rejected profile file:', error);
      this._showToast('잘못되었거나 변조된 프로필 파일입니다.', true);
    }
  }

  private _openSkinModal(profileId: string): void {
    this._closeResetModal();
    this._closeSkillModal();
    this._closeSkinModal();
    const profile = getProfile(profileId);
    if (!profile) return;
    this.skinModalProfileId = profileId;
    const { width, height } = this.scale.gameSize;
    const panelWidth = Math.min(650, width - 30);
    const panelHeight = Math.min(470, height - 30);
    this.skinModalRoot = this.add.container(width / 2, height / 2).setDepth(4000);
    const overlay = this.add.rectangle(0, 0, width, height, 0x000000, 0.78).setInteractive();
    const panel = createUiPanel(this, 0, 0, panelWidth, panelHeight, {
      fill: UI_COLORS.panel, border: UI_COLORS.border, borderWidth: 1, radius: 18,
    });
    const title = this.add.text(0, -panelHeight / 2 + 31, `${profile.name} · 스킨 선택`, uiTextStyle({
      fontSize: '20px', fontStyle: '800',
    })).setOrigin(0.5);
    const hint = this.add.text(
      0,
      -panelHeight / 2 + 58,
      `현재 Lv.${profile.state.stats.level} · 스킨 번호와 같은 레벨에서 해금`,
      uiTextStyle({ fontSize: '11px', color: '#a7acb7', fontStyle: '600' }),
    ).setOrigin(0.5);
    const close = createUiButton(this, panelWidth / 2 - 31, -panelHeight / 2 + 31, '×', {
      width: 42, height: 42, fill: UI_COLORS.surfaceRaised, border: UI_COLORS.border, fontSize: '18px',
    });
    close.on('pointerdown', () => this._closeSkinModal());
    this.skinOptionsLayer = this.add.container(0, 0);
    this.skinModalRoot.add([overlay, panel, title, hint, close, this.skinOptionsLayer]);
    this._renderSkinOptions();
  }

  private _renderSkinOptions(): void {
    const optionsLayer = this.skinOptionsLayer;
    const profileId = this.skinModalProfileId;
    if (!optionsLayer || !profileId) return;
    optionsLayer.removeAll(true);
    const { width, height } = this.scale.gameSize;
    const panelWidth = Math.min(650, width - 30);
    const panelHeight = Math.min(470, height - 30);
    const columns = panelWidth < 560 ? 3 : 4;
    const rows = 3;
    const perPage = columns * rows;
    const pageCount = Math.ceil(SKIN_OPTIONS.length / perPage);
    this.skinPage = Phaser.Math.Clamp(this.skinPage, 0, pageCount - 1);
    const choices = SKIN_OPTIONS.slice(this.skinPage * perPage, this.skinPage * perPage + perPage);
    const cellWidth = (panelWidth - 70) / columns;
    const cellHeight = (panelHeight - 145) / rows;
    const profile = getProfile(profileId);
    if (!profile) return;
    const profileLevel = profile.state.stats.level;

    choices.forEach((choice, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = -((columns - 1) * cellWidth) / 2 + column * cellWidth;
      const y = -panelHeight / 2 + 118 + row * cellHeight;
      const unlocked = profileLevel >= choice.requiredLevel;
      const selected = profile.skin === choice.name;
      const option = createUiButton(
        this,
        x,
        y,
        '',
        {
          width: Math.max(88, cellWidth - 12),
          height: Math.max(86, cellHeight - 10),
          fill: selected ? UI_COLORS.primary : UI_COLORS.panelDark,
          border: selected ? UI_COLORS.primary : UI_COLORS.border,
          borderWidth: selected ? 2 : 1,
          radius: 14,
        },
      );
      option.uiLabel.setVisible(false);
      option.disableInteractive();
      const thumbnail = this.add.image(x, y - 16, choice.thumbnailKey)
        .setDisplaySize(52, 52);
      const name = this.add.text(x, y + 20, choice.name, uiTextStyle({
        fontSize: '11px', color: '#ffffff', fontStyle: '800',
      })).setOrigin(0.5);
      const requirement = this.add.text(
        x,
        y + 38,
        unlocked ? `Lv.${choice.requiredLevel} 해금` : `잠김 · Lv.${choice.requiredLevel}`,
        uiTextStyle({
          fontSize: '9px',
          color: unlocked ? '#d4d7de' : '#6f7480',
          fontStyle: '600',
        }),
      ).setOrigin(0.5);
      const hitTarget = this.add.rectangle(
        x,
        y,
        Math.max(88, cellWidth - 12),
        Math.max(86, cellHeight - 10),
        0xffffff,
        0,
      ).setScrollFactor(0);

      if (unlocked) hitTarget.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        const updatedProfile = changeProfileSkin(profileId, choice.name);
        if (!updatedProfile) {
          this._showToast(`Lv.${choice.requiredLevel}부터 선택할 수 있습니다.`, true);
          return;
        }
        this._closeSkinModal();
        this._refreshProfiles();
        this._showToast(`스킨을 ${choice.name}(으)로 변경했습니다.`);
      });
      else {
        option.setEnabled(false);
        thumbnail.setAlpha(0.3);
        name.setAlpha(0.45);
        requirement.setAlpha(0.75);
      }
      optionsLayer.add([option, thumbnail, name, requirement, hitTarget]);
    });

    const previous = this._makeTextButton(-82, panelHeight / 2 - 31, '‹ 이전', '#20242d', '11px');
    const next = this._makeTextButton(82, panelHeight / 2 - 31, '다음 ›', '#20242d', '11px');
    const page = this.add.text(0, panelHeight / 2 - 31, `${this.skinPage + 1}/${pageCount}`, uiTextStyle({
      fontSize: '11px', color: '#a7acb7', fontStyle: '600',
    })).setOrigin(0.5);
    previous.setEnabled(this.skinPage > 0);
    next.setEnabled(this.skinPage < pageCount - 1);
    previous.on('pointerdown', () => {
      if (this.skinPage > 0) { this.skinPage--; this._renderSkinOptions(); }
    });
    next.on('pointerdown', () => {
      if (this.skinPage < pageCount - 1) { this.skinPage++; this._renderSkinOptions(); }
    });
    optionsLayer.add([previous, next, page]);
  }

  private _closeSkinModal(): void {
    if (this.skinModalRoot) this.skinModalRoot.destroy(true);
    this.skinModalRoot = null;
    this.skinOptionsLayer = null;
    this.skinModalProfileId = null;
    this.skinPage = 0;
  }

  private _showToast(message: string, isError = false): void {
    if (this.menuToastTween) this.menuToastTween.stop();
    this.menuToast.showMessage(message, isError);
    this.menuToastTween = this.tweens.add({
      targets: this.menuToast,
      alpha: 0,
      delay: 1800,
      duration: 300,
      ease: 'Power2',
    });
  }

  private _layout(gameSize: Phaser.Structs.Size): void {
    const { width, height } = gameSize;
    this._closeSkinModal();
    this._closeResetModal();
    this._closeSkillModal();
    this.menuBackground.setPosition(width / 2, height / 2).setDisplaySize(width, height);
    this.menuShade.setPosition(width / 2, height / 2).setDisplaySize(width, height);
    this.title.setPosition(width / 2, 36).setFontSize(width < 620 ? '25px' : '34px');
    this.subtitle.setPosition(width / 2, 72);
    this.importButton.setPosition(width < 620 ? width / 2 : width - 100, width < 620 ? 108 : 38);
    this.previousButton.setPosition(width / 2 - 90, height - 91);
    this.nextButton.setPosition(width / 2 + 90, height - 91);
    this.pageText.setPosition(width / 2, height - 91);
    const soloOnly = !udpClient.available;
    const actionWidth = soloOnly
      ? Math.min(360, width - 48)
      : Math.min(250, (width - 48) / 2);
    const actionOffset = actionWidth / 2 + 7;
    this.startButton
      .setPosition(soloOnly ? width / 2 : width / 2 - actionOffset, height - 42)
      .resizeButton(actionWidth, 50);
    this.udpButton.setPosition(width / 2 + actionOffset, height - 42).resizeButton(actionWidth, 50);
    this.menuToast.setPosition(width / 2, height - 145);
    this._refreshProfiles();
  }
}
