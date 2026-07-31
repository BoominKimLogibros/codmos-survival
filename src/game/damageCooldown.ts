/** Records a hit only when this damage source's own interval has elapsed. */
export function consumeDamageSourceCooldown(
  sourceTimes: Map<string, number>,
  sourceId: string,
  now: number,
  intervalMs: number,
): boolean {
  const lastHitAt = sourceTimes.get(sourceId) ?? Number.NEGATIVE_INFINITY;
  if (now - lastHitAt < intervalMs) return false;
  sourceTimes.set(sourceId, now);
  return true;
}

/** Records one hit for the lifetime of a continuous hitbox overlap. */
export function consumeDamageContact(
  contactFrames: Map<string, number>,
  sourceId: string,
  frame: number,
): boolean {
  const isNewContact = !contactFrames.has(sourceId);
  contactFrames.set(sourceId, frame);
  return isNewContact;
}

/**
 * Removes sources that were absent for a complete physics frame. The one-frame
 * grace works with either Phaser update/collision callback ordering while still
 * allowing a source to deal damage again after leaving and re-entering.
 */
export function pruneDamageContacts(
  contactFrames: Map<string, number>,
  frame: number,
): void {
  contactFrames.forEach((lastSeenFrame, sourceId) => {
    if (frame - lastSeenFrame > 1) contactFrames.delete(sourceId);
  });
}
