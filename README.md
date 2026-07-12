# 2-12 출석 시스템

GitHub Pages 기반 관리자 대시보드와 Google Apps Script 백엔드로 구성된 출석 관리 시스템입니다.

## 주요 경로

- `/login/` — Google 계정, 관리자 계정, 패스키 로그인
- `/dashboard/` — 오늘 출석 현황, ESP32/MQTT 상태, 모바일 알림
- `/choose-login-method/` — 최초 로그인 후 패스키 설정 선택
- `/setup-login-method/` — Face ID, Touch ID, Windows Hello 등 패스키 등록
- `/delete-passkey/` — 패스키 삭제 확인
- `/verify-admin/` — 삭제 전 Google/관리자 재인증
- `/home-icon-setting/` — PWA 설치 안내

## 세션 정책

브라우저에는 서버가 발급한 세션 토큰만 저장하며 관리자 비밀번호는 저장하지 않습니다. 세션은 최대 14일간 유지되고, 서버가 더 짧은 만료 시간을 반환하면 서버 값을 우선합니다. 로그아웃 또는 서버의 만료 응답 시 로컬 세션을 즉시 삭제합니다.

## 패스키 정책

- RP ID: `212attendence.github.io`
- 등록 및 로그인은 WebAuthn 플랫폼 인증기를 사용합니다.
- 생체 정보와 개인키는 기기 밖으로 전송되지 않습니다.
- 브라우저에는 credential ID와 등록 상태만 저장합니다.
- 서버 등록 삭제 후 운영체제나 비밀번호 관리자에 남은 패스키는 사용자가 직접 삭제해야 합니다.

## 화면 및 글꼴

화면 모드는 시스템, 라이트, 다크 중 선택할 수 있습니다. 글꼴 우선순위는 Google Sans → Pretendard → 운영체제 기본 한글 글꼴입니다. Google Sans가 기기에 설치되지 않은 경우 CDN의 Pretendard가 사용됩니다.

## 배포

GitHub Pages는 `main` 브랜치를 배포합니다. Apps Script 코드를 변경한 경우 GitHub 배포와 별도로 기존 웹 앱 배포를 새 버전으로 갱신해야 합니다.

## 보안 메모

- Firebase 웹 설정과 VAPID 공개키는 공개 클라이언트 식별자입니다.
- MQTT 비밀번호와 서비스 계정 개인키는 저장소에 커밋하지 않습니다.
- 관리자 계정의 초기 비밀번호는 운영 전 반드시 변경해야 합니다.
