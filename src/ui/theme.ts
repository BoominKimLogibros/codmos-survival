export const UI_FONT_FAMILY = 'Nunito';

export interface UiPanelOptions {
  fill?: number;
  border?: number;
  borderWidth?: number;
  radius?: number;
  alpha?: number;
  shadow?: boolean;
  shadowOffset?: number;
}

export interface UiButtonOptions extends UiPanelOptions {
  width?: number;
  height?: number;
  fontSize?: string;
  color?: string;
  fontStyle?: string;
}

export interface UiToastOptions {
  width?: number;
  height?: number;
  fontSize?: string;
}

export interface UiPanel extends Phaser.GameObjects.Graphics {
  uiWidth: number;
  uiHeight: number;
  uiOptions: UiPanelOptions;
  redrawUiPanel(nextOptions?: UiPanelOptions): UiPanel;
  resizeUiPanel(width: number, height: number): UiPanel;
}

export interface UiButton extends Phaser.GameObjects.Container {
  uiBackground: UiPanel;
  uiLabel: Phaser.GameObjects.Text;
  uiEnabled: boolean;
  setLabel(label: string): UiButton;
  setButtonFill(fill: number, border?: number): UiButton;
  setEnabled(enabled: boolean): UiButton;
  resizeButton(width: number, height?: number): UiButton;
}

export interface UiToast extends Phaser.GameObjects.Container {
  uiBackground: UiPanel;
  uiLabel: Phaser.GameObjects.Text;
  showMessage(message: string, isError?: boolean): UiToast;
}

export const UI_COLORS = Object.freeze({
  page: 0x0b0d12,
  panel: 0x171a21,
  panelDark: 0x111318,
  panelDeep: 0x090a0d,
  surfaceRaised: 0x20242d,
  border: 0x353945,
  primary: 0x6c5ce7,
  health: 0xef4444,
  experience: 0x22c55e,
  gray: 0x6f7480,
  grayLight: 0xd4d7de,
  white: 0xf7f7fa,
  muted: 0xa7acb7,
  shadow: 0x000000,

  // Legacy aliases keep gameplay code compatible while enforcing one UI palette.
  cyan: 0x6c5ce7,
  cyanLight: 0xd4d7de,
  mint: 0x20242d,
  pink: 0x20242d,
  purple: 0x20242d,
  warning: 0x6f7480,
  danger: 0x20242d,
  success: 0x6c5ce7,
});

export function uiTextStyle(
  overrides: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: UI_FONT_FAMILY,
    color: '#ffffff',
    ...overrides,
  };
}

function drawRoundedPanel(
  graphics: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  options: UiPanelOptions = {},
): void {
  const {
    fill = UI_COLORS.panel,
    border = UI_COLORS.border,
    borderWidth = 1,
    radius = 16,
    alpha = 1,
    shadow = false,
    shadowOffset = 2,
  } = options;
  const resolvedBorderWidth = Phaser.Math.Clamp(borderWidth, 0, 2);
  const resolvedRadius = Phaser.Math.Clamp(radius, 0, 18);
  graphics.clear();
  if (shadow) {
    graphics.fillStyle(UI_COLORS.shadow, 0.22);
    graphics.fillRoundedRect(
      -width / 2,
      -height / 2 + shadowOffset,
      width,
      height,
      resolvedRadius,
    );
  }
  if (resolvedBorderWidth > 0) {
    graphics.fillStyle(border, alpha);
    graphics.fillRoundedRect(-width / 2, -height / 2, width, height, resolvedRadius);
    graphics.fillStyle(fill, alpha);
    graphics.fillRoundedRect(
      -width / 2 + resolvedBorderWidth,
      -height / 2 + resolvedBorderWidth,
      width - resolvedBorderWidth * 2,
      height - resolvedBorderWidth * 2,
      Math.max(0, resolvedRadius - resolvedBorderWidth),
    );
  } else {
    graphics.fillStyle(fill, alpha);
    graphics.fillRoundedRect(-width / 2, -height / 2, width, height, resolvedRadius);
  }
}

