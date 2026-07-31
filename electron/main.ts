import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { UdpService } from './udp/UdpService';
import type {
  CreateRoomRequest,
  JoinRoomRequest,
  MemberPresence,
  ReturnToLobbyRequest,
  SendGameMessageRequest,
} from '../src/network/types';

let mainWindow: BrowserWindow | null = null;
let udpService: UdpService | null = null;
let rendererRecoveryInProgress = false;
let rendererUnresponsive = false;
let unresponsiveTimer: NodeJS.Timeout | null = null;
const rendererRecoveryAttempts: number[] = [];

app.setName('CODMOS SURVIVORS');

async function loadApp(window: BrowserWindow): Promise<void> {
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) await window.loadURL(developmentUrl);
  else await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

async function recoverRenderer(reason: string): Promise<void> {
  const window = mainWindow;
  if (!window || window.isDestroyed() || rendererRecoveryInProgress) return;
  const now = Date.now();
  while (rendererRecoveryAttempts.length && now - rendererRecoveryAttempts[0] > 60_000) {
    rendererRecoveryAttempts.shift();
  }
  if (rendererRecoveryAttempts.length >= 3) {
    const result = await dialog.showMessageBox(window, {
      type: 'error',
      title: 'CODMOS SURVIVORS 복구 필요',
      message: '게임 화면 복구가 반복해서 실패했습니다.',
      detail: '프로필은 자동 저장되어 있습니다. 앱을 다시 시작하면 저장된 지점에서 계속할 수 있습니다.',
      buttons: ['앱 다시 시작', '닫기'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      app.relaunch();
      app.exit(0);
    }
    return;
  }
  rendererRecoveryAttempts.push(now);
  rendererRecoveryInProgress = true;
  console.error(`Recovering renderer after ${reason}.`);
  try {
    await udpService?.leaveRoom(`renderer-${reason}`);
  } catch (error) {
    console.warn('Failed to close the UDP room during renderer recovery:', error);
  }
  try {
    if (!window.isDestroyed()) await loadApp(window);
  } catch (error) {
    console.error('Renderer recovery load failed:', error);
  } finally {
    rendererRecoveryInProgress = false;
  }
}

function createWindow(): void {
  const isSmokeTest = process.env.CODEMOS_ELECTRON_SMOKE === '1';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 540,
    backgroundColor: '#0b0d12',
    show: !isSmokeTest,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  udpService = new UdpService((event) => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send('udp:event', event);
  });

  void loadApp(mainWindow).catch((error) => {
    console.error('Initial renderer load failed:', error);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process ended:', details);
    if (details.reason !== 'clean-exit') void recoverRenderer(`process-${details.reason}`);
  });
  mainWindow.on('unresponsive', () => {
    rendererUnresponsive = true;
    if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null;
      if (rendererUnresponsive) void recoverRenderer('unresponsive');
    }, 8_000);
  });
  mainWindow.on('responsive', () => {
    rendererUnresponsive = false;
    if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
    unresponsiveTimer = null;
  });

  if (isSmokeTest) {
    mainWindow.webContents.once('did-finish-load', () => {
      void mainWindow?.webContents.executeJavaScript(`new Promise((resolve) => {
        const startedAt = Date.now();
        const check = () => {
          const startupError = document.querySelector('#startup-error')?.textContent || null;
          const canvasCreated = Boolean(document.querySelector('canvas'));
          const menu = window.game?.scene?.scenes?.find((scene) => scene.scene?.key === 'MenuScene');
          const menuReady = Boolean(menu?.udpButton);
          if (startupError || menuReady || Date.now() - startedAt >= 8000) {
            resolve({
              bridgeAvailable: window.codmosUdp?.available === true,
              canvasCreated,
              menuReady,
              udpButtonEnabled: menu?.udpButton?.uiEnabled === true,
              startupError
            });
            return;
          }
          setTimeout(check, 100);
        };
        check();
      })`).then(async (result) => {
        if (!result.bridgeAvailable || !result.canvasCreated || !result.menuReady || !result.udpButtonEnabled) {
          console.log(`ELECTRON_SMOKE_RESULT=${JSON.stringify(result)}`);
          app.exit(1);
          return;
        }
        const gameplayResult = await mainWindow?.webContents.executeJavaScript(`new Promise((resolve) => {
          const store = JSON.parse(localStorage.getItem('codmos-survival-profiles-v1') || 'null');
          const profile = store?.profiles?.[0];
          if (!profile) {
            resolve({ active: false, error: 'missing-profile' });
            return;
          }
          const hostProfile = {
            profileId: profile.id,
            name: profile.name,
            skin: profile.skin,
            state: structuredClone(profile.state)
          };
          const guestProfile = structuredClone(hostProfile);
          guestProfile.profileId = 'electron-smoke-guest';
          guestProfile.name = 'Smoke Guest';
          guestProfile.state.stats.level = Math.max(2, guestProfile.state.stats.level);
          const members = [
            {
              playerId: 'electron-smoke-host', name: hostProfile.name, skin: hostProfile.skin,
              level: hostProfile.state.stats.level, hp: hostProfile.state.stats.hp,
              maxHp: hostProfile.state.stats.maxHp, alive: true, connection: 'connected',
              presence: 'playing', isHost: true, joinOrder: 0
            },
            {
              playerId: 'electron-smoke-guest', name: guestProfile.name, skin: guestProfile.skin,
              level: guestProfile.state.stats.level, hp: guestProfile.state.stats.hp,
              maxHp: guestProfile.state.stats.maxHp, alive: true, connection: 'connected',
              presence: 'playing', isHost: false, joinOrder: 1
            }
          ];
          window.game.scene.start('MultiplayerGameScene', {
            profileId: profile.id,
            start: {
              baselinePlayerId: 'electron-smoke-guest',
              startedAt: Date.now(),
              room: {
                roomId: 'electron-smoke-room', sessionId: 'electron-smoke-session',
                name: 'Electron Smoke Room', status: 'playing',
                hostPlayerId: 'electron-smoke-host', localPlayerId: 'electron-smoke-host',
                isHost: true, members,
                privateProfiles: {
                  'electron-smoke-host': hostProfile,
                  'electron-smoke-guest': guestProfile
                }
              }
            }
          });
          setTimeout(() => {
            const scene = window.game.scene.scenes.find(
              (candidate) => candidate.scene?.key === 'MultiplayerGameScene'
            );
            resolve({
              active: scene?.scene?.isActive?.() === true,
              playerCount: scene?.hostPlayers?.size || 0,
              enemySystemReady: Boolean(scene?.enemySystem),
              publisherReady: Boolean(scene?.publisher),
              elapsed: scene?.progress?.gameTime - guestProfile.state.gameTime
            });
          }, 1400);
        })`);
        mainWindow?.setSize(920, 620);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const resizeResult = await mainWindow?.webContents.executeJavaScript(`(() => {
          const scene = window.game.scene.scenes.find(
            (candidate) => candidate.scene?.key === 'MultiplayerGameScene'
          );
          const width = scene?.scale?.gameSize?.width || 0;
          const height = scene?.scale?.gameSize?.height || 0;
          const exitX = scene?.exitButton?.x;
          const exitY = scene?.exitButton?.y;
          return {
            width,
            height,
            exitX,
            exitY,
            anchoredX: Math.abs(exitX - (width - 70)) < 0.01,
            anchoredY: Math.abs(exitY - (height - 35)) < 0.01
          };
        })()`);
        const combined = { ...result, gameplay: gameplayResult, resize: resizeResult };
        console.log(`ELECTRON_SMOKE_RESULT=${JSON.stringify(combined)}`);
        app.exit(
          gameplayResult?.active
            && gameplayResult?.playerCount === 2
            && gameplayResult?.enemySystemReady
            && gameplayResult?.publisherReady
            && resizeResult?.anchoredX
            && resizeResult?.anchoredY
            && !result.startupError
            ? 0 : 1,
        );
      }).catch((error) => {
        console.error('ELECTRON_SMOKE_ERROR', error);
        app.exit(1);
      });
    });
  }

  mainWindow.on('closed', () => {
    rendererUnresponsive = false;
    if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
    unresponsiveTimer = null;
    udpService?.dispose();
    udpService = null;
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle('udp:start-discovery', () => udpService?.startDiscovery() ?? []);
  ipcMain.handle('udp:refresh-rooms', () => udpService?.refreshRooms() ?? []);
  ipcMain.handle('udp:stop-discovery', () => udpService?.stopDiscovery());
  ipcMain.handle('udp:create-room', (_event, request: CreateRoomRequest) => udpService?.createRoom(request));
  ipcMain.handle('udp:join-room', (_event, request: JoinRoomRequest) => udpService?.joinRoom(request));
  ipcMain.handle('udp:leave-room', (_event, reason?: string) => udpService?.leaveRoom(reason));
  ipcMain.handle('udp:start-game', () => udpService?.startGame());
  ipcMain.handle('udp:return-to-lobby', (_event, request: ReturnToLobbyRequest) => (
    udpService?.returnToLobby(request)
  ));
  ipcMain.handle('udp:set-member-presence', (_event, presence: MemberPresence) => (
    udpService?.setMemberPresence(presence)
  ));
  ipcMain.handle('udp:get-room-state', () => udpService?.getRoomState() ?? null);
  ipcMain.on('udp:input', (_event, mask: number) => udpService?.sendInput(mask));
  ipcMain.on('udp:game-message', (_event, request: SendGameMessageRequest) => {
    udpService?.sendGameMessage(request);
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('child-process-gone', (_event, details) => {
  console.error('Electron child process ended:', details);
});

app.on('window-all-closed', () => {
  udpService?.dispose();
  if (process.platform !== 'darwin') app.quit();
});
