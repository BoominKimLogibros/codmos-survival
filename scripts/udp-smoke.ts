import assert from 'node:assert/strict';
import { UdpService } from '../electron/udp/UdpService';
import {
  calculateDirectedBroadcastAddress,
  getLanBroadcastAddresses,
} from '../electron/udp/networkTargets';
import { createInitialAdaptiveDifficultyState, type GameSaveState } from '../src/game/types';
import { UDP_PROTOCOL_VERSION, type UdpBridgeEvent } from '../src/network/types';
import { HOST_SNAPSHOT_LIMITS } from '../src/network/HostSnapshotPublisher';

assert.equal(calculateDirectedBroadcastAddress('172.30.1.76', '255.255.255.0'), '172.30.1.255');
assert.equal(calculateDirectedBroadcastAddress('10.23.45.67', '255.255.0.0'), '10.23.255.255');
assert.equal(calculateDirectedBroadcastAddress('not-an-ip', '255.255.255.0'), null);
assert.deepEqual(getLanBroadcastAddresses({
  en0: [{ address: '172.30.1.76', netmask: '255.255.255.0', family: 'IPv4', internal: false }],
  en1: [{ address: '10.0.4.3', netmask: '255.255.252.0', family: 4, internal: false }],
  lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
}), ['10.0.7.255', '172.30.1.255']);

const budgetSnapshot = {
  serverTime: Date.now(), tick: 1, keyframe: true,
  progress: { gameTime: 1_000_000, killCount: 1_000_000, normalGeneration: 1000, bossGeneration: 1000 },
  players: Array.from({ length: 4 }, (_, index) => ({
    id: `player-${index}-${'x'.repeat(20)}`, name: `Player ${index}`, skin: 'basic',
    x: 1024, y: 1024, vx: 200, vy: 200, hp: 100000, maxHp: 100000,
    speed: 10000, level: 1000000, xp: 1000000000, xpToNext: 1000000000,
    alive: true, connected: true, shield: 10, hitRevision: 1000000,
  })),
  enemies: Array.from({ length: HOST_SNAPSHOT_LIMITS.enemies }, (_, index) => ({
    id: `enemy-${index}`, type: 'compressed', frame: 17, x: 2048.5, y: 2048.5,
    vx: 999, vy: 999, hp: 100000000, maxHp: 100000000, scale: 5,
    bossTier: 1000, hitRevision: 1000000,
  })),
  objects: Array.from({ length: HOST_SNAPSHOT_LIMITS.objects }, (_, index) => ({
    id: `object-${index}`, texture: 'healthOrb', frame: 0, x: 2048.5, y: 2048.5,
    vx: 999, vy: 999, rotation: 6.28, scale: 5, kind: 'projectile',
  })),
  runes: [], auras: [], revives: [], removedEnemies: [], removedObjects: [], removedRunes: [],
};
// Leave room for the authenticated data-packet envelope and base64 chunk framing.
assert.ok(Buffer.byteLength(JSON.stringify(budgetSnapshot), 'utf8') < 65_000);

const state: GameSaveState = {
  gameTime: 125,
  killCount: 42,
  player: { x: 0, y: 0 },
  stats: {
    maxHp: 100, hp: 100, speed: 200, level: 3, xp: 0, xpToNext: 17,
    armor: 0, magnet: 80, recovery: 0, weapons: ['whip'],
  },
  weaponLevels: { whip: 1, bolt: 1, aura: 1, explosion: 1, shield: 1 },
  progression: {
    normalGeneration: 1,
    normalSpawnedInGeneration: 0,
    normalKillCount: 42,
    lastCompressedRollMinute: 0,
    bossGeneration: 0,
    lastBossKillMilestone: 0,
    lastRuneRollInterval: 0,
    adaptiveDifficulty: createInitialAdaptiveDifficultyState(),
  },
};

function waitFor(
  events: UdpBridgeEvent[],
  predicate: (event: UdpBridgeEvent) => boolean,
  timeoutMs = 3_000,
): Promise<UdpBridgeEvent> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const event = events.find(predicate);
      if (event) { clearInterval(timer); resolve(event); return; }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error('UDP smoke test timed out'));
      }
    }, 20);
  });
}

