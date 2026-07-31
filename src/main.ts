import './styles/main.css';
import { GAME_HEIGHT, GAME_WIDTH } from './config/constants';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { LevelUpScene } from './scenes/LevelUpScene';
import { MenuScene } from './scenes/MenuScene';
import { MultiplayerGameScene } from './scenes/MultiplayerGameScene';
import { RoomListScene } from './scenes/RoomListScene';
import { RoomLobbyScene } from './scenes/RoomLobbyScene';

if (document.fonts) {
  await Promise.all([
    document.fonts.load('400 16px Nunito'),
    document.fonts.load('600 16px Nunito'),
    document.fonts.load('800 16px Nunito'),
  ]);
}

const gameContainer = document.getElementById('game-container');
if (!gameContainer) throw new Error('Missing #game-container element');

function showStartupError(message: string): void {
  const error = document.createElement('div');
  error.id = 'startup-error';
  error.textContent = message;
  document.body.appendChild(error);
}

function showRuntimeRecovery(message: string, reason: 'runtime' | 'webgl'): void {
  let notice = document.getElementById('runtime-recovery');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'runtime-recovery';
    Object.assign(notice.style, {
      position: 'fixed',
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      zIndex: '100000',
      maxWidth: 'min(520px, calc(100vw - 32px))',
      padding: '14px 16px',
      border: '1px solid #6c5ce7',
      borderRadius: '14px',
      background: '#111318',
      color: '#ffffff',
      fontFamily: 'Nunito, sans-serif',
      textAlign: 'center',
      boxShadow: '0 8px 28px rgba(0,0,0,.45)',
    });
    const label = document.createElement('div');
    label.dataset.role = 'message';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '화면 다시 불러오기';
    Object.assign(button.style, {
      marginTop: '10px',
      padding: '8px 14px',
      border: '0',
      borderRadius: '9px',
      background: '#6c5ce7',
      color: '#ffffff',
      fontFamily: 'Nunito, sans-serif',
      fontWeight: '800',
      cursor: 'pointer',
    });
    button.addEventListener('click', () => {
      button.disabled = true;
      const leave = window.codmosUdp?.available
        ? window.codmosUdp.leaveRoom('renderer-reload').catch(() => undefined)
        : Promise.resolve();
      void leave.finally(() => window.location.reload());
    });
    notice.append(label, button);
    document.body.appendChild(notice);
  }
  notice.dataset.reason = reason;
  const label = notice.querySelector<HTMLElement>('[data-role="message"]');
  if (label) label.textContent = message;
}

window.addEventListener('error', (event) => {
  if (!event.error) return;
  console.error('Unhandled renderer error:', event.error);
  showRuntimeRecovery('게임 처리 중 오류가 발생했습니다. 자동 저장된 상태로 화면을 다시 불러올 수 있습니다.', 'runtime');
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled renderer promise rejection:', event.reason);
  showRuntimeRecovery('게임 통신 또는 처리 중 오류가 발생했습니다. 화면을 다시 불러와 복구할 수 있습니다.', 'runtime');
});

if (!window.Phaser || !window.SpinePlugin) {
  showStartupError('게임 엔진의 로컬 파일을 불러오지 못했습니다.\n배포 파일 전체를 다시 확인해 주세요.');
  throw new Error('Local Phaser or SpinePlugin vendor file is missing');
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: gameContainer.clientWidth || window.innerWidth || GAME_WIDTH,
  height: gameContainer.clientHeight || window.innerHeight || GAME_HEIGHT,
  parent: 'game-container',
  backgroundColor: '#0b0d12',
  antialiasGL: true,
  physics: { default: 'arcade', arcade: { debug: false } },
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
  scene: [
    BootScene,
    MenuScene,
    GameScene,
    LevelUpScene,
    RoomListScene,
    RoomLobbyScene,
    MultiplayerGameScene,
  ],
  plugins: {
    scene: [
      { key: 'SpinePlugin', plugin: window.SpinePlugin, mapping: 'spine' },
    ],
  },
};

window.game = new Phaser.Game(config);
window.game.canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  showRuntimeRecovery('그래픽 장치 연결이 끊어졌습니다. 자동 복구를 기다리거나 화면을 다시 불러와 주세요.', 'webgl');
});
window.game.canvas.addEventListener('webglcontextrestored', () => {
  const notice = document.getElementById('runtime-recovery');
  if (notice?.dataset.reason === 'webgl') notice.remove();
});
