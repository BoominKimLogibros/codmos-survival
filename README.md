# CODMOS SURVIVORS

Phaser 3 기반 생존 게임입니다. 게임 엔진, Spine 플러그인, 이미지, 오디오와 Spine 데이터는 모두 프로젝트 내부의 로컬 파일을 사용합니다.

웹에서는 기존 싱글플레이를 제공하고 Electron 앱에서는 같은 LAN에서 최대 20명이 참여하는 UDP 협동 플레이를 추가로 제공합니다.

- [웹에서 혼자 바로하기](https://boominkimlogibros.github.io/codmos-survival/)
- [Windows·macOS 최신 버전 다운로드](https://github.com/BoominKimLogibros/codmos-survival/releases/latest)

- 현재 버전: `1.1.2`
- 공식 사이트: [codmos.io](https://codmos.io)
- 저작권: Copyright © 2026 Logibrothers. All rights reserved.

## 저장소 복제 후 바로 실행

Node.js 22.12 이상과 npm이 필요합니다.

```bash
git clone https://github.com/BoominKimLogibros/codmos-survival.git
cd codmos-survival
npm install
npm run dev:electron
```

`npm run dev:electron`을 실행하면 Vite 개발 서버와 Electron 앱이 함께 시작됩니다. LAN UDP 협동 플레이를 시험하려면 같은 네트워크의 각 컴퓨터에서 위 명령으로 앱을 실행합니다.

## 프로필과 저장

- 최초 실행 시 `프로필 1`이 브라우저 로컬스토리지에 자동 생성됩니다.
- 선택한 프로필로 플레이하면 상태 변경을 감지해 계속 자동 저장합니다.
- 메뉴에서 프로필 이름과 Int 스킨을 변경하고 `.codmos` 파일로 다운로드할 수 있습니다.
- `+ 프로필 불러오기`에서 기존 `.codmos` 파일을 선택하면 별도의 새 프로필로 추가됩니다.
- 게임 안의 `나가기` 버튼은 플레이를 멈추고 확인 후 메뉴로 돌아갑니다.

## 웹 개발 실행

```bash
npm install
npm run dev
```

터미널에 표시된 로컬 주소를 브라우저에서 열면 됩니다.

## Electron LAN 협동 플레이

```bash
npm run dev:electron
```

1. 각 컴퓨터에서 Electron 앱을 실행하고 메뉴에서 프로필을 선택합니다.
2. `같이하기`를 눌러 방 목록으로 이동합니다.
3. 한 명이 방을 만들면 방장은 혼자서도 즉시 게임을 시작할 수 있습니다.
4. 나머지 사용자는 시작 전 로비 또는 진행 중인 게임에 바로 참여할 수 있습니다. 최대 인원은 20명입니다.

방 검색은 UDP `41777` 포트를 사용하고 실제 세션은 운영체제가 할당한 UDP 포트를 사용합니다. OS 방화벽이 연결을 묻는 경우 같은 사설 네트워크에서의 수신을 허용해야 합니다. 웹 브라우저에서는 UDP 버튼이 비활성화되며 저장과 싱글플레이 기능은 그대로 유지됩니다.

방장이 월드, 몬스터, 공격, 드롭, 경험치와 룬을 계산합니다. 참여자는 방향 입력과 선택 명령만 보냅니다. 위치 스냅샷은 10Hz, 전체 keyframe은 2초마다 전송되며, 프로필별 체크포인트는 5초마다 해당 소유자에게만 저장됩니다.

## 프로덕션 빌드

```bash
npm run build
npm run preview
```

빌드 결과는 `dist/`에 생성됩니다. 브라우저 보안 정책 때문에 `dist/index.html`을 `file://`로 직접 열지 말고 `npm run preview` 또는 정적 웹 서버를 사용해야 합니다.

Electron 배포 파일은 다음 명령으로 만듭니다.

```bash
npm run package:mac  # DMG + ZIP
npm run package:win  # NSIS (Windows 환경에서 실행)
```

결과는 `release/`에 생성됩니다. macOS 서명/공증 인증서는 프로젝트에 포함하지 않으므로 공식 배포 시 별도로 설정해야 합니다.

## 검증

```bash
npm run typecheck
npm run typecheck:electron
npm run test:player-success
npm run test:udp
npm run smoke:electron
```

`test:udp`는 혼자 시작, 최대 20인 정원, 최고 레벨 기준 진행도, 진행 중 참여, 방향 입력, 잘못된 토큰 폐기, 패킷 유실 재전송, 1,200바이트 초과 메시지 분할/재조립, 중복·역순 폐기와 이탈을 실제 로컬 UDP 소켓으로 검사합니다. `smoke:electron`은 숨김 Electron 창에서 context-isolated preload 브리지와 게임 캔버스, 활성화된 UDP 메뉴 버튼을 검사합니다.

## 타입 검사

```bash
npm run typecheck
```

전체 애플리케이션은 TypeScript strict 모드로 검사됩니다. Phaser/Spine 런타임도 프로젝트의 최소 인터페이스로 타입이 선언되어 있어 게임 코드에 암시적 `any`를 사용하지 않습니다.

## 저작권 및 사용 범위

이 저장소의 CODMOS SURVIVORS 소스 코드와 프로젝트 고유 자산에 대한 저작권은 Logibrothers에 있습니다. 저장소 접근 권한은 승인된 개발·검토 목적의 사용만 허용하며, 별도 서면 허가 없는 재배포·상업적 이용·2차 라이선스 부여를 허용하지 않습니다. 자세한 회사 및 서비스 정보는 [codmos.io](https://codmos.io)에서 확인할 수 있습니다.

자세한 권리 고지는 [`LICENSE`](./LICENSE)를 확인하세요. 제3자 라이브러리와 자산은 각각의 원 저작권 및 라이선스 조건을 따릅니다.

## 구조

```text
src/
  config/                 게임 상수, 스킨, 로컬 에셋, 기본 저장 상태
  game/
    PlayerController.ts   플레이어 입력·이동·스탯·Spine 표현
    WeaponSystem.ts       무기 정의·쿨다운·공격·투사체
    EnemySystem.ts        생성·진화·AI·피격·드롭·보스 진행
    GameHud.ts            상단 HUD·무기 슬롯·토스트·나가기 모달
    AudioManager.ts       BGM/SFX 생성 및 생명주기
    types.ts              게임 도메인 타입의 단일 진실 공급원
    levelUp.ts            싱글/멀티 공용 레벨업 선택 생성·적용
  network/
    UdpClient.ts          renderer의 preload 브리지 어댑터
    NetworkInputSource.ts 방향 비트마스크와 5Hz 보정 전송
    HostSnapshotPublisher.ts 관심 영역 delta/keyframe 생성
    ClientWorldRenderer.ts 100ms 보간과 로컬 이동 예측
    HostRuneCoordinator.ts 방장 권위 룬 충전·명령·효과 판정
    gameProtocol.ts       게임 스냅샷과 명령 타입
    types.ts              방/멤버/preload API 공유 타입
  objects/                월드맵, 적 팩토리, 적 HP 바
  scenes/
    GameScene.ts          시스템 생성과 씬 흐름만 조정하는 coordinator
    MenuScene.ts          프로필 선택·가져오기·다운로드·스킨 UI
    BootScene.ts          에셋 로딩과 절차적 텍스처 생성
    LevelUpScene.ts       레벨업 선택 UI
    GameOverScene.ts      결과 및 재시작 UI
    RoomListScene.ts      LAN 방 검색·생성·참여
    RoomLobbyScene.ts     최대 20인 대기실과 방장 시작
    MultiplayerGameScene.ts 방장 시뮬레이션/클라이언트 복제 조정
  services/
    profileService.ts     다중 프로필과 localStorage 영속화
    saveService.ts        저장 파일 서명·해시 검증·정규화
  ui/theme.ts             공통 UI 컴포넌트와 디자인 토큰
  styles/                 전체 화면 및 DOM 모달 스타일
  types/global.d.ts       로컬 Phaser Spine 플러그인 경계 타입
  bootstrap.ts            로컬 Phaser/Spine 런타임 로더
  main.ts                 게임 초기화
public/
  assets/       이미지, 오디오, Spine 로컬 에셋
  vendor/       Phaser와 Spine 플러그인
assets/         Vite가 직접 번들링하는 타일맵 원본
electron/
  main.ts                 BrowserWindow와 IPC 경계
  preload.ts              contextIsolation preload API
  udp/UdpService.ts       dgram 검색·세션·ACK·분할·timeout
```

`GameScene`은 각 시스템을 생성하고 연결하며 씬 전환과 저장 시점만 조정합니다. 플레이어 또는 전투 규칙을 수정할 때는 `GameScene`에 동작을 추가하지 않고 해당 `game/` 모듈에서 변경하는 것이 기본 원칙입니다.
