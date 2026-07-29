import { contextBridge, ipcRenderer } from 'electron';
import type {
  CodmosUdpApi,
  CreateRoomRequest,
  JoinRoomRequest,
  MemberPresence,
  ReturnToLobbyRequest,
  SendGameMessageRequest,
  UdpBridgeEvent,
} from '../src/network/types';

const api: CodmosUdpApi = {
  available: true,
  startDiscovery: () => ipcRenderer.invoke('udp:start-discovery'),
  refreshRooms: () => ipcRenderer.invoke('udp:refresh-rooms'),
  stopDiscovery: () => ipcRenderer.invoke('udp:stop-discovery'),
  createRoom: (request: CreateRoomRequest) => ipcRenderer.invoke('udp:create-room', request),
  joinRoom: (request: JoinRoomRequest) => ipcRenderer.invoke('udp:join-room', request),
  leaveRoom: (reason?: string) => ipcRenderer.invoke('udp:leave-room', reason),
  startGame: () => ipcRenderer.invoke('udp:start-game'),
  returnToLobby: (request: ReturnToLobbyRequest) => ipcRenderer.invoke('udp:return-to-lobby', request),
  setMemberPresence: (presence: MemberPresence) => ipcRenderer.invoke('udp:set-member-presence', presence),
  sendInput: (mask: number) => ipcRenderer.send('udp:input', mask),
  sendGameMessage: (request: SendGameMessageRequest) => ipcRenderer.send('udp:game-message', request),
  getRoomState: () => ipcRenderer.invoke('udp:get-room-state'),
  onEvent: (listener: (event: UdpBridgeEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: UdpBridgeEvent) => listener(payload);
    ipcRenderer.on('udp:event', handler);
    return () => ipcRenderer.removeListener('udp:event', handler);
  },
};

contextBridge.exposeInMainWorld('codmosUdp', Object.freeze(api));
