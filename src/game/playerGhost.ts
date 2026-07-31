export type PlayerGhostReason = 'death' | 'departure';

export interface PlayerGhostAnimation {
  name: 'failure' | 'idle';
  loop: boolean;
}

export function playerGhostAnimation(reason: PlayerGhostReason): PlayerGhostAnimation {
  return reason === 'death'
    ? { name: 'failure', loop: false }
    : { name: 'idle', loop: true };
}
