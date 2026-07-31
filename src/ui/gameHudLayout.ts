export interface ExitButtonPosition {
  x: number;
  y: number;
}

const EXIT_BUTTON_HALF_WIDTH = 54;
const EXIT_BUTTON_HALF_HEIGHT = 21;
const EXIT_BUTTON_EDGE_MARGIN = 16;
const TOUCH_EXIT_BOTTOM_OFFSET = 158;

/** Keeps the exit button anchored to the current canvas edge after native-window resizes. */
export function calculateExitButtonPosition(
  width: number,
  height: number,
  touchControls: boolean,
): ExitButtonPosition {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  return {
    x: Math.max(
      EXIT_BUTTON_HALF_WIDTH,
      safeWidth - EXIT_BUTTON_HALF_WIDTH - EXIT_BUTTON_EDGE_MARGIN,
    ),
    y: Math.max(
      EXIT_BUTTON_HALF_HEIGHT,
      touchControls
        ? safeHeight - TOUCH_EXIT_BOTTOM_OFFSET
        : safeHeight - EXIT_BUTTON_HALF_HEIGHT - EXIT_BUTTON_EDGE_MARGIN + 2,
    ),
  };
}
