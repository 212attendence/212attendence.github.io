import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const authPath = path.join(root, 'apps-script', 'student-auth-addon.gs');
const privacyPath = path.join(root, 'apps-script', 'FINAL-StudentPrivacy-Code.gs.txt');
const outputPath = path.join(root, 'apps-script', 'FINAL-Student-All-In-One.gs');

const [authSource, privacySource] = await Promise.all([
  fs.readFile(authPath, 'utf8'),
  fs.readFile(privacyPath, 'utf8')
]);

// 바운드 스크립트와 독립형 스크립트 모두 같은 스프레드시트를 사용하도록 통일한다.
const bindSpreadsheet = (source) => source.replaceAll(
  'SpreadsheetApp.getActiveSpreadsheet()',
  'studentOpenSpreadsheet_()'
);

const authCode = bindSpreadsheet(authSource);
const privacyCode = bindSpreadsheet(privacySource);

const header = `/*
 * 2-12 출석 시스템 학생 기능 통합 단일 파일
 * 생성일: 2026-07-17
 *
 * 이 파일 하나에 포함된 기능
 * - 독립 실행 가능한 doGet(e), doPost(e)
 * - 학생계정 및 관리자 승인 로그인
 * - 학생 세션
 * - GPS 출석: 해강중학교 지정 좌표 반경 100m
 * - 학생 개인정보 동의 저장/조회/철회
 * - 학생개인정보권한, 학생개인정보동의로그, 시스템오류알림 시트
 * - 관리자 학생계정/비밀번호/개인정보 권한 관리
 * - 개인정보 및 비밀번호 보안 POST 처리
 *
 * 설치
 * 1. Apps Script의 기존 코드를 모두 지우고 이 파일 전체를 붙여 넣는다.
 * 2. 함수 목록에서 INSTALL_2_12_STUDENT_SYSTEM 을 선택해 실행한다.
 * 3. 배포 > 배포 관리 > 새 버전으로 웹 앱을 재배포한다.
 * 4. 실행 사용자는 나, 액세스 권한은 모든 사용자로 설정한다.
 */

var STUDENT_SYSTEM_SPREADSHEET_ID = '1l2pyOTzEKNn2xAbro7T88T2kdR3hswcaE5YBVClK0U';
var STUDENT_SYSTEM_VERSION = '2026-07-17-standalone-v1';

/** 바운드/독립형 Apps Script 모두에서 사용할 스프레드시트를 반환한다. */
function studentOpenSpreadsheet_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  return SpreadsheetApp.openById(STUDENT_SYSTEM_SPREADSHEET_ID);
}

/**
 * 웹 앱 GET 진입점.
 * 이 파일 하나만 붙여 넣어도 학생 로그인·출석·개인정보 JSONP API가 동작한다.
 */
function doGet(e) {
  var p = e && e.parameter || {};
  var action = String(p.action || '').trim();

  try {
    if (!action || action === 'health' || action === 'healthJsonp') {
      return studentJsonp_(e, {
        ok: true,
        service: '2-12-student-system',
        version: STUDENT_SYSTEM_VERSION,
        spreadsheetId: STUDENT_SYSTEM_SPREADSHEET_ID
      });
    }

    var privacyResponse = handleStudentPrivacyAction_(action, e);
    if (privacyResponse) return privacyResponse;

    var studentResponse = handleStudentAuthAction_(action, e);
    if (studentResponse) return studentResponse;

    return studentJsonp_(e, {
      ok: false,
      code: 'ACTION_NOT_SUPPORTED',
      message: '지원하지 않는 서버 요청입니다: ' + action
    });
  } catch (error) {
    return studentJsonp_(e, {
      ok: false,
      code: error && error.code || 'SERVER_ERROR',
      message: error && error.message || String(error)
    });
  }
}

/** 웹 앱 POST 진입점. */
function doPost(e) {
  try {
    var securePostResponse = handleStudentSecurePost_(e);
    if (securePostResponse) return securePostResponse;

    return ContentService
      .createTextOutput(JSON.stringify({
        ok: false,
        code: 'POST_ACTION_NOT_SUPPORTED',
        message: '지원하지 않는 POST 요청입니다.'
      }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: false,
        code: error && error.code || 'POST_SERVER_ERROR',
        message: error && error.message || String(error)
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/** Apps Script 함수 선택창에 표시되는 공개 설치 함수. */
function INSTALL_2_12_STUDENT_SYSTEM() {
  var result = setupStudentPrivacyFinal_();
  SpreadsheetApp.flush();
  return result;
}

/** 기존 안내 이름과의 호환용 공개 함수 */
function setupStudentPrivacyFinal() {
  return INSTALL_2_12_STUDENT_SYSTEM();
}

/** 설치 결과 확인용 공개 함수 */
function CHECK_2_12_STUDENT_SYSTEM() {
  var ss = studentOpenSpreadsheet_();
  var required = [
    '학생계정',
    '학생로그인요청',
    '학생세션',
    '학생출석로그',
    '학생개인정보권한',
    '학생개인정보동의로그',
    '시스템오류알림'
  ];
  var found = {};
  ss.getSheets().forEach(function (sheet) {
    found[sheet.getName()] = true;
  });
  return {
    ok: required.every(function (name) { return Boolean(found[name]); }),
    version: STUDENT_SYSTEM_VERSION,
    spreadsheetId: ss.getId(),
    createdSheets: required.filter(function (name) { return Boolean(found[name]); }),
    missingSheets: required.filter(function (name) { return !found[name]; })
  };
}

/** 배포 후 함수 실행창에서 서버 로직을 직접 점검하는 함수 */
function TEST_2_12_STUDENT_SERVER() {
  var response = studentFeaturePingJsonp_({ parameter: {} });
  return {
    ok: Boolean(response && response.ok),
    version: STUDENT_SYSTEM_VERSION,
    response: response
  };
}

`;

const divider = `\n\n/* ==========================================================================
 * 개인정보·보안 POST·권한 시트 통합 모듈
 * ========================================================================== */\n\n`;

const footer = `

/* ==========================================================================
 * 배포 확인
 * ==========================================================================
 * 1. INSTALL_2_12_STUDENT_SYSTEM 실행
 * 2. CHECK_2_12_STUDENT_SYSTEM 실행
 * 3. 배포 > 배포 관리 > 수정 > 새 버전 > 배포
 * 4. 실행 사용자: 나
 * 5. 액세스 권한: 모든 사용자
 *
 * 웹 앱 주소 뒤에 아래를 붙여 열었을 때 callback({ok:true,...}); 가 보이면 정상이다.
 * ?action=studentFeaturePingJsonp&callback=callback
 */
`;

const output = header + authCode.trim() + divider + privacyCode.trim() + footer;
await fs.writeFile(outputPath, output, 'utf8');
console.log(`Generated ${path.relative(root, outputPath)}`);
