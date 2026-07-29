import type { GameSaveState } from '../game/types';

export const UDP_DISCOVERY_PORT = 41777;
// Administratively scoped IPv4 multicast. TTL 1 keeps discovery inside the LAN,
// while multicast loopback lets two Electron processes discover each other on
// the same computer (unicast packets on a shared UDP port are not fanned out).
export const UDP_DISCOVERY_MULTICAST_ADDRESS = '239.255.42.99';
export const UDP_PROTOCOL_VERSION = 4;
export const UDP_MAX_PLAYERS = 4;
export const UDP_MIN_PLAYERS = 2;

export type RoomStatus = 'waiting' | 'playing';
export type MemberConnection = 'connected' | 'reconnecting' | 'left';
export type MemberPresence = 'lobby' | 'playing' | 'results';

export interface NetworkProfile {
  profileId: string;
  name: string;
  skin: string;
  state: GameSaveState;
}

export interface RoomMember {
  playerId: string;
  name: string;
  skin: string;
  level: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  connection: MemberConnection;
  presence: MemberPresence;
  isHost: boolean;
  joinOrder: number;
}

export interface RoomSummary {
  roomId: string;
  name: string;
  hostName: string;
  hostLevel: number;
  playerCount: number;
  maxPlayers: number;
  status: RoomStatus;
  address: string;
  port: number;
  ping: number;
  updatedAt: number;
}

export interface RoomState {
  roomId: string;
  sessionId: string;
  name: string;
  status: RoomStatus;
  hostPlayerId: string;
  localPlayerId: string;
  isHost: boolean;
  members: RoomMember[];
  privateProfiles?: Record<string, NetworkProfile>;
}

export interface GameStartPayload {
  room: RoomState;
  baselinePlayerId: string;
  startedAt: number;
}

export interface UdpGameMessage {
  kind: string;
  payload: unknown;
  fromPlayerId: string;
  receivedAt: number;
  sequence: number;
  reliable: boolean;
}

export type UdpBridgeEvent =
  | { type: 'rooms'; rooms: RoomSummary[] }
  | { type: 'room-state'; room: RoomState }
  | { type: 'game-start'; data: GameStartPayload }
  | { type: 'game-message'; message: UdpGameMessage }
  | { type: 'host-disconnected'; checkpointReceived: boolean }
  | { type: 'error'; message: string };

export interface CreateRoomRequest {
  name: string;
  profile: NetworkProfile;
}

export interface JoinRoomRequest {
  room: RoomSummary;
  profile: NetworkProfile;
}

export interface SendGameMessageRequest {
  kind: string;
  payload: unknown;
  reliable?: boolean;
  targetPlayerId?: string;
}

export interface ReturnToLobbyRequest {
  playerStates: Record<string, GameSaveState>;
}

export function isRoomMemberReady(member: RoomMember): boolean {
  return member.connection === 'connected' && member.presence === 'lobby';
}

export interface CodmosUdpApi {
  readonly available: true;
  startDiscovery(): Promise<RoomSummary[]>;
  refreshRooms(): Promise<RoomSummary[]>;
  stopDiscovery(): Promise<void>;
  createRoom(request: CreateRoomRequest): Promise<RoomState>;
  joinRoom(request: JoinRoomRequest): Promise<RoomState>;
  leaveRoom(reason?: string): Promise<void>;
  startGame(): Promise<GameStartPayload>;
  returnToLobby(request: ReturnToLobbyRequest): Promise<RoomState>;
  setMemberPresence(presence: MemberPresence): Promise<RoomState>;
  sendInput(mask: number): void;
  sendGameMessage(request: SendGameMessageRequest): void;
  getRoomState(): Promise<RoomState | null>;
  onEvent(listener: (event: UdpBridgeEvent) => void): () => void;
}
