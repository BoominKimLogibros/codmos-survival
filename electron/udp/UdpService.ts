import dgram, { type RemoteInfo, type Socket } from 'node:dgram';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  CreateRoomRequest,
  GameStartPayload,
  JoinRoomRequest,
  MemberPresence,
  NetworkProfile,
  ReturnToLobbyRequest,
  RoomMember,
  RoomState,
  RoomSummary,
  SendGameMessageRequest,
  UdpBridgeEvent,
} from '../../src/network/types';
import {
  isRoomMemberReady,
  UDP_DISCOVERY_MULTICAST_ADDRESS,
  UDP_DISCOVERY_PORT,
  UDP_MAX_PLAYERS,
  UDP_MIN_PLAYERS,
  UDP_PROTOCOL_VERSION,
} from '../../src/network/types';
import { getLanBroadcastAddresses } from './networkTargets';
import { MAX_WEAPON_LEVEL } from '../../src/config/constants';

const MAX_DATAGRAM_BYTES = 1_200;
const CHUNK_DATA_BYTES = 720;
const RELIABLE_RETRY_MS = 100;
const RELIABLE_ATTEMPTS = 50;
const ROOM_EXPIRY_MS = 3_000;
const RECONNECTING_MS = 3_000;
const DISCONNECT_MS = 10_000;
const INPUT_TIMEOUT_MS = 220;
const MAX_CHUNK_COUNT = 128;
const MAX_CHUNK_ASSEMBLIES = 64;
const MAX_CHUNK_ID_LENGTH = 96;
const MAX_REASSEMBLED_BYTES = 80_000;

type Target = { address: string; port: number };

interface AnnouncePacket {
  v: number;
  t: 'announce';
  room: Omit<RoomSummary, 'address' | 'ping' | 'updatedAt'>;
  sentAt: number;
}

interface ProbePacket { v: number; t: 'probe' }

interface JoinPacket {
  v: number;
  t: 'join';
  roomId: string;
  nonce: string;
  profile: NetworkProfile;
}

interface JoinAcceptPacket {
  v: number;
  t: 'join-accept';
  nonce: string;
  playerId: string;
  token: string;
  room: PublicRoomState;
}

interface JoinRejectPacket {
  v: number;
  t: 'join-reject';
  nonce: string;
  reason: string;
}

interface DataPacket {
  v: number;
  t: 'data';
  roomId: string;
  sessionId: string;
  playerId: string;
  token: string;
  seq: number;
  packetId: string;
  kind: string;
  payload: unknown;
  reliable: boolean;
}

interface AckPacket {
  v: number;
  t: 'ack';
  roomId: string;
  sessionId: string;
  playerId: string;
  token: string;
  packetId: string;
}

interface ChunkPacket {
  v: number;
  t: 'chunk';
  id: string;
  index: number;
  total: number;
  data: string;
}

type WirePacket = AnnouncePacket | ProbePacket | JoinPacket | JoinAcceptPacket
  | JoinRejectPacket | DataPacket | AckPacket | ChunkPacket;

interface PublicRoomState {
  roomId: string;
  sessionId: string;
  name: string;
  status: 'waiting' | 'playing';
  hostPlayerId: string;
  members: RoomMember[];
}

interface Peer {
  playerId: string;
  token: string;
  target: Target;
  profile: NetworkProfile;
  nonce: string;
  lastSeenAt: number;
  lastInputAt: number;
  inputStopped: boolean;
  lastSequences: Map<string, number>;
}

interface HostSession {
  role: 'host';
  room: PublicRoomState;
  localProfile: NetworkProfile;
  localToken: string;
  peers: Map<string, Peer>;
}

interface ClientSession {
  role: 'client';
  room: PublicRoomState;
  localProfile: NetworkProfile;
  localPlayerId: string;
  token: string;
  hostTarget: Target;
  lastHostSeenAt: number;
  lastSequences: Map<string, number>;
  checkpointReceived: boolean;
  disconnectEmitted: boolean;
  reconnectingEmitted: boolean;
}

type Session = HostSession | ClientSession;

interface PendingReliable {
  packet: DataPacket;
  target: Target;
  attempts: number;
  nextAttemptAt: number;
}

