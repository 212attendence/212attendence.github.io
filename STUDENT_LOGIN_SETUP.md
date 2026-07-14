# 학생 로그인·GPS 출석 기능 배포

GitHub Pages 화면은 배포되어 있지만 학생 계정 검증, 관리자 승인, GPS 거리 검증은 Apps Script 서버에서 실행해야 합니다.

## 1. Apps Script 파일 추가

저장소의 `apps-script/student-auth-addon.gs` 내용을 기존 Apps Script 프로젝트에 새 스크립트 파일로 추가합니다.

기존 `doGet(e)`에서 `action` 값을 읽은 직후 아래 코드를 추가합니다.

```javascript
var studentResponse = handleStudentAuthAction_(action, e);
if (studentResponse) return studentResponse;
```

기존 `setup()` 마지막에는 아래 호출을 추가합니다.

```javascript
setupStudentAuth_();
```

저장 후 `setupStudentAuth_()`를 한 번 직접 실행하고, 기존 웹 앱 배포를 **새 버전**으로 갱신합니다.

## 2. 생성되는 시트

- `학생계정`
- `학생로그인요청`
- `학생세션`
- `학생출석로그`

`학생계정` 시트에 다음 값을 입력합니다.

| studentId | initialPassword | passwordHash | name | fingerId | active | memo |
|---|---|---|---|---|---|---|
| 학생 ID | 최초 로그인용 비밀번호 | 비워 둠 | 학생 이름 | 사용자 시트와 같은 지문 ID | TRUE | 선택 |

최초 로그인이 성공하면 `initialPassword`는 자동으로 비워지고 `passwordHash`에 해시가 저장됩니다.

## 3. 관리자 승인

`/admin/dashboard/` 상단의 `알림` 버튼에서 학생 로그인 요청을 확인합니다.

- 로그인 허용
- 거절

학생 화면은 4초 간격으로 승인 결과를 확인합니다. 승인된 기기는 만료일 없는 기기 토큰을 저장하며, 학생 계정을 비활성화하거나 `학생세션` 시트의 `active`를 FALSE로 바꾸면 즉시 사용할 수 없게 됩니다.

## 4. 해강중학교 위치 설정

학교 기준점과 허용 반경은 다음 값으로 고정됩니다.

- 학교명: 해강중학교
- 기준 좌표: `35°09'50.70"N 129°08'08.69"E`
- 십진수 좌표: `35.16408333333333, 129.13574722222222`
- 허용 반경: `100m`
- 학생이 전송한 실제 위도·경도는 로그에 저장하지 않음
- 로그에는 학교와의 거리, GPS 정확도, 결과만 저장

학생 관련 API는 항상 위 고정 좌표와 반경을 사용합니다. 관리자가 학교 중심점을 직접 저장하거나 설정 시트의 좌표를 관리할 필요가 없습니다.

위치 권한은 웹사이트가 운영체제 설정을 강제로 `항상 허용`으로 변경할 수 없습니다. iPhone·Android에서 제공하는 가장 넓은 허용 범위와 `정확한 위치`를 켜야 합니다.

## 5. 화면 경로

- `/` — 학생·관리자 선택
- `/student/login/` — 학생 로그인 및 관리자 승인 대기
- `/student/identity/` — GPS 출석 인증
- `/student/help/` — 학생 도움말
- `/student/error/gps/` — 위치 권한 오류 안내
- `/admin/login/` — 관리자 로그인
- `/admin/dashboard/` — 관리자 대시보드 및 학생 승인 알림
- `/admin/help/` — 관리자 전용 도움말
- `/admin/attendance-rate/` — 오늘 출석률 상세

기존 주소는 새 주소로 자동 이동합니다.
