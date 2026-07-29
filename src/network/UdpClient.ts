import type { Profile } from '../game/types';
import type {
  GameStartPayload,
  MemberPresence,
  NetworkProfile,
  ReturnToLobbyRequest,
  RoomState,
  RoomSummary,
  SendGameMessageRequest,
  UdpBridgeEvent,
} from './types';

type Listener = (event: UdpBridgeEvent) => void;

class UdpClient {
  private listeners = new Set<Listener>();
  private removeBridgeListener: (() => void) | null = null;
  private room: RoomState | null = null;
  private rooms: RoomSummary[] = [];
  private pendingGameStart: GameStartPayload | null = null;

  get available(): boolean {
    return window.codmosUdp?.available === true;
  }

  get currentRoom(): RoomState | null {
    return this.room;
  }

  get discoveredRooms(): RoomSummary[] {
    return this.rooms;
  }

  initialize(): void {
    if (!this.available || this.removeBridgeListener) return;
    this.removeBridgeListener = window.codmosUdp!.onEvent((event) => {
      if (event.type === 'rooms') this.rooms = event.rooms;
      if (event.type === 'room-state') this.room = event.room;
      if (event.type === 'game-start') {
        this.room = event.data.room;
        this.pendingGameStart = event.data;
      }
      if (event.type === 'host-disconnected') {
        this.room = null;
        this.pendingGameStart = null;
      }
      this.listeners.forEach((listener) => listener(event));
    });
  }

  subscribe(listener: Listener): () => void {
    this.initialize();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async startDiscovery(): Promise<RoomSummary[]> {
    this.assertAvailable();
    this.rooms = await window.codmosUdp!.startDiscovery();
    return this.rooms;
  }

  async refreshRooms(): Promise<RoomSummary[]> {
    this.assertAvailable();
    this.rooms = await window.codmosUdp!.refreshRooms();
    return this.rooms;
  }

  async stopDiscovery(): Promise<void> {
    if (this.available) await window.codmosUdp!.stopDiscovery();
  }

  async createRoom(name: string, profile: Profile): Promise<RoomState> {
    this.assertAvailable();
    this.pendingGameStart = null;
    this.room = await window.codmosUdp!.createRoom({ name, profile: this.toNetworkProfile(profile) });
    return this.room;
  }

  async joinRoom(room: RoomSummary, profile: Profile): Promise<RoomState> {
    this.assertAvailable();
    this.pendingGameStart = null;
    this.room = await window.codmosUdp!.joinRoom({ room, profile: this.toNetworkProfile(profile) });
    return this.room;
  }

  async leaveRoom(reason = 'left'): Promise<void> {
    if (this.available) await window.codmosUdp!.leaveRoom(reason);
    this.room = null;
    this.pendingGameStart = null;
  }

  async startGame(): Promise<GameStartPayload> {
    this.assertAvailable();
    const start = await window.codmosUdp!.startGame();
    this.room = start.room;
    this.pendingGameStart = start;
    return start;
  }

  async returnToLobby(request: ReturnToLobbyRequest): Promise<RoomState> {
    this.assertAvailable();
    const room = await window.codmosUdp!.returnToLobby(request);
    this.room = room;
    this.pendingGameStart = null;
    return room;
  }

  async setMemberPresence(presence: MemberPresence): Promise<RoomState> {
    this.assertAvailable();
    const room = await window.codmosUdp!.setMemberPresence(presence);
    this.room = room;
    return room;
  }

  consumePendingGameStart(): GameStartPayload | null {
    const start = this.pendingGameStart;
    this.pendingGameStart = null;
    return start;
  }

  sendInput(mask: number): void {
    if (this.available) window.codmosUdp!.sendInput(mask);
  }

  send(kind: string, payload: unknown, options: Omit<SendGameMessageRequest, 'kind' | 'payload'> = {}): void {
    if (this.available) window.codmosUdp!.sendGameMessage({ kind, payload, ...options });
  }

  private toNetworkProfile(profile: Profile): NetworkProfile {
    return {
      profileId: profile.id,
      name: profile.name,
      skin: profile.skin,
      state: structuredClone(profile.state),
    };
  }

  private assertAvailable(): void {
    this.initialize();
    if (!this.available) throw new Error('UDP 플레이는 Electron 앱에서만 사용할 수 있습니다.');
  }
}

export const udpClient = new UdpClient();
