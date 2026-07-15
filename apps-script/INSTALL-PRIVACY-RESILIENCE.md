# 개인정보 권한·백업 알림 Apps Script 설치

## 1. 파일 추가

Apps Script 프로젝트에 새 스크립트 파일을 만들고 아래 GitHub 파일 전체를 붙여넣습니다.

- `apps-script/student-privacy-resilience-addon.gs`
- `apps-script/student-password-post-addon.gs`

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

## 3. doPost(e) 연결

관리자가 직접 지정한 비밀번호와 학생 개인정보 동의 내용은 URL에 넣지 않고 POST 본문으로 전송합니다. 기존 `doPost(e)` 함수 시작 부분에 아래 코드를 추가합니다.

```javascript
var securePostResponse = handleStudentSecurePost_(e);
if (securePostResponse) return securePostResponse;
```

기존 `doPost(e)`가 없다면 다음처럼 만듭니다.

```javascript
function doPost(e) {
  var securePostResponse = handleStudentSecurePost_(e);
  if (securePostResponse) return securePostResponse;
  return ContentService.createTextOutput('unsupported');
}
```

## 4. setup() 연결

기존 `setup()` 함수 마지막에 아래 두 줄을 추가합니다.

```javascript
setupStudentAuth_();
setupStudentPrivacyResilience_();
```

## 5. setup() 1회 실행

Apps Script 편집기에서 `setup()`을 직접 한 번 실행합니다. 다음 시트가 자동 생성됩니다.

- `학생개인정보권한`
- `학생개인정보동의로그`
- `시스템오류알림`

최초 실행 시 스프레드시트, 메일 전송과 관련된 Google 권한 요청을 승인합니다.

## 6. 새 버전으로 배포

`배포 > 배포 관리 > 수정 > 새 버전 > 배포` 순서로 웹 앱을 새 버전으로 배포합니다.

웹 앱 실행 사용자는 본인, 액세스 권한은 기존 출석 시스템과 동일하게 유지합니다.

## 7. 기능 확인

1. 학생 로그인 승인
2. `/ios-or-android/`에서 기기 선택
3. `/student/onboarding/`에서 위치 권한 허용
4. 필수·선택 개인정보 동의 저장
5. 스프레드시트 `학생개인정보권한` 행 생성 확인
6. 관리자 `/admin/privacy-permissions/`에서 계정별 권한 확인
7. `/accounts-s/`에서 관리자 지정 비밀번호 설정
8. 브라우저 주소에 관리자 지정 비밀번호·법정대리인 성명이 포함되지 않는지 확인
9. `/student/recovery/` 진입 후 `시스템오류알림`과 관리자 이메일 확인

## 신규 GET action

- `studentPrivacyStatusJsonp`
- `adminPrivacyPermissionsJsonp`
- `adminSetStudentPasswordJsonp` — 호환용이며 웹 화면은 사용하지 않음
- `adminMarkGuardianConsentJsonp`
- `studentFallbackEventJsonp`
- `adminFallbackEventsJsonp`

## 신규 POST action

- `adminSetStudentPasswordPost`
- `studentSavePrivacyConsentPost`
- `studentWithdrawPrivacyConsentPost`

기존 JSONP 동의 action은 호환을 위해 백엔드에 남아 있지만 새 웹 화면은 POST action을 사용합니다.
