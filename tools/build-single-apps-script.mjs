import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const authPath = path.join(root, 'apps-script', 'student-auth-addon.gs');
const adminPath = path.join(root, 'apps-script', 'admin-compat-addon.gs');
const privacyPath = path.join(root, 'apps-script', 'FINAL-StudentPrivacy-Code.gs.txt');
const outputPath = path.join(root, 'apps-script', 'FINAL-Student-All-In-One.gs');

const [authSource, adminSource, privacySource] = await Promise.all([
  fs.readFile(authPath, 'utf8'),
  fs.readFile(adminPath, 'utf8'),
  fs.readFile(privacyPath, 'utf8')
]);

const bindSpreadsheet = (source) => source.replaceAll(
  'SpreadsheetApp.getActiveSpreadsheet()',
  'studentOpenSpreadsheet_()'
);

const securedAuthSource = authSource.replace(
  /function studentRequireAdmin_\(e\) \{[\s\S]*?\n\}/,
  `function studentRequireAdmin_(e) {
  if (typeof requireAuth_ !== 'function') {
    var unavailable = new Error('관리자 인증 서버가 준비되지 않았습니다.');
    unavailable.code = 'ADMIN_AUTH_UNAVAILABLE';
    throw unavailable;
  }
  var auth = requireAuth_(e && e.parameter ? e.parameter : e);
  if (!auth || !auth.ok) {
    var denied = new Error(auth && auth.message || '관리자 로그인이 필요합니다.');
    denied.code = auth && auth.code || 'ADMIN_AUTH_REQUIRED';
    throw denied;
  }
  return auth;
}`
);

const authCode = bindSpreadsheet(securedAuthSource);
const adminCode = bindSpreadsheet(adminSource);
const privacyCode = bindSpreadsheet(privacySource);

const header = `/*
 * 2-12 출석 시스템 전체 기능 통합 단일 파일
 * 생성일: 2026-07-17
 *
 * 포함 기능
 * - 관리자 ID/비밀번호 및 Google 로그인
 * - 14일 관리자 세션과 관리자 권한 확인
 * - 관리자 대시보드 기본 API
 * - 학생계정 및 관리자 승인 로그인
 * - 학생 세션과 GPS 출석
 * - 개인정보 필수·선택 동의 및 권한 시트
 * - 개인정보 및 비밀번호 보안 POST
 *
 * 설치
 * 1. Apps Script의 기존 코드를 모두 지운다.
 * 2. 이 파일 전체를 Code.gs 한 파일에 붙여 넣는다.
 * 3. INSTALL_2_12_STUDENT_SYSTEM 을 실행한다.
 * 4. 배포 관리에서 기존 웹 앱을 새 버전으로 재배포한다.
 * 5. 실행 사용자: 나 / 액세스 권한: 모든 사용자
 */

var STUDENT_SYSTEM_SPREADSHEET_ID = '1l2pyOTzEKNn2xAbro7T88T2kdR3hswcaE5YBVClK0U';
var STUDENT_SYSTEM_VERSION = '2026-07-17-full-server-v2';

function studentOpenSpreadsheet_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  return SpreadsheetApp.openById(STUDENT_SYSTEM_SPREADSHEET_ID);
}

function doGet(e) {
  var p = e && e.parameter || {};
  var action = String(p.action || '').trim();

  try {
    if (!action || action === 'health' || action === 'healthJsonp') {
      return studentJsonp_(e, {
        ok: true,
        service: '2-12-full-system',
        version: STUDENT_SYSTEM_VERSION,
        spreadsheetId: STUDENT_SYSTEM_SPREADSHEET_ID
      });
    }

    var adminResponse = handleAdminCompatAction_(action, e);
    if (adminResponse) return adminResponse;

    var privacyResponse = handleStudentPrivacyAction_(action, e);
    if (privacyResponse) return privacyResponse;

    var studentResponse = handleStudentAuthAction_(action, e);
    if (studentResponse) return studentResponse;

    return studentJsonp_(e, {
      ok: false,
      code: 'ACTION_NOT_SUPPORTED',
      message: '지원하지 않는 서버 요청입니다: ' + action,
      version: STUDENT_SYSTEM_VERSION
    });
  } catch (error) {
    return studentJsonp_(e, {
      ok: false,
      code: error && error.code || 'SERVER_ERROR',
      message: error && error.message || String(error),
      version: STUDENT_SYSTEM_VERSION
    });
  }
}

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

function INSTALL_2_12_STUDENT_SYSTEM() {
  adminCompatSetup_();
  var result = setupStudentPrivacyFinal_();
  SpreadsheetApp.flush();
  return {
    ok: true,
    version: STUDENT_SYSTEM_VERSION,
    student: result,
    admin: true
  };
}

function setupStudentPrivacyFinal() {
  return INSTALL_2_12_STUDENT_SYSTEM();
}

function CHECK_2_12_STUDENT_SYSTEM() {
  var ss = studentOpenSpreadsheet_();
  var required = [
    '설정', '사용자', '관리자', '전체로그', '로그인기록',
    '학생계정', '학생로그인요청', '학생세션', '학생출석로그',
    '학생개인정보권한', '학생개인정보동의로그', '시스템오류알림'
  ];
  var found = {};
  ss.getSheets().forEach(function (sheet) { found[sheet.getName()] = true; });
  return {
    ok: required.every(function (name) { return Boolean(found[name]); }),
    version: STUDENT_SYSTEM_VERSION,
    spreadsheetId: ss.getId(),
    createdSheets: required.filter(function (name) { return Boolean(found[name]); }),
    missingSheets: required.filter(function (name) { return !found[name]; })
  };
}

function TEST_2_12_STUDENT_SERVER() {
  var response = studentFeaturePingJsonp_({ parameter: {} });
  return { ok: Boolean(response && response.ok), version: STUDENT_SYSTEM_VERSION, response: response };
}

function TEST_2_12_ADMIN_SERVER() {
  adminCompatSetup_();
  var challenge = adminCompatLoginChallenge_({ adminIdHash: adminCompatHash_('admin') });
  return {
    ok: Boolean(challenge && challenge.ok && challenge.challengeId),
    version: STUDENT_SYSTEM_VERSION,
    adminChallengeReady: Boolean(challenge && challenge.challengeId)
  };
}

`;

const adminDivider = `\n\n/* ==========================================================================
 * 관리자 로그인·세션·대시보드 호환 모듈
 * ========================================================================== */\n\n`;
const privacyDivider = `\n\n/* ==========================================================================
 * 개인정보·보안 POST·권한 시트 통합 모듈
 * ========================================================================== */\n\n`;

const footer = `

/*
 * 배포 후 확인 주소
 * ?action=studentFeaturePingJsonp&callback=callback
 * ?action=adminLoginChallengeJsonp&adminIdHash=test&callback=callback
 */
`;

const output = header + authCode.trim() + adminDivider + adminCode.trim() + privacyDivider + privacyCode.trim() + footer;
await fs.writeFile(outputPath, output, 'utf8');
console.log(`Generated ${path.relative(root, outputPath)}`);
