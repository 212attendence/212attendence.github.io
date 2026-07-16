import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const authPath = path.join(root, 'apps-script', 'student-auth-addon.gs');
const privacyPath = path.join(root, 'apps-script', 'FINAL-StudentPrivacy-Code.gs.txt');
const outputPath = path.join(root, 'apps-script', 'FINAL-Student-All-In-One.gs');

const [authCode, privacyCode] = await Promise.all([
  fs.readFile(authPath, 'utf8'),
  fs.readFile(privacyPath, 'utf8')
]);

const header = `/*
 * 2-12 출석 시스템 학생 기능 통합 단일 파일
 * 생성일: 2026-07-16
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
 * 적용 방법
 * 1. 기존 Apps Script의 예전 student-auth/privacy/password 확장 파일은 삭제한다.
 * 2. 이 파일 하나만 추가한다.
 * 3. 기존 Code.gs의 doGet(e)에서 action을 만든 직후 아래 순서로 호출한다.
 *
 *    var privacyResponse = handleStudentPrivacyAction_(action, e);
 *    if (privacyResponse) return privacyResponse;
 *    var studentResponse = handleStudentAuthAction_(action, e);
 *    if (studentResponse) return studentResponse;
 *
 * 4. 기존 doPost(e) 시작 부분에 아래를 넣는다.
 *
 *    var securePostResponse = handleStudentSecurePost_(e);
 *    if (securePostResponse) return securePostResponse;
 *
 * 5. setupStudentPrivacyFinal_()을 한 번 실행하고 새 버전으로 웹 앱을 재배포한다.
 */

`;

const divider = `\n\n/* ==========================================================================\n * 개인정보·보안 POST·권한 시트 통합 모듈\n * ========================================================================== */\n\n`;

const output = header + authCode.trim() + divider + privacyCode.trim() + '\n';
await fs.writeFile(outputPath, output, 'utf8');
console.log(`Generated ${path.relative(root, outputPath)}`);