const hostEvents: UdpBridgeEvent[] = [];
const clientEvents: UdpBridgeEvent[] = [];
const clientTwoEvents: UdpBridgeEvent[] = [];
const clientThreeEvents: UdpBridgeEvent[] = [];
const host = new UdpService((event) => hostEvents.push(event));
const client = new UdpService((event) => clientEvents.push(event));
const clientTwo = new UdpService((event) => clientTwoEvents.push(event));
const clientThree = new UdpService((event) => clientThreeEvents.push(event));
const rejectedClient = new UdpService(() => undefined);

try {
  const hostRoom = await host.createRoom({
    name: 'Smoke Room',
    profile: { profileId: 'host-profile', name: 'Host', skin: 'basic', state },
  });
  await client.startDiscovery();
  const discovery = await waitFor(clientEvents, (event) => (
    event.type === 'rooms' && event.rooms.some((room) => room.roomId === hostRoom.roomId)
  ), 5_000);
  assert.equal(discovery.type, 'rooms');
  const room = discovery.type === 'rooms'
    ? discovery.rooms.find((candidate) => candidate.roomId === hostRoom.roomId)
    : undefined;
  assert.ok(room, 'A second local UDP service must discover the host room');
  const clientRoom = await client.joinRoom({
    room: room!,
    profile: { profileId: 'client-profile', name: 'Client', skin: 'basic', state },
  });
  await clientTwo.joinRoom({
    room: room!,
    profile: {
      profileId: 'client-two-profile', name: 'Client Two', skin: 'basic',
      state: { ...state, gameTime: 300, stats: { ...state.stats, level: 7 } },
    },
  });
  await clientThree.joinRoom({
    room: room!,
    profile: { profileId: 'client-three-profile', name: 'Client Three', skin: 'basic', state },
  });
  assert.equal(host.getRoomState()?.members.length, 4);
  await assert.rejects(() => rejectedClient.joinRoom({
    room: room!,
    profile: { profileId: 'rejected', name: 'Too Late', skin: 'basic', state },
  }), /정원이 가득/);

  const started = host.startGame();
  assert.equal(started.baselinePlayerId, clientTwo.getRoomState()?.localPlayerId);
  assert.equal(started.room.members.every((member) => member.presence === 'playing'), true);
  await waitFor(clientEvents, (event) => event.type === 'game-start');

  client.sendInput(5);
  const input = await waitFor(hostEvents, (event) => (
    event.type === 'game-message' && event.message.kind === 'input'
  ));
  assert.equal(input.type === 'game-message' ? (input.message.payload as { mask: number }).mask : -1, 5);

  const clientPlayerId = clientRoom.localPlayerId;
  const hostPrivate = host as unknown as {
    session: { room: { roomId: string; sessionId: string; hostPlayerId: string }; peers: Map<string, { token: string; target: { address: string; port: number } }> };
    sendWire(packet: unknown, target: { address: string; port: number }): void;
    makeDataPacket(
      roomId: string,
      sessionId: string,
      playerId: string,
      token: string,
      kind: string,
      payload: unknown,
      reliable: boolean,
    ): { kind: string; seq: number };
  };
  const peer = hostPrivate.session.peers.get(clientPlayerId)!;
  const originalSendWire = hostPrivate.sendWire.bind(host);
  let droppedFirstCheckpoint = false;
  hostPrivate.sendWire = (packet: unknown, target: { address: string; port: number }) => {
    const data = packet as { t?: string; kind?: string };
    if (!droppedFirstCheckpoint && data.t === 'data' && data.kind === 'checkpoint') {
      droppedFirstCheckpoint = true;
      return;
    }
    originalSendWire(packet, target);
  };
  host.sendGameMessage({
    kind: 'checkpoint',
    payload: { profileId: 'client-profile', state, padding: 'x'.repeat(18_000) },
    reliable: true,
    targetPlayerId: clientPlayerId,
  });
  await waitFor(clientEvents, (event) => (
    event.type === 'game-message' && event.message.kind === 'checkpoint'
  ));
  assert.equal(droppedFirstCheckpoint, true);
  hostPrivate.sendWire = originalSendWire;

  const makePacket = (kind: string, payload: unknown) => hostPrivate.makeDataPacket(
    hostPrivate.session.room.roomId,
    hostPrivate.session.room.sessionId,
    hostPrivate.session.room.hostPlayerId,
    peer.token,
    kind,
    payload,
    false,
  );
  const older = makePacket('order-test', { order: 1 });
  const newer = makePacket('order-test', { order: 2 });
  hostPrivate.sendWire(newer, peer.target);
  hostPrivate.sendWire(older, peer.target);
  hostPrivate.sendWire(newer, peer.target);
  await waitFor(clientEvents, (event) => (
    event.type === 'game-message' && event.message.kind === 'order-test'
  ));
  await new Promise((resolve) => setTimeout(resolve, 80));
  const ordered = clientEvents.filter((event) => (
    event.type === 'game-message' && event.message.kind === 'order-test'
  ));
  assert.equal(ordered.length, 1);
  assert.equal(
    ordered[0].type === 'game-message' ? (ordered[0].message.payload as { order: number }).order : -1,
    2,
  );

  await clientThree.leaveRoom('free-slot-after-start');
  await waitFor(hostEvents, (event) => (
    event.type === 'game-message' && event.message.kind === 'member-left'
  ));
  await assert.rejects(() => rejectedClient.joinRoom({
    room: { ...room!, playerCount: 3 },
    profile: { profileId: 'late', name: 'Late Join', skin: 'basic', state },
  }), /이미 게임이 시작/);

  const replayState: GameSaveState = {
    ...state,
    gameTime: 999,
    stats: { ...state.stats, level: 8, hp: 0 },
  };
  const lobbyState = host.returnToLobby({
    playerStates: { [hostRoom.localPlayerId]: replayState },
  });
  assert.equal(lobbyState.status, 'waiting');
  assert.equal(lobbyState.members.find((member) => member.playerId === hostRoom.localPlayerId)?.level, 8);
  assert.equal(lobbyState.privateProfiles?.[hostRoom.localPlayerId]?.state.gameTime, 999);
  assert.equal(lobbyState.members.every((member) => member.presence === 'results'), true);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(client.getRoomState()?.status, 'waiting');
  assert.throws(() => host.startGame(), /로비에서 준비되지 않았/);
  hostEvents.length = 0;
  host.setMemberPresence('lobby');
  assert.throws(() => host.startGame(), /로비에서 준비되지 않았/);
  await client.setMemberPresence('lobby');
  await clientTwo.setMemberPresence('lobby');
  await waitFor(hostEvents, (event) => (
    event.type === 'room-state' && event.room.members.every((member) => member.presence === 'lobby')
  ));
  const restarted = host.startGame();
  assert.equal(restarted.baselinePlayerId, hostRoom.localPlayerId);
  assert.equal(host.getRoomState()?.status, 'playing');

  const clientSession = (client as unknown as {
    session: { room: { roomId: string; sessionId: string }; localPlayerId: string; token: string };
    sessionSocket: { send(data: Buffer, port: number, address: string): void };
  });
  const invalidPacket = Buffer.from(JSON.stringify({
    v: UDP_PROTOCOL_VERSION,
    t: 'data',
    roomId: clientSession.session.room.roomId,
    sessionId: clientSession.session.room.sessionId,
    playerId: clientSession.session.localPlayerId,
    token: 'invalid-token',
    seq: 999_999,
    packetId: 'invalid-packet',
    kind: 'malicious-command',
    payload: { damage: 999_999 },
    reliable: false,
  }));
  clientSession.sessionSocket.send(invalidPacket, room!.port, room!.address);
  const malformedChunk = Buffer.from(JSON.stringify({
    v: UDP_PROTOCOL_VERSION,
    t: 'chunk',
    id: 'fractional-chunk',
    total: 1.5,
    index: 0,
    data: 'e30=',
  }));
  clientSession.sessionSocket.send(malformedChunk, room!.port, room!.address);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(hostEvents.some((event) => (
    event.type === 'game-message' && event.message.kind === 'malicious-command'
  )), false);
  assert.ok(host.getRoomState());

  await client.leaveRoom('smoke-complete');
  await waitFor(hostEvents, (event) => (
    event.type === 'game-message'
      && event.message.kind === 'member-left'
      && (event.message.payload as { playerId: string }).playerId === clientPlayerId
  ));
  assert.equal(host.getRoomState()?.members.length, 2);
  console.log('UDP smoke test passed: local discovery, capacity, readiness, input, auth, retry, snapshot budget, malformed chunks, order, leave');
} finally {
  host.dispose();
  client.dispose();
  clientTwo.dispose();
  clientThree.dispose();
  rejectedClient.dispose();
}