interface ChunkAssembly {
  createdAt: number;
  pieces: Array<string | undefined>;
  received: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidNetworkProfile(value: unknown): value is NetworkProfile {
  if (!isRecord(value) || !isRecord(value.state)) return false;
  const stats = value.state.stats;
  const weaponLevels = value.state.weaponLevels;
  const progression = value.state.progression;
  const adaptive = isRecord(progression) ? progression.adaptiveDifficulty : null;
  const weaponKeys = ['whip', 'bolt', 'aura', 'explosion', 'shield'] as const;
  return typeof value.profileId === 'string' && value.profileId.length > 0 && value.profileId.length <= 128 &&
    typeof value.name === 'string' && value.name.length <= 30 &&
    typeof value.skin === 'string' && value.skin.length <= 64 &&
    isRecord(stats) &&
    isFiniteNumber(stats.level) && stats.level >= 1 && stats.level <= 1_000_000 &&
    isFiniteNumber(stats.hp) && isFiniteNumber(stats.maxHp) && stats.hp >= 0 && stats.hp <= stats.maxHp &&
    Array.isArray(stats.weapons) && stats.weapons.length >= 1 && stats.weapons.length <= 5 &&
    stats.weapons.every((key) => weaponKeys.includes(key as typeof weaponKeys[number])) &&
    isRecord(weaponLevels) && weaponKeys.every((key) => (
      isFiniteNumber(weaponLevels[key]) && Number.isInteger(weaponLevels[key]) &&
      weaponLevels[key] >= 1 && weaponLevels[key] <= MAX_WEAPON_LEVEL
    )) &&
    isRecord(progression) &&
    isFiniteNumber(progression.normalKillCount) && progression.normalKillCount >= 0 &&
    isRecord(adaptive) &&
    isFiniteNumber(adaptive.activeTarget) &&
    isFiniteNumber(adaptive.hpMultiplier) &&
    isFiniteNumber(adaptive.deathDifficultyMultiplier) &&
    adaptive.deathDifficultyMultiplier > 0 && adaptive.deathDifficultyMultiplier <= 1;
}

function isValidAnnouncedRoom(value: unknown): value is AnnouncePacket['room'] {
  if (!isRecord(value)) return false;
  return typeof value.roomId === 'string' && value.roomId.length > 0 && value.roomId.length <= 128 &&
    typeof value.name === 'string' && value.name.length <= 30 &&
    typeof value.hostName === 'string' && value.hostName.length <= 30 &&
    isFiniteNumber(value.hostLevel) &&
    isFiniteNumber(value.playerCount) && Number.isInteger(value.playerCount) &&
    value.playerCount >= 1 && value.playerCount <= UDP_MAX_PLAYERS &&
    value.maxPlayers === UDP_MAX_PLAYERS &&
    (value.status === 'waiting' || value.status === 'playing') &&
    isFiniteNumber(value.port) && Number.isInteger(value.port) &&
    value.port >= 1 && value.port <= 65535;
}

function token(): string {
  return randomBytes(18).toString('hex');
}

function safeName(value: string, fallback: string): string {
  const clean = String(value || '').trim().slice(0, 30);
  return clean || fallback;
}

function publicMember(
  playerId: string,
  profile: NetworkProfile,
  isHost: boolean,
  joinOrder: number,
): RoomMember {
  return {
    playerId,
    name: safeName(profile.name, '플레이어'),
    skin: profile.skin,
    level: profile.state.stats.level,
    hp: profile.state.stats.hp,
    maxHp: profile.state.stats.maxHp,
    alive: profile.state.stats.hp > 0,
    connection: 'connected',
    presence: 'lobby',
    isHost,
    joinOrder,
  };
}

function sameTarget(a: Target, b: Target): boolean {
  const normalize = (address: string) => address.replace(/^::ffff:/, '');
  return normalize(a.address) === normalize(b.address) && a.port === b.port;
}

export class UdpService {
  private discoverySocket: Socket | null = null;
  private sessionSocket: Socket | null = null;
  private session: Session | null = null;
  private readonly discoveredRooms = new Map<string, RoomSummary>();
  private readonly pendingReliable = new Map<string, PendingReliable>();
  private readonly chunks = new Map<string, ChunkAssembly>();
  private outputSequence = 0;
  private lastHeartbeatAt = 0;
  private lastOversizeLogAt = 0;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private announceTimer: NodeJS.Timeout | null = null;
  private maintenanceTimer: NodeJS.Timeout;
  private joinCancel: (() => void) | null = null;

  constructor(private readonly emit: (event: UdpBridgeEvent) => void) {
    this.maintenanceTimer = setInterval(() => this.maintain(), 50);
  }

  async startDiscovery(): Promise<RoomSummary[]> {
    await this.ensureDiscoverySocket();
    this.startDiscoveryClock();
    this.broadcastProbe();
    return this.roomList();
  }

  async refreshRooms(): Promise<RoomSummary[]> {
    await this.ensureDiscoverySocket();
    this.expireRooms();
    this.broadcastProbe();
    return this.roomList();
  }

  async stopDiscovery(): Promise<void> {
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.discoveryTimer = null;
    if (!this.session || this.session.role !== 'host') this.closeDiscoverySocket();
  }

  async createRoom(request: CreateRoomRequest): Promise<RoomState> {
    if (!request || typeof request.name !== 'string' || !isValidNetworkProfile(request.profile)) {
      throw new Error('방 또는 프로필 정보가 올바르지 않습니다.');
    }
    await this.leaveRoom('replace-session');
    await this.ensureDiscoverySocket();
    await this.ensureSessionSocket();
    const roomId = randomUUID();
    const sessionId = randomUUID();
    const playerId = randomUUID();
    const hostToken = token();
    const member = publicMember(playerId, request.profile, true, 0);
    this.session = {
      role: 'host',
      localProfile: request.profile,
      localToken: hostToken,
      peers: new Map(),
      room: {
        roomId,
        sessionId,
        name: safeName(request.name, `${member.name}의 방`),
        status: 'waiting',
        hostPlayerId: playerId,
        members: [member],
      },
    };
    this.startAnnouncing();
    const state = this.getRoomState();
    if (!state) throw new Error('방을 만들 수 없습니다.');
    this.emit({ type: 'room-state', room: state });
    return state;
  }

