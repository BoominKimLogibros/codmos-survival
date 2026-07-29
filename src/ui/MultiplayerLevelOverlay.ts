import type { LevelOfferPayload } from '../network/gameProtocol';
import { createUiPanel, UI_COLORS, uiTextStyle } from './theme';

export class MultiplayerLevelOverlay {
  private root: Phaser.GameObjects.Container | null = null;
  private countdown?: Phaser.Time.TimerEvent;
  private offer?: LevelOfferPayload;
  private submitted = false;
  private readonly selectFirst = (): void => this.submit(0);
  private readonly selectSecond = (): void => this.submit(1);
  private readonly selectThird = (): void => this.submit(2);

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onSelect: (offerId: string, index: number) => void,
  ) {
    scene.input.keyboard?.on('keydown-ONE', this.selectFirst);
    scene.input.keyboard?.on('keydown-TWO', this.selectSecond);
    scene.input.keyboard?.on('keydown-THREE', this.selectThird);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.input.keyboard?.off('keydown-ONE', this.selectFirst);
      scene.input.keyboard?.off('keydown-TWO', this.selectSecond);
      scene.input.keyboard?.off('keydown-THREE', this.selectThird);
      this.destroy();
    });
  }

  show(offer: LevelOfferPayload): void {
    this.destroyPanel();
    this.offer = offer;
    this.submitted = false;
    const { width, height } = this.scene.scale.gameSize;
    const panelWidth = Math.min(370, width - 28);
    const root = this.scene.add.container(width - panelWidth / 2 - 14, height / 2)
      .setScrollFactor(0).setDepth(5000);
    this.root = root;
    const panel = createUiPanel(this.scene, 0, 0, panelWidth, 398, {
      fill: UI_COLORS.panel, border: UI_COLORS.border, borderWidth: 1, radius: 18, shadow: true,
    });
    const title = this.scene.add.text(0, -168, '레벨 업!', {
      ...uiTextStyle({ fontSize: '25px', fontStyle: '800' }),
      stroke: '#0b0d12', strokeThickness: 2,
    }).setOrigin(0.5);
    const guide = this.scene.add.text(0, -137, '전투는 계속됩니다 · 강화 항목을 선택하세요', uiTextStyle({
      fontSize: '11px', color: '#d4d7de', fontStyle: '700',
    })).setOrigin(0.5);
    const timerText = this.scene.add.text(0, -116, '', uiTextStyle({
      fontSize: '11px', color: '#a7acb7', fontStyle: '600',
    })).setOrigin(0.5);
    root.add([panel, title, guide, timerText]);
    offer.choices.forEach((choice, index) => {
      const y = -63 + index * 94;
      const cardWidth = panelWidth - 28;
      const cardHeight = 82;
      const card = createUiPanel(this.scene, 0, y, cardWidth, cardHeight, {
        fill: UI_COLORS.surfaceRaised, border: UI_COLORS.border, borderWidth: 1, radius: 14,
      });
      const left = -cardWidth / 2;
      let icon: Phaser.GameObjects.Image | undefined;
      if (choice.icon) {
        icon = this.scene.add.image(left + 47, y, choice.icon).setDisplaySize(30, 30);
      }
      const textX = left + 85;
      const name = this.scene.add.text(textX, y - 23, choice.name, uiTextStyle({
        fontSize: '14px', fontStyle: '800',
      })).setOrigin(0, 0.5);
      const desc = this.scene.add.text(textX, y, choice.desc, uiTextStyle({
        fontSize: '10px', color: '#a7acb7', fontStyle: '600',
        wordWrap: { width: cardWidth - 145 },
      })).setOrigin(0, 0.5);
      const levelText = this.scene.add.text(textX, y + 23, choice.levelText ?? '', uiTextStyle({
        fontSize: '10px', color: '#d4d7de', fontStyle: '800',
      })).setOrigin(0, 0.5);
      const keyBadge = createUiPanel(this.scene, cardWidth / 2 - 27, y, 34, 34, {
        fill: UI_COLORS.panelDark, border: UI_COLORS.border, radius: 9,
      });
      const key = this.scene.add.text(cardWidth / 2 - 27, y, `${index + 1}`, uiTextStyle({
        fontSize: '14px', fontStyle: '800',
      })).setOrigin(0.5);
      const hitTarget = this.scene.add.zone(0, y, cardWidth, cardHeight)
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      hitTarget.on('pointerover', () => card.redrawUiPanel({ border: UI_COLORS.primary, borderWidth: 2 }));
      hitTarget.on('pointerout', () => card.redrawUiPanel({ border: UI_COLORS.border, borderWidth: 1 }));
      hitTarget.on('pointerdown', () => this.submit(index));
      root.add([card, ...(icon ? [icon] : []), name, desc, levelText, keyBadge, key, hitTarget]);
    });
    const update = () => {
      const remaining = Math.max(0, Math.ceil((offer.expiresAt - Date.now()) / 1000));
      timerText.setText(`${remaining}초 뒤 첫 번째 항목 자동 선택`);
    };
    update();
    this.countdown = this.scene.time.addEvent({ delay: 200, loop: true, callback: update });
  }

  complete(offerId: string): void {
    if (this.offer?.offerId !== offerId) return;
    this.destroyPanel();
  }

  destroy(): void {
    this.destroyPanel();
  }

  private submit(index: number): void {
    if (!this.offer || this.submitted || !this.offer.choices[index]) return;
    this.submitted = true;
    this.onSelect(this.offer.offerId, index);
  }

  private destroyPanel(): void {
    this.countdown?.remove(false);
    this.countdown = undefined;
    this.root?.destroy(true);
    this.root = null;
    this.offer = undefined;
  }
}
