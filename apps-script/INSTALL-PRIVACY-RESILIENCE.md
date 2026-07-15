# 개인정보 권한·백업 알림 Apps Script 설치

## 1. 파일 추가

Apps Script 프로젝트에 새 스크립트 파일을 만들고 아래 GitHub 파일 전체를 붙여넣습니다.

- `apps-script/student-privacy-resilience-addon.gs`

기존 `apps-script/student-auth-addon.gs`도 함께 있어야 합니다.

## 2. doGet(e) 연결

기존 `Code.gs`의 `doGet(e)`에서 `action` 값을 읽은 직후 아래 코드를 추가합니다.

```javascript
var privacyResponse = handleStudentPrivacyAction_(action, e);
if (privacyResponse) return privacyResponse;

var studentResponse = handleStudentAuthAction_(action, e);
if (studentResponse) return studentResponse;
```

이미 `handleStudentAuthAction_` 연결 코드가 있다면 그 위에 개인정보 확장 두 줄만 추가합니다.

## 3. setup() 연결

기존 `setup()` 함수 마지막에 아래 두 줄을 추가합니다.

```javascript
setupStudentAuth_();
setupStudentPrivacyResilience_();
```

## 4. setup() 1회 실행

Apps Script 편집기에서 `setup()`을 직접 한 번 실행합니다. 다음 시트가 자동 생성됩니다.

- `학생개인정보권한`
- `학생개인정보동의로그`
- `시스템오류알림`

## 5. 새 버전으로 배포

`배포 > 배포 관리 > 수정 > 새 버전 > 배포` 순서로 웹 앱을 새 버전으로 배포합니다.

웹 앱 실행 사용자는 본인, 액세스 권한은 기존 출석 시스템과 동일하게 유지합니다.

## 6. 기능 확인

1. 학생 로그인 승인
2. `/ios-or-android/`에서 기기 선택
3. `/student/onboarding/`에서 위치 권한 허용
4. 필수·선택 개인정보 동의 저장
5. 스프레드시트 `학생개인정보권한` 행 생성 확인
6. 관리자 `/admin/privacy-permissions/`에서 계정별 권한 확인
7. `/accounts-s/`에서 관리자 지정 비밀번호 설정
8. `/student/recovery/` 진입 후 `시스템오류알림`과 관리자 이메일 확인

## 신규 action

- `studentSavePrivacyConsentJsonp`
- `studentPrivacyStatusJsonp`
- `studentWithdrawPrivacyConsentJsonp`
- `adminPrivacyPermissionsJsonp`
- `adminSetStudentPasswordJsonp`
- `adminMarkGuardianConsentJsonp`
- `studentFallbackEventJsonp`
- `adminFallbackEventsJsonp`
