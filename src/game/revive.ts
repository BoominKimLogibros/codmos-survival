export const REVIVE_DURATION_MS = 10_000;
export const REVIVE_RADIUS = 68;

export function shouldShowReviveMarker(chargingPlayerId?: string): boolean {
  return Boolean(chargingPlayerId);
}
