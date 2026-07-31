import type { RuneChallengePayload } from '../network/gameProtocol';
import { createUiPanel, UI_COLORS, uiTextStyle } from './theme';

const FRAME = ['img_directionkey_L', 'img_directionkey_R', 'img_directionkey_Up', 'img_directionkey_Down'];
const KEY_DIRECTION: Record<string, number | undefined> = {
  ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3,
};

export class MultiplayerRuneOverlay {
  private root: Phaser.GameObjects.Container | null = null;
  private challenge?: RuneChallengePayload;
  private index = 0;
  private attempt = 0;
  private retryAt = 0;
  private status?: Phaser.GameObjects.Text;
  private iconPanels: ReturnType<typeof createUiPanel>[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onDirection: (challengeId: string, direction: number) => void,
  ) {
    scene.input.keyboard?.on('keydown', this.keyDown, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  show(challenge: RuneChallengePayload): void {
    if (this.challenge?.challengeId === challenge.challengeId) return;
    this.destroyPanel();
    this.challenge = challenge;
    this.retryAt = challenge.retryAt;
    this.index = 0;
    this.attempt = 0;
    const { width } = this.scene.scale.gameSize;
    const panelWidth = Math.min(420, width - 24);
    this.root = this.scene.add.container(width / 2, 132).setScrollFactor(0).setDepth(5200);
    const panel = createUiPanel(this.scene, 0, 0, panelWidth, 150, {
      fill: UI_COLORS.panelDark, border: UI_COLORS.primary, borderWidth: 2, radius: 16, shadow: true,
    });
    const title = this.scene.add.text(0, -52,
      challenge.runeType === 'shield' ? '보호막 룬 커맨드' : '다중 공격 룬 커맨드',
      uiTextStyle({ fontSize: '16px', fontStyle: '800' })).setOrigin(0.5);
    this.status = this.scene.add.text(0, 55, '방향키를 순서대로 입력하세요.', uiTextStyle({
      fontSize: '11px', color: '#a7acb7', fontStyle: '600',
    })).setOrigin(0.5);
    this.root.add([panel, title, this.status]);
    const spacing = Math.min(72, (panelWidth - 72) / Math.max(1, challenge.sequence.length - 1));
    challenge.sequence.forEach((direction, index) => {
      const x = -((challenge.sequence.length - 1) * spacing) / 2 + index * spacing;
      const keyPanel = createUiPanel(this.scene, x, 4, 58, 58, {
        fill: UI_COLORS.surfaceRaised,
        border: index === 0 ? UI_COLORS.primary : UI_COLORS.border,
        borderWidth: 2,
        radius: 12,
      });
      const image = this.scene.add.image(x, 4, 'runeKeyAtlas', FRAME[direction]).setDisplaySize(44, 44);
      this.root!.add([keyPanel, image]);
      this.iconPanels.push(keyPanel);
    });
  }

  matches(challengeId: string): boolean {
    return this.challenge?.challengeId === challengeId;
  }

  markAccepted(index: number, attempt: number): void {
    if (!this.challenge || attempt < this.attempt || index > this.challenge.sequence.length) return;
    if (attempt > this.attempt) {
      this.attempt = attempt;
      this.index = 0;
    }
    if (index <= this.index) return;
    this.index = index;
    this.iconPanels.forEach((panel, itemIndex) => panel.redrawUiPanel({
      fill: itemIndex < index ? UI_COLORS.primary : UI_COLORS.surfaceRaised,
      border: itemIndex <= index ? UI_COLORS.primary : UI_COLORS.border,
    }));
    this.status?.setText(`${index} / ${this.challenge?.sequence.length ?? 0} 입력 완료`);
  }

  retry(retryAt: number, attempt: number): void {
    if (!this.challenge || attempt < this.attempt) return;
    if (attempt === this.attempt && retryAt <= this.retryAt) return;
    this.attempt = attempt;
    this.retryAt = retryAt;
    this.index = 0;
    this.iconPanels.forEach((panel) => panel.redrawUiPanel({ fill: UI_COLORS.panel, border: UI_COLORS.gray }));
    this.update();
  }

  update(): void {
    if (!this.challenge || Date.now() >= this.retryAt) {
      if (this.retryAt > 0) {
        this.retryAt = 0;
        this.iconPanels.forEach((panel, index) => panel.redrawUiPanel({
          fill: UI_COLORS.surfaceRaised,
          border: index === 0 ? UI_COLORS.primary : UI_COLORS.border,
        }));
        this.status?.setText('다시 시도하세요.');
      }
      return;
    }
    const seconds = Math.max(1, Math.ceil((this.retryAt - Date.now()) / 1000));
    this.status?.setText(`입력 실패 · ${seconds}초 뒤 재시도`);
  }

  complete(challengeId: string, attempt: number, index: number, cancelled = false): void {
    if (
      this.challenge?.challengeId === challengeId &&
      (cancelled || (attempt >= this.attempt && index === this.challenge.sequence.length))
    ) this.destroyPanel();
  }

  destroy(): void {
    this.scene.input.keyboard?.off('keydown', this.keyDown, this);
    this.destroyPanel();
  }

  private keyDown(event: KeyboardEvent): void {
    const direction = KEY_DIRECTION[event.key];
    if (direction === undefined || !this.challenge || Date.now() < this.retryAt) return;
    this.onDirection(this.challenge.challengeId, direction);
  }

  private destroyPanel(): void {
    this.root?.destroy(true);
    this.root = null;
    this.challenge = undefined;
    this.attempt = 0;
    this.status = undefined;
    this.iconPanels = [];
  }
}