  async joinRoom(request: JoinRoomRequest): Promise<RoomState> {
    if (
      !request ||
      !isValidNetworkProfile(request.profile) ||
      !request.room ||
      typeof request.room.address !== 'string' ||
      !Number.isInteger(request.room.port) ||
      request.room.port < 1 ||
      request.room.port > 65535
    ) throw new Error('방 또는 프로필 정보가 올바르지 않습니다.');
    await this.leaveRoom('replace-session');
    if (request.room.status !== 'waiting') throw new Error('이미 시작된 방입니다.');
    await this.ensureSessionSocket();
    const nonce = randomUUID();
    const target = { address: request.room.address, port: request.room.port };
    const packet: JoinPacket = {
      v: UDP_PROTOCOL_VERSION,
      t: 'join',
      roomId: request.room.roomId,
      nonce,
      profile: request.profile,
    };

    return new Promise<RoomState>((resolve, reject) => {
      let attempts = 0;
      let timer: NodeJS.Timeout;
      const cleanup = () => {
        clearInterval(timer);
        clearTimeout(timeout);
        this.joinCancel = null;
        this.pendingJoinHandler = null;
      };
      const send = () => {
        attempts++;
        this.sendWire(packet, target);
        if (attempts >= RELIABLE_ATTEMPTS) {
          cleanup();
          reject(new Error('방장이 응답하지 않습니다.'));
        }
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('방 참여 시간이 초과되었습니다.'));
      }, 5_500);
      timer = setInterval(send, RELIABLE_RETRY_MS);
      this.joinCancel = () => {
        cleanup();
        reject(new Error('방 참여가 취소되었습니다.'));
      };
      const onAccept = (accepted: JoinAcceptPacket, rinfo: RemoteInfo) => {
        if (accepted.nonce !== nonce || !sameTarget(target, rinfo)) return false;
        cleanup();
        this.session = {
          role: 'client',
          room: accepted.room,
          localProfile: request.profile,
          localPlayerId: accepted.playerId,
          token: accepted.token,
          hostTarget: target,
          lastHostSeenAt: Date.now(),
          lastSequences: new Map(),
          checkpointReceived: false,
          disconnectEmitted: false,
          reconnectingEmitted: false,
        };
        const state = this.getRoomState();
        if (!state) return false;
        this.emit({ type: 'room-state', room: state });
        resolve(state);
        return true;
      };
      const onReject = (rejected: JoinRejectPacket, rinfo: RemoteInfo) => {
        if (rejected.nonce !== nonce || !sameTarget(target, rinfo)) return false;
        cleanup();
        reject(new Error(rejected.reason));
        return true;
      };
      this.pendingJoinHandler = { onAccept, onReject };
      send();
    });
  }

  async leaveRoom(reason = 'left'): Promise<void> {
    this.joinCancel?.();
    this.joinCancel = null;
    const session = this.session;
    if (session) {
      if (session.role === 'host') {
        for (const peer of session.peers.values()) {
          this.sendDataToPeer(peer, 'room-closed', { reason }, true);
        }
      } else {
        this.sendClientData('leave', { reason }, true);
      }
      // Keep the socket alive through two retry windows so normal leave and
      // room-close commands retain the same ACK semantics as gameplay commands.
      await new Promise((resolve) => setTimeout(resolve, RELIABLE_RETRY_MS * 2 + 50));
    }
    this.session = null;
    this.pendingReliable.clear();
    this.chunks.clear();
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.announceTimer = null;
    this.closeSessionSocket();
  }

  startGame(): GameStartPayload {
    const session = this.requireHost();
    if (session.room.status !== 'waiting') throw new Error('이미 게임이 시작되었습니다.');
    if (session.room.members.length < UDP_MIN_PLAYERS) {
      throw new Error(`게임 시작에는 ${UDP_MIN_PLAYERS}명 이상이 필요합니다.`);
    }
    const unavailable = session.room.members.filter((member) => !isRoomMemberReady(member));
    if (unavailable.length > 0) {
      const names = unavailable.map((member) => member.name).join(', ');
      throw new Error(`${names}님이 아직 로비에서 준비되지 않았습니다.`);
    }
    session.room.members.forEach((member) => {
      member.presence = 'playing';
    });
    session.room.status = 'playing';
    const baseline = [...session.room.members].sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      const aTime = this.profileFor(a.playerId)?.state.gameTime ?? 0;
      const bTime = this.profileFor(b.playerId)?.state.gameTime ?? 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.joinOrder - b.joinOrder;
    })[0];
    const hostState = this.getRoomState();
    if (!hostState || !baseline) throw new Error('게임 시작 정보를 만들 수 없습니다.');
    const startedAt = Date.now() + 500;
    const publicPayload = {
      room: this.publicRoomStateForClient(),
      baselinePlayerId: baseline.playerId,
      startedAt,
    };
    this.broadcastHostData('game-start', publicPayload, true);
    this.broadcastLobbyState();
    const payload: GameStartPayload = { room: hostState, baselinePlayerId: baseline.playerId, startedAt };
    this.emit({ type: 'game-start', data: payload });
    return payload;
  }

  returnToLobby(request: ReturnToLobbyRequest): RoomState {
    const session = this.requireHost();
    for (const [playerId, state] of Object.entries(request.playerStates ?? {})) {
      const profile = this.profileFor(playerId);
      const member = session.room.members.find((candidate) => candidate.playerId === playerId);
      if (!profile || !member || !state?.stats) continue;
      profile.state = structuredClone(state);
      member.level = state.stats.level;
      member.maxHp = state.stats.maxHp;
      member.hp = state.stats.maxHp;
      member.alive = true;
    }
    session.room.status = 'waiting';
    session.room.members.forEach((member) => {
      if (member.presence === 'playing') member.presence = 'results';
    });
    const now = Date.now();
    session.peers.forEach((peer) => {
      peer.lastInputAt = now;
      peer.inputStopped = true;
    });
    this.broadcastLobbyState();
    const state = this.getRoomState();
    if (!state) throw new Error('방 로비 상태를 만들 수 없습니다.');
    return state;
  }

  setMemberPresence(presence: MemberPresence): RoomState {
    if (!['lobby', 'playing', 'results'].includes(presence)) {
      throw new Error('올바르지 않은 참가자 상태입니다.');
    }
    const session = this.session;
    if (!session) throw new Error('참여 중인 방이 없습니다.');
    const member = session.room.members.find((candidate) => (
      candidate.playerId === (session.role === 'host'
        ? session.room.hostPlayerId
        : session.localPlayerId)
    ));
    if (!member) throw new Error('참가자 상태를 찾을 수 없습니다.');
    member.presence = presence;

    if (session.role === 'host') {
      this.broadcastLobbyState();
    } else {
      this.sendClientData('member-presence', { presence }, true);
      const localState = this.getRoomState();
      if (localState) this.emit({ type: 'room-state', room: localState });
    }
    const state = this.getRoomState();
    if (!state) throw new Error('방 상태를 불러올 수 없습니다.');
    return state;
  }

  getRoomState(): RoomState | null {
    const session = this.session;
    if (!session) return null;
    if (session.role === 'host') {
      const privateProfiles: Record<string, NetworkProfile> = {
        [session.room.hostPlayerId]: session.localProfile,
      };
      for (const peer of session.peers.values()) privateProfiles[peer.playerId] = peer.profile;
      return {
        ...session.room,
        members: session.room.members.map((member) => ({ ...member })),
        localPlayerId: session.room.hostPlayerId,
        isHost: true,
        privateProfiles,
      };
    }
    return {
      ...session.room,
      members: session.room.members.map((member) => ({ ...member })),
      localPlayerId: session.localPlayerId,
      isHost: false,
    };
  }

  sendInput(mask: number): void {
    const session = this.session;
    if (!session || session.role === 'host' || session.room.status !== 'playing') return;
    this.sendClientData('input', { mask: mask & 15 }, false);
  }

  sendGameMessage(request: SendGameMessageRequest): void {
    const session = this.session;
    if (!session) return;
    if (session.role === 'host') {
      if (request.targetPlayerId === session.room.hostPlayerId) {
        this.emitGameMessage(
          request.kind,
          request.payload,
          session.room.hostPlayerId,
          Boolean(request.reliable),
          ++this.outputSequence,
        );
        return;
      }
      if (request.targetPlayerId) {
        const peer = session.peers.get(request.targetPlayerId);
        if (peer) this.sendDataToPeer(peer, request.kind, request.payload, Boolean(request.reliable));
      } else {
        this.broadcastHostData(request.kind, request.payload, Boolean(request.reliable));
      }
      return;
    }
    this.sendClientData(request.kind, request.payload, Boolean(request.reliable));
  }

  dispose(): void {
    void this.leaveRoom('app-closed');
    clearInterval(this.maintenanceTimer);
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.closeDiscoverySocket();
  }

  private pendingJoinHandler: {
    onAccept: (packet: JoinAcceptPacket, rinfo: RemoteInfo) => boolean;
    onReject: (packet: JoinRejectPacket, rinfo: RemoteInfo) => boolean;
  } | null = null;

  private async ensureDiscoverySocket(): Promise<void> {
    if (this.discoverySocket) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.discoverySocket = socket;
    socket.on('message', (data, rinfo) => this.handleWire(data, rinfo));
    socket.on('error', (error) => this.emitError(`LAN 검색 오류: ${error.message}`));
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind({ port: UDP_DISCOVERY_PORT, address: '0.0.0.0', exclusive: false }, () => {
        socket.removeListener('error', reject);
        try { socket.setBroadcast(true); } catch { /* platform dependent */ }
        try {
          socket.addMembership(UDP_DISCOVERY_MULTICAST_ADDRESS);
          socket.setMulticastTTL(1);
          socket.setMulticastLoopback(true);
        } catch (error) {
          // Directed broadcast remains available on networks that block or do
          // not expose multicast (some VPN and corporate adapter setups).
          console.warn('LAN multicast discovery is unavailable:', error);
        }
        resolve();
      });
    });
  }

  private async ensureSessionSocket(): Promise<void> {
    if (this.sessionSocket) return;
    const socket = dgram.createSocket('udp4');
    this.sessionSocket = socket;
    socket.on('message', (data, rinfo) => this.handleWire(data, rinfo));
    socket.on('error', (error) => this.emitError(`UDP 연결 오류: ${error.message}`));
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, '0.0.0.0', () => {
        socket.removeListener('error', reject);
        resolve();
      });
    });
  }

  private startDiscoveryClock(): void {
    if (this.discoveryTimer) return;
    this.discoveryTimer = setInterval(() => {
      this.expireRooms();
      this.broadcastProbe();
    }, 1_000);
  }

  private startAnnouncing(): void {
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.announceRoom();
    this.announceTimer = setInterval(() => this.announceRoom(), 1_000);
  }

  private announceRoom(target?: Target): void {
    const session = this.session;
    const socket = this.discoverySocket;
    const sessionSocket = this.sessionSocket;
    if (!socket || !sessionSocket || !session || session.role !== 'host') return;
    const address = sessionSocket.address();
    if (typeof address === 'string') return;
    const host = session.room.members.find((member) => member.isHost)!;
    const packet: AnnouncePacket = {
      v: UDP_PROTOCOL_VERSION,
      t: 'announce',
      sentAt: Date.now(),
      room: {
        roomId: session.room.roomId,
        name: session.room.name,
        hostName: host.name,
        hostLevel: host.level,
        playerCount: session.room.members.length,
        maxPlayers: UDP_MAX_PLAYERS,
        status: session.room.status,
        port: address.port,
      },
    };
    if (target) {
      this.sendWire(packet, target, socket);
      return;
    }
    this.sendDiscoveryPacket(packet, socket);
  }

  private broadcastProbe(): void {
    const socket = this.discoverySocket;
    if (!socket) return;
    const packet: ProbePacket = { v: UDP_PROTOCOL_VERSION, t: 'probe' };
    this.sendDiscoveryPacket(packet, socket);
  }

  private sendDiscoveryPacket(packet: AnnouncePacket | ProbePacket, socket: Socket): void {
    this.sendWire(packet, {
      address: UDP_DISCOVERY_MULTICAST_ADDRESS,
      port: UDP_DISCOVERY_PORT,
    }, socket);
    for (const address of getLanBroadcastAddresses()) {
      this.sendWire(packet, { address, port: UDP_DISCOVERY_PORT }, socket);
    }
    this.sendWire(packet, { address: '127.0.0.1', port: UDP_DISCOVERY_PORT }, socket);
  }

  private handleWire(data: Buffer, rinfo: RemoteInfo): void {
    if (data.byteLength > MAX_DATAGRAM_BYTES) return;
    let packet: WirePacket;
    try {
      packet = JSON.parse(data.toString('utf8')) as WirePacket;
    } catch {
      return;
    }
    if (!packet || packet.v !== UDP_PROTOCOL_VERSION || typeof packet.t !== 'string') return;
    try {
      if (packet.t === 'chunk') {
        this.handleChunk(packet, rinfo);
        return;
      }
      this.routePacket(packet, rinfo);
    } catch {
      // Untrusted or malformed LAN datagrams must never escape into the main loop.
    }
  }

  private routePacket(packet: Exclude<WirePacket, ChunkPacket>, rinfo: RemoteInfo): void {
    if (packet.t === 'probe') {
      // Reply through all discovery transports. In particular, a unicast reply
      // to 127.0.0.1 on a shared port may be delivered to only one local process.
      this.announceRoom();
      return;
    }
    if (packet.t === 'announce') {
      if (!isValidAnnouncedRoom(packet.room) || !isFiniteNumber(packet.sentAt)) return;
      const now = Date.now();
      const room: RoomSummary = {
        ...packet.room,
        address: rinfo.address.replace(/^::ffff:/, ''),
        ping: Math.max(0, Math.min(999, now - packet.sentAt)),
        updatedAt: now,
      };
      this.discoveredRooms.set(room.roomId, room);
      this.emitRooms();
      return;
    }
    if (packet.t === 'join-accept') {
      if (this.pendingJoinHandler?.onAccept(packet, rinfo)) this.pendingJoinHandler = null;
      return;
    }
    if (packet.t === 'join-reject') {
      if (this.pendingJoinHandler?.onReject(packet, rinfo)) this.pendingJoinHandler = null;
      return;
    }
    if (packet.t === 'join') {
      this.handleJoin(packet, rinfo);
      return;
    }
    if (packet.t === 'ack') {
      this.handleAck(packet, rinfo);
      return;
    }
    this.handleData(packet, rinfo);
  }

  private handleChunk(packet: ChunkPacket, rinfo: RemoteInfo): void {
    if (
      typeof packet.id !== 'string' ||
      packet.id.length < 1 ||
      packet.id.length > MAX_CHUNK_ID_LENGTH ||
      !Number.isInteger(packet.total) ||
      packet.total < 1 ||
      packet.total > MAX_CHUNK_COUNT ||
      !Number.isInteger(packet.index) ||
      packet.index < 0 ||
      packet.index >= packet.total
    ) return;
    if (typeof packet.data !== 'string' || packet.data.length > 1_100) return;
    const key = `${rinfo.address}:${rinfo.port}:${packet.id}`;
    let assembly = this.chunks.get(key);
    if (!assembly) {
      if (this.chunks.size >= MAX_CHUNK_ASSEMBLIES) return;
      assembly = { createdAt: Date.now(), pieces: new Array(packet.total), received: 0 };
      this.chunks.set(key, assembly);
    }
    if (assembly.pieces.length !== packet.total || assembly.pieces[packet.index] !== undefined) return;
    assembly.pieces[packet.index] = packet.data;
    assembly.received++;
    if (assembly.received !== packet.total) return;
    this.chunks.delete(key);
    try {
      if (assembly.pieces.some((piece) => typeof piece !== 'string')) return;
      const bytes = Buffer.from(assembly.pieces.join(''), 'base64');
      if (bytes.byteLength > MAX_REASSEMBLED_BYTES) return;
      const decoded = JSON.parse(bytes.toString('utf8')) as WirePacket;
      if (decoded.t !== 'chunk' && decoded.v === UDP_PROTOCOL_VERSION) this.routePacket(decoded, rinfo);
    } catch {
      // Malformed or incomplete payloads are intentionally ignored.
    }
  }

  private handleJoin(packet: JoinPacket, rinfo: RemoteInfo): void {
    const session = this.session;
    if (!session || session.role !== 'host' || packet.roomId !== session.room.roomId) return;
    const existing = [...session.peers.values()].find((peer) => peer.nonce === packet.nonce);
    if (existing) {
      this.sendJoinAccept(existing, packet.nonce);
      return;
    }
    const reject = (reason: string) => this.sendWire({
      v: UDP_PROTOCOL_VERSION,
      t: 'join-reject',
      nonce: packet.nonce,
      reason,
    }, rinfo);
    if (session.room.status !== 'waiting') return reject('이미 게임이 시작되었습니다.');
    if (session.room.members.length >= UDP_MAX_PLAYERS) return reject('방 정원이 가득 찼습니다.');
    if (!isValidNetworkProfile(packet.profile)) return reject('프로필 정보가 올바르지 않습니다.');

    const playerId = randomUUID();
    const peer: Peer = {
      playerId,
      token: token(),
      target: { address: rinfo.address, port: rinfo.port },
      profile: packet.profile,
      nonce: packet.nonce,
      lastSeenAt: Date.now(),
      lastInputAt: Date.now(),
      inputStopped: false,
      lastSequences: new Map(),
    };
    session.peers.set(playerId, peer);
    session.room.members.push(publicMember(playerId, packet.profile, false, session.room.members.length));
    this.sendJoinAccept(peer, packet.nonce);
    this.broadcastLobbyState();
    const state = this.getRoomState();
    if (state) this.emit({ type: 'room-state', room: state });
    this.announceRoom();
  }

  private sendJoinAccept(peer: Peer, nonce: string): void {
    const session = this.requireHost();
    this.sendWire({
      v: UDP_PROTOCOL_VERSION,
      t: 'join-accept',
      nonce,
      playerId: peer.playerId,
      token: peer.token,
      room: this.publicRoom(session.room),
    }, peer.target);
  }

  private handleAck(packet: AckPacket, rinfo: RemoteInfo): void {
    const pending = this.pendingReliable.get(packet.packetId);
    if (!pending || !sameTarget(pending.target, rinfo)) return;
    const session = this.session;
    if (!session || packet.roomId !== session.room.roomId || packet.sessionId !== session.room.sessionId) return;
    if (packet.token !== pending.packet.token) return;
    this.pendingReliable.delete(packet.packetId);
  }

  private handleData(packet: DataPacket, rinfo: RemoteInfo): void {
    const session = this.session;
    if (!session || packet.roomId !== session.room.roomId || packet.sessionId !== session.room.sessionId) return;
    if (session.role === 'host') {
      const peer = session.peers.get(packet.playerId);
      if (!peer || peer.token !== packet.token || !sameTarget(peer.target, rinfo)) return;
      peer.lastSeenAt = Date.now();
      const member = session.room.members.find((item) => item.playerId === peer.playerId);
      if (member?.connection === 'reconnecting') {
        member.connection = 'connected';
        this.broadcastLobbyState();
      }
      if (packet.reliable) this.sendAck(packet, peer.target, session.room.hostPlayerId);
      if (!this.acceptSequence(peer.lastSequences, packet.kind, packet.seq)) return;
      if (packet.kind === 'heartbeat') return;
      if (packet.kind === 'input') {
        peer.lastInputAt = Date.now();
        peer.inputStopped = false;
      }
      if (packet.kind === 'leave') {
        this.removePeer(peer.playerId, 'left');
        return;
      }
      if (packet.kind === 'member-presence') {
        const presence = (packet.payload as { presence?: unknown } | null)?.presence;
        if (
          member &&
          (presence === 'lobby' || presence === 'playing' || presence === 'results')
        ) {
          member.presence = presence;
          this.broadcastLobbyState();
        }
        return;
      }
      this.emitGameMessage(packet.kind, packet.payload, peer.playerId, packet.reliable, packet.seq);
      return;
    }

    if (packet.playerId !== session.room.hostPlayerId || packet.token !== session.token) return;
    if (!sameTarget(session.hostTarget, rinfo)) return;
    session.lastHostSeenAt = Date.now();
    session.disconnectEmitted = false;
    session.reconnectingEmitted = false;
    if (packet.reliable) this.sendAck(packet, session.hostTarget, session.localPlayerId);
    if (!this.acceptSequence(session.lastSequences, packet.kind, packet.seq)) return;
    if (packet.kind === 'heartbeat') return;
    if (packet.kind === 'lobby-state') {
      session.room = packet.payload as PublicRoomState;
      const state = this.getRoomState();
      if (state) this.emit({ type: 'room-state', room: state });
      return;
    }
    if (packet.kind === 'game-start') {
      const payload = packet.payload as { room: PublicRoomState; baselinePlayerId: string; startedAt: number };
      session.room = payload.room;
      const room = this.getRoomState();
      if (room) this.emit({ type: 'game-start', data: { ...payload, room } });
      return;
    }
    if (packet.kind === 'checkpoint') session.checkpointReceived = true;
    if (packet.kind === 'room-closed') {
      this.emit({ type: 'host-disconnected', checkpointReceived: session.checkpointReceived });
      return;
    }
    this.emitGameMessage(packet.kind, packet.payload, packet.playerId, packet.reliable, packet.seq);
  }

  private acceptSequence(sequences: Map<string, number>, kind: string, sequence: number): boolean {
    const previous = sequences.get(kind) ?? -1;
    if (!Number.isSafeInteger(sequence) || sequence <= previous) return false;
    sequences.set(kind, sequence);
    return true;
  }

  private sendAck(packet: DataPacket, target: Target, playerId: string): void {
    this.sendWire({
      v: UDP_PROTOCOL_VERSION,
      t: 'ack',
      roomId: packet.roomId,
      sessionId: packet.sessionId,
      playerId,
      token: packet.token,
      packetId: packet.packetId,
    }, target);
  }

  private sendClientData(kind: string, payload: unknown, reliable: boolean): void {
    const session = this.session;
    if (!session || session.role !== 'client') return;
    const packet = this.makeDataPacket(
      session.room.roomId,
      session.room.sessionId,
      session.localPlayerId,
      session.token,
      kind,
      payload,
      reliable,
    );
    this.sendData(packet, session.hostTarget);
  }

  private sendDataToPeer(peer: Peer, kind: string, payload: unknown, reliable: boolean): void {
    const session = this.requireHost();
    const packet = this.makeDataPacket(
      session.room.roomId,
      session.room.sessionId,
      session.room.hostPlayerId,
      peer.token,
      kind,
      payload,
      reliable,
    );
    this.sendData(packet, peer.target);
  }

  private broadcastHostData(kind: string, payload: unknown, reliable: boolean): void {
    const session = this.requireHost();
    for (const peer of session.peers.values()) this.sendDataToPeer(peer, kind, payload, reliable);
  }

  private makeDataPacket(
    roomId: string,
    sessionId: string,
    playerId: string,
    authToken: string,
    kind: string,
    payload: unknown,
    reliable: boolean,
  ): DataPacket {
    return {
      v: UDP_PROTOCOL_VERSION,
      t: 'data',
      roomId,
      sessionId,
      playerId,
      token: authToken,
      seq: ++this.outputSequence,
      packetId: randomUUID(),
      kind,
      payload,
      reliable,
    };
  }

  private sendData(packet: DataPacket, target: Target): void {
    this.sendWire(packet, target);
    if (packet.reliable) {
      this.pendingReliable.set(packet.packetId, {
        packet,
        target,
        attempts: 1,
        nextAttemptAt: Date.now() + RELIABLE_RETRY_MS,
      });
    }
  }

  private sendWire(packet: WirePacket, target: Target, socket = this.sessionSocket): void {
    if (!socket) return;
    let serialized: Buffer;
    try {
      const json = JSON.stringify(packet);
      if (typeof json !== 'string') return;
      serialized = Buffer.from(json, 'utf8');
    } catch (error) {
      console.warn('UDP packet serialization failed:', error);
      return;
    }
    if (serialized.byteLength <= MAX_DATAGRAM_BYTES) {
      socket.send(serialized, target.port, target.address, () => undefined);
      return;
    }
    const id = randomUUID();
    const encoded = serialized.toString('base64');
    const total = Math.ceil(encoded.length / CHUNK_DATA_BYTES);
    if (total > MAX_CHUNK_COUNT || serialized.byteLength > MAX_REASSEMBLED_BYTES) {
      const now = Date.now();
      if (now - this.lastOversizeLogAt >= 5_000) {
        this.lastOversizeLogAt = now;
        console.warn(`UDP packet dropped because it is too large (${serialized.byteLength} bytes).`);
      }
      return;
    }
    for (let index = 0; index < total; index++) {
      const chunk: ChunkPacket = {
        v: UDP_PROTOCOL_VERSION,
        t: 'chunk',
        id,
        index,
        total,
        data: encoded.slice(index * CHUNK_DATA_BYTES, (index + 1) * CHUNK_DATA_BYTES),
      };
      const bytes = Buffer.from(JSON.stringify(chunk), 'utf8');
      if (bytes.byteLength <= MAX_DATAGRAM_BYTES) socket.send(bytes, target.port, target.address, () => undefined);
    }
  }

  private broadcastLobbyState(): void {
    const session = this.session;
    if (!session || session.role !== 'host') return;
    this.broadcastHostData('lobby-state', this.publicRoom(session.room), true);
    const state = this.getRoomState();
    if (state) this.emit({ type: 'room-state', room: state });
    this.announceRoom();
  }

  private publicRoom(room: PublicRoomState): PublicRoomState {
    return { ...room, members: room.members.map((member) => ({ ...member })) };
  }

  private publicRoomStateForClient(): RoomState {
    const session = this.requireHost();
    return {
      ...this.publicRoom(session.room),
      localPlayerId: '',
      isHost: false,
    };
  }

  private profileFor(playerId: string): NetworkProfile | undefined {
    const session = this.session;
    if (!session) return undefined;
    if (session.role === 'client') return playerId === session.localPlayerId ? session.localProfile : undefined;
    if (playerId === session.room.hostPlayerId) return session.localProfile;
    return session.peers.get(playerId)?.profile;
  }

  private removePeer(playerId: string, reason: string): void {
    const session = this.session;
    if (!session || session.role !== 'host') return;
    const peer = session.peers.get(playerId);
    if (!peer) return;
    session.peers.delete(playerId);
    session.room.members = session.room.members.filter((member) => member.playerId !== playerId);
    this.emitGameMessage('member-left', { playerId, reason }, playerId, true, ++this.outputSequence);
    this.broadcastHostData('member-left', { playerId, reason }, true);
    this.broadcastLobbyState();
  }

  private maintain(): void {
    const now = Date.now();
    for (const [packetId, pending] of this.pendingReliable) {
      if (now < pending.nextAttemptAt) continue;
      if (pending.attempts >= RELIABLE_ATTEMPTS) {
        this.pendingReliable.delete(packetId);
        continue;
      }
      pending.attempts++;
      pending.nextAttemptAt = now + RELIABLE_RETRY_MS;
      this.sendWire(pending.packet, pending.target);
    }
    for (const [key, assembly] of this.chunks) {
      if (now - assembly.createdAt > 2_000) this.chunks.delete(key);
    }

    const session = this.session;
    if (!session) return;
    if (now - this.lastHeartbeatAt >= 1_000) {
      this.lastHeartbeatAt = now;
      if (session.role === 'client') this.sendClientData('heartbeat', {}, false);
      else this.broadcastHostData('heartbeat', {}, false);
    }
    if (session.role === 'host') {
      for (const peer of [...session.peers.values()]) {
        const silence = now - peer.lastSeenAt;
        const member = session.room.members.find((item) => item.playerId === peer.playerId);
        if (silence > DISCONNECT_MS) {
          this.removePeer(peer.playerId, 'timeout');
          continue;
        }
        if (silence > RECONNECTING_MS && member?.connection !== 'reconnecting') {
          member!.connection = 'reconnecting';
          this.broadcastLobbyState();
        }
        if (session.room.status === 'playing' && now - peer.lastInputAt > INPUT_TIMEOUT_MS && !peer.inputStopped) {
          peer.inputStopped = true;
          this.emitGameMessage('input', { mask: 0, timedOut: true }, peer.playerId, false, ++this.outputSequence);
        }
      }
    } else {
      const silence = now - session.lastHostSeenAt;
      if (silence > DISCONNECT_MS && !session.disconnectEmitted) {
        session.disconnectEmitted = true;
        this.emit({ type: 'host-disconnected', checkpointReceived: session.checkpointReceived });
      } else if (silence > RECONNECTING_MS && !session.disconnectEmitted && !session.reconnectingEmitted) {
        session.reconnectingEmitted = true;
        this.emitError('방장과 재연결 중입니다…');
      }
    }
  }

  private roomList(): RoomSummary[] {
    this.expireRooms();
    return [...this.discoveredRooms.values()]
      .sort((a, b) => a.status.localeCompare(b.status) || a.ping - b.ping)
      .map((room) => ({ ...room }));
  }

  private expireRooms(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, room] of this.discoveredRooms) {
      if (now - room.updatedAt > ROOM_EXPIRY_MS) {
        this.discoveredRooms.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitRooms();
  }

  private emitRooms(): void {
    this.emit({ type: 'rooms', rooms: this.roomListWithoutExpiry() });
  }

  private roomListWithoutExpiry(): RoomSummary[] {
    return [...this.discoveredRooms.values()]
      .sort((a, b) => a.status.localeCompare(b.status) || a.ping - b.ping)
      .map((room) => ({ ...room }));
  }

  private emitGameMessage(
    kind: string,
    payload: unknown,
    fromPlayerId: string,
    reliable: boolean,
    sequence: number,
  ): void {
    this.emit({
      type: 'game-message',
      message: { kind, payload, fromPlayerId, reliable, sequence, receivedAt: Date.now() },
    });
  }

  private emitError(message: string): void {
    this.emit({ type: 'error', message });
  }

  private requireHost(): HostSession {
    if (!this.session || this.session.role !== 'host') throw new Error('방장만 실행할 수 있습니다.');
    return this.session;
  }

  private closeSessionSocket(): void {
    if (!this.sessionSocket) return;
    this.sessionSocket.removeAllListeners();
    try { this.sessionSocket.close(); } catch { /* already closed */ }
    this.sessionSocket = null;
  }

  private closeDiscoverySocket(): void {
    if (!this.discoverySocket) return;
    this.discoverySocket.removeAllListeners();
    try { this.discoverySocket.close(); } catch { /* already closed */ }
    this.discoverySocket = null;
  }
}
