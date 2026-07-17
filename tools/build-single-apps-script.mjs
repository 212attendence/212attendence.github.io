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
 * - 학생계정 및 관리자 승인 로그인
 * - 학생 세션
 * - GPS 출석: 해강중학교 지정 좌표 반경 100m
 * - 학생 개인정보 동의 저장/조회/철회
 * - 학생개인정보권한, 학생개인정보동의로그, 시스템오류알림 시트
 * - 관리자 학생계정/비밀번호/개인정보 권한 관리
 * - 개인정보 및 비밀번호 보안 POST 처리
 *
 * 설치
 * 1. 예전 student-auth/privacy/password 확장 파일은 삭제한다.
 * 2. 이 파일 하나만 Apps Script에 붙여 넣는다.
 * 3. 함수 목록에서 INSTALL_2_12_STUDENT_SYSTEM 을 선택해 실행한다.
 * 4. 기존 Code.gs의 doGet/doPost 연결부가 없으면 파일 맨 아래 안내대로 연결한다.
 * 5. 웹 앱을 새 버전으로 재배포한다.
 */

var STUDENT_SYSTEM_SPREADSHEET_ID = '1l2pyOTzEKNn2xAbro7T88T2kdR3hswcaE5YBVClK0U';

/**
 * 바운드/독립형 Apps Script 모두에서 사용할 스프레드시트를 반환한다.
 */
function studentOpenSpreadsheet_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  return SpreadsheetApp.openById(STUDENT_SYSTEM_SPREADSHEET_ID);
}

/**
 * Apps Script 함수 선택창에 표시되는 공개 설치 함수.
 * 이 함수를 한 번 실행하면 필요한 모든 시트를 생성한다.
 */
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
    spreadsheetId: ss.getId(),
    createdSheets: required.filter(function (name) { return Boolean(found[name]); }),
    missingSheets: required.filter(function (name) { return !found[name]; })
  };
}

`;

const divider = `\n\n/* ==========================================================================\n * 개인정보·보안 POST·권한 시트 통합 모듈\n * ========================================================================== */\n\n`;

const footer = `

/* ==========================================================================\n * Code.gs 연결 안내\n * ==========================================================================\n * 기존 doGet(e)에서 action을 만든 직후:\n *\n *   var privacyResponse = handleStudentPrivacyAction_(action, e);\n *   if (privacyResponse) return privacyResponse;\n *   var studentResponse = handleStudentAuthAction_(action, e);\n *   if (studentResponse) return studentResponse;\n *\n * 기존 doPost(e) 시작 부분:\n *\n *   var securePostResponse = handleStudentSecurePost_(e);\n *   if (securePostResponse) return securePostResponse;\n */\n`;

const output = header + authCode.trim() + divider + privacyCode.trim() + footer;
await fs.writeFile(outputPath, output, 'utf8');
console.log(`Generated ${path.relative(root, outputPath)}`);