export function createUiPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  options: UiPanelOptions = {},
): UiPanel {
  const panel = scene.add.graphics().setPosition(x, y) as UiPanel;
  panel.uiWidth = width;
  panel.uiHeight = height;
  panel.uiOptions = { ...options };
  panel.redrawUiPanel = (nextOptions = {}) => {
    panel.uiOptions = { ...panel.uiOptions, ...nextOptions };
    drawRoundedPanel(panel, panel.uiWidth, panel.uiHeight, panel.uiOptions);
    return panel;
  };
  panel.resizeUiPanel = (nextWidth, nextHeight) => {
    panel.uiWidth = nextWidth;
    panel.uiHeight = nextHeight;
    drawRoundedPanel(panel, panel.uiWidth, panel.uiHeight, panel.uiOptions);
    return panel;
  };
  panel.redrawUiPanel();
  return panel;
}

export function createUiButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  options: UiButtonOptions = {},
): UiButton {
  const config = {
    width: 140,
    height: 42,
    fill: UI_COLORS.primary,
    border: UI_COLORS.border,
    borderWidth: 1,
    radius: 12,
    fontSize: '15px',
    color: '#ffffff',
    fontStyle: '800',
    shadow: false,
    ...options,
  };
  const button = scene.add.container(x, y).setScrollFactor(0) as UiButton;
  const background = createUiPanel(scene, 0, 0, config.width, config.height, {
    fill: config.fill,
    border: config.border,
    borderWidth: config.borderWidth,
    radius: config.radius,
    shadow: config.shadow === true,
    shadowOffset: 2,
  });
  const text = scene.add.text(0, -1, label, uiTextStyle({
    fontSize: config.fontSize,
    color: config.color,
    fontStyle: config.fontStyle,
    align: 'center',
  })).setOrigin(0.5);
  button.add([background, text]);
  button.setSize(config.width, config.height);

  // The container owns the hit area. An interactive child would keep its own
  // camera scroll factor and drift away from fixed HUD buttons as the camera moves.
  const enableInteraction = (): UiButton => button.setInteractive({
    hitArea: new Phaser.Geom.Rectangle(
      0,
      0,
      config.width,
      config.height,
    ),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    useHandCursor: true,
  });
  enableInteraction();

  button.uiBackground = background;
  button.uiLabel = text;
  button.uiEnabled = true;
  button.setLabel = (nextLabel: string) => {
    text.setText(nextLabel);
    return button;
  };
  button.setButtonFill = (fill: number, border = config.border) => {
    config.fill = fill;
    config.border = border;
    background.redrawUiPanel({ fill, border });
    return button;
  };
  button.setEnabled = (enabled: boolean) => {
    button.uiEnabled = enabled;
    if (enabled) enableInteraction();
    else button.disableInteractive();
    button.setAlpha(enabled ? 1 : 0.38);
    return button;
  };
  button.resizeButton = (width: number, height = config.height) => {
    config.width = width;
    config.height = height;
    background.resizeUiPanel(width, height);
    button.setSize(width, height);
    if (button.uiEnabled) enableInteraction();
    return button;
  };

  button.on('pointerover', () => {
    if (!button.uiEnabled) return;
    scene.tweens.add({ targets: button, scaleX: 1.035, scaleY: 1.035, duration: 90 });
  });
  button.on('pointerout', () => {
    scene.tweens.add({ targets: button, scaleX: 1, scaleY: 1, duration: 90 });
  });
  button.on('pointerdown', () => {
    if (!button.uiEnabled) return;
    scene.tweens.add({
      targets: button,
      scaleX: 0.96,
      scaleY: 0.96,
      duration: 65,
      yoyo: true,
    });
  });
  return button;
}

export function createUiToast(
  scene: Phaser.Scene,
  x: number,
  y: number,
  options: UiToastOptions = {},
): UiToast {
  const width = options.width || 360;
  const height = options.height || 46;
  const toast = scene.add.container(x, y).setAlpha(0) as UiToast;
  const background = createUiPanel(scene, 0, 0, width, height, {
    fill: UI_COLORS.panelDark,
    border: UI_COLORS.border,
    borderWidth: 1,
    radius: height / 2,
    shadow: false,
  });
  const label = scene.add.text(0, -1, '', uiTextStyle({
    fontSize: options.fontSize || '14px',
    fontStyle: '800',
    align: 'center',
    wordWrap: { width: width - 32 },
  })).setOrigin(0.5);
  toast.add([background, label]);
  toast.uiBackground = background;
  toast.uiLabel = label;
  toast.showMessage = (message: string, isError = false) => {
    label.setText(message);
    background.redrawUiPanel({
      fill: UI_COLORS.panelDark,
      border: isError ? UI_COLORS.gray : UI_COLORS.primary,
    });
    toast.setAlpha(1);
    return toast;
  };
  return toast;
}
