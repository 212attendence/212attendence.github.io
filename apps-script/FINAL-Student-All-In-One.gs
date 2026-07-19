/*
 * 2-12 출석 시스템 전체 기능 통합 단일 파일
 * 생성일: 2026-07-18
 *
 * 포함 기능
 * - 서버 V6 학생 승인 결과 전달
 * - 기존 사용자·설정 시트 학생 수 동기화
 * - WebAuthn 패스키 등록·로그인·삭제
 * - 관리자 ID/비밀번호 및 Google 로그인
 * - 14일 관리자 세션과 관리자 권한 확인
 * - 학생계정, GPS 출석, 개인정보 동의
 *
 * 중요
 * - doGet, 관리자 라우터, 설치 함수는 V6 모듈에서 각각 한 번만 정의된다.
 * - Apps Script 프로젝트에는 이 Code.gs 한 파일만 남긴다.
 *
 * 설치
 * 1. Apps Script의 기존 코드를 모두 지운다.
 * 2. 이 파일 전체를 Code.gs 한 파일에 붙여 넣는다.
 * 3. INSTALL_2_12_STUDENT_SYSTEM 을 실행한다.
 * 4. TEST_2_12_V6_SERVER 를 실행한다.
 * 5. 배포 관리에서 기존 웹 앱을 새 버전으로 재배포한다.
 * 6. 실행 사용자: 나 / 액세스 권한: 모든 사용자
 */

var STUDENT_SYSTEM_SPREADSHEET_ID = '1l2pyOTzEKNn2xAbro7T88T2kdR3hswcaE5YBVClK0U';
var STUDENT_SYSTEM_VERSION = '2026-07-18-server-v6.1';

function studentOpenSpreadsheet_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  return SpreadsheetApp.openById(STUDENT_SYSTEM_SPREADSHEET_ID);
}

/* POST 진입점은 개인정보·비밀번호 보안 전송에만 사용한다. */
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

function setupStudentPrivacyFinal() {
  return INSTALL_2_12_STUDENT_SYSTEM();
}

function CHECK_2_12_STUDENT_SYSTEM() {
  var ss = studentOpenSpreadsheet_();
  var required = [
    '설정', '사용자', '관리자', '전체로그', '로그인기록',
    '학생계정', '학생로그인요청', '학생세션', '학생출석로그',
    '학생개인정보권한', '학생개인정보동의로그', '시스템오류알림', '패스키'
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

/*
 * 2-12 출석 시스템 학생 로그인·GPS 출석 확장 모듈
 *
 * 기존 Code.gs의 doGet(e)에서 action을 읽은 직후 아래 두 줄을 추가하세요.
 *
 *   var studentResponse = handleStudentAuthAction_(action, e);
 *   if (studentResponse) return studentResponse;
 *
 * 기존 setup() 마지막에는 setupStudentAuth_(); 를 추가하고 웹 앱을 새 버전으로 배포하세요.
 */

var STUDENT_ACCOUNT_SHEET = '학생계정';
var STUDENT_REQUEST_SHEET = '학생로그인요청';
var STUDENT_SESSION_SHEET = '학생세션';
var STUDENT_ATTENDANCE_SHEET = '학생출석로그';
var STUDENT_REQUEST_TTL_MS = 10 * 60 * 1000;
var STUDENT_APPROVAL_TOKEN_TTL_SEC = 10 * 60;

// 고정 출석 기준: 35°09'50.70\"N 129°08'08.69\"E 중심 반경 100m
var STUDENT_SCHOOL_NAME = '해강중학교';
var STUDENT_SCHOOL_LAT = 35.16408333333333;
var STUDENT_SCHOOL_LNG = 129.13574722222222;
var STUDENT_SCHOOL_RADIUS_M = 100;

var STUDENT_ACCOUNT_HEADERS = [
  'createdAt', 'studentId', 'initialPassword', 'passwordHash', 'name', 'fingerId', 'active', 'memo', 'updatedAt'
];
var STUDENT_REQUEST_HEADERS = [
  'requestId', 'secretHash', 'createdAt', 'studentId', 'name', 'fingerId', 'status', 'decidedAt', 'decidedBy',
  'deviceName', 'deviceKey', 'userAgent', 'clientTime', 'clientTimezone'
];
var STUDENT_SESSION_HEADERS = [
  'createdAt', 'tokenHash', 'studentId', 'name', 'fingerId', 'deviceName', 'deviceKey', 'userAgent', 'lastUsedAt', 'active'
];
var STUDENT_ATTENDANCE_HEADERS = [
  'timestamp', 'studentId', 'name', 'fingerId', 'status', 'source', 'distanceM', 'accuracyM', 'radiusM', 'deviceName', 'memo'
];

function handleStudentAuthAction_(action, e) {
  var handlers = {
    studentFeaturePingJsonp: studentFeaturePingJsonp_,
    studentLoginJsonp: studentLoginJsonp_,
    studentRequestStatusJsonp: studentRequestStatusJsonp_,
    studentSessionJsonp: studentSessionJsonp_,
    studentAttendanceJsonp: studentAttendanceJsonp_,
    adminStudentRequestsJsonp: adminStudentRequestsJsonp_,
    adminDecideStudentRequestJsonp: adminDecideStudentRequestJsonp_,
    adminStudentAccountsJsonp: adminStudentAccountsJsonp_,
    adminSaveStudentAccountJsonp: adminSaveStudentAccountJsonp_,
    adminResetStudentPasswordsJsonp: adminResetStudentPasswordsJsonp_,
    adminToggleStudentAccountJsonp: adminToggleStudentAccountJsonp_,
    adminSaveSchoolLocationJsonp: adminSaveSchoolLocationJsonp_
  };
  if (!handlers[action]) return null;
  try {
    return studentJsonp_(e, handlers[action](e));
  } catch (error) {
    return studentJsonp_(e, {
      ok: false,
      code: error && error.code || 'STUDENT_SERVER_ERROR',
      message: error && error.message || String(error)
    });
  }
}

function setupStudentAuth_() {
  var ss = studentOpenSpreadsheet_();
  studentEnsureSheet_(ss, STUDENT_ACCOUNT_SHEET, STUDENT_ACCOUNT_HEADERS);
  studentEnsureSheet_(ss, STUDENT_REQUEST_SHEET, STUDENT_REQUEST_HEADERS);
  studentEnsureSheet_(ss, STUDENT_SESSION_SHEET, STUDENT_SESSION_HEADERS);
  studentEnsureSheet_(ss, STUDENT_ATTENDANCE_SHEET, STUDENT_ATTENDANCE_HEADERS);
  // 설정 시트에는 참고값만 기록하며 실제 판정은 아래 고정 상수를 사용합니다.
  studentSetSetting_('schoolName', STUDENT_SCHOOL_NAME);
  studentSetSetting_('schoolRadiusM', String(STUDENT_SCHOOL_RADIUS_M));
  studentSetSetting_('schoolLat', String(STUDENT_SCHOOL_LAT));
  studentSetSetting_('schoolLng', String(STUDENT_SCHOOL_LNG));
  studentGetSalt_();
  return true;
}

function studentFeaturePingJsonp_(e) {
  setupStudentAuth_();
  var config = studentLocationConfig_();
  return {
    ok: true,
    feature: 'student-auth-gps-v1',
    schoolName: config.schoolName,
    radiusM: config.radiusM,
    locationConfigured: config.configured
  };
}

function studentLoginJsonp_(e) {
  setupStudentAuth_();
  var p = e && e.parameter || {};
  var studentId = String(p.studentId || '').trim();
  var password = String(p.studentPw || '');
  if (!studentId || !password) return studentFail_('STUDENT_CREDENTIAL_REQUIRED', '학생 ID와 비밀번호를 입력하세요.');

  var account = studentFindAccount_(studentId);
  if (!account || !studentTruthy_(account.active)) return studentFail_('STUDENT_ACCOUNT_NOT_FOUND', '사용 가능한 학생 계정을 찾지 못했습니다.');
  if (!studentVerifyPassword_(account, password)) return studentFail_('STUDENT_PASSWORD_INVALID', '학생 ID 또는 비밀번호가 올바르지 않습니다.');

  var requestId = studentRandomToken_(18);
  var requestSecret = studentRandomToken_(24);
  var deviceName = String(p.deviceName || '').slice(0, 100);
  var userAgent = String(p.userAgent || '').slice(0, 180);
  var deviceKey = studentHash_(studentId + '|' + deviceName + '|' + userAgent);
  var now = new Date();

  studentAppendObject_(studentSheet_(STUDENT_REQUEST_SHEET), STUDENT_REQUEST_HEADERS, {
    requestId: requestId,
    secretHash: studentHash_(requestSecret),
    createdAt: now,
    studentId: account.studentId,
    name: account.name,
    fingerId: account.fingerId,
    status: 'PENDING',
    decidedAt: '',
    decidedBy: '',
    deviceName: deviceName,
    deviceKey: deviceKey,
    userAgent: userAgent,
    clientTime: String(p.clientTime || ''),
    clientTimezone: String(p.clientTimezone || '')
  });

  studentTryPushAdmin_({
    title: '학생 로그인 승인 요청',
    body: (account.name || account.studentId) + ' 학생이 로그인을 요청했습니다.',
    url: 'https://212attendence.github.io/admin/dashboard/?student-requests=1'
  });

  return {
    ok: true,
    status: 'PENDING',
    requestId: requestId,
    requestSecret: requestSecret,
    name: account.name
  };
}

function studentRequestStatusJsonp_(e) {
  setupStudentAuth_();
  var p = e && e.parameter || {};
  var requestId = String(p.requestId || '');
  var requestSecret = String(p.requestSecret || '');
  var request = studentFindBy_(studentSheet_(STUDENT_REQUEST_SHEET), 'requestId', requestId);
  if (!request || !studentConstantEqual_(String(request.secretHash || ''), studentHash_(requestSecret))) {
    return studentFail_('STUDENT_REQUEST_NOT_FOUND', '로그인 요청을 찾지 못했습니다.');
  }

  var age = Date.now() - new Date(request.createdAt).getTime();
  if (age > STUDENT_REQUEST_TTL_MS && request.status === 'PENDING') {
    studentUpdateRow_(studentSheet_(STUDENT_REQUEST_SHEET), request._row, { status: 'EXPIRED' });
    request.status = 'EXPIRED';
  }

  if (request.status === 'APPROVED') {
    var propertyKey = 'STUDENT_APPROVAL_TOKEN_' + requestId;
    var token = PropertiesService.getScriptProperties().getProperty(propertyKey);
    if (!token) {
      token = studentIssueSession_(request);
      PropertiesService.getScriptProperties().setProperty(propertyKey, token);
      CacheService.getScriptCache().put(propertyKey, token, STUDENT_APPROVAL_TOKEN_TTL_SEC);
    }
    return {
      ok: true,
      status: 'APPROVED',
      studentToken: token,
      studentId: request.studentId,
      name: request.name,
      fingerId: request.fingerId
    };
  }

  return { ok: true, status: request.status || 'PENDING', name: request.name };
}

function studentSessionJsonp_(e) {
  setupStudentAuth_();
  var token = String(e && e.parameter && e.parameter.studentToken || '');
  var session = studentFindSession_(token);
  if (!session) return studentFail_('STUDENT_AUTH_REQUIRED', '학생 로그인이 필요합니다.');
  studentUpdateRow_(studentSheet_(STUDENT_SESSION_SHEET), session._row, { lastUsedAt: new Date() });
  return { ok: true, studentId: session.studentId, name: session.name, fingerId: session.fingerId };
}

function studentAttendanceJsonp_(e) {
  setupStudentAuth_();
  var p = e && e.parameter || {};
  var session = studentFindSession_(String(p.studentToken || ''));
  if (!session) return studentFail_('STUDENT_AUTH_REQUIRED', '학생 로그인이 필요합니다.');

  var config = studentLocationConfig_();
  if (!config.configured) return studentFail_('GPS_CONFIG_REQUIRED', '관리자가 학교 위치 기준점을 먼저 설정해야 합니다.');

  var lat = Number(p.latitude), lng = Number(p.longitude), accuracy = Math.max(0, Number(p.accuracy || 0));
  if (!isFinite(lat) || !isFinite(lng)) return studentFail_('GPS_INVALID', '위치 정보가 올바르지 않습니다.');
  if (accuracy > 100) return studentFail_('GPS_ACCURACY_LOW', 'GPS 정확도가 낮습니다. 야외 또는 창가에서 다시 시도하세요.');

  var distance = studentHaversineM_(lat, lng, config.lat, config.lng);
  if (distance > config.radiusM) {
    return { ok: false, code: 'GPS_OUTSIDE', message: '학교 출석 범위 밖입니다.', distanceM: distance, radiusM: config.radiusM, accuracyM: accuracy };
  }

  var existing = studentFindTodayAttendance_(session.studentId);
  if (existing) {
    return { ok: true, alreadyRecorded: true, distanceM: distance, radiusM: config.radiusM, accuracyM: accuracy };
  }

  var status = studentAttendanceStatus_();
  var now = new Date();
  var row = {
    timestamp: now,
    studentId: session.studentId,
    name: session.name,
    fingerId: session.fingerId,
    status: status,
    source: 'student-gps',
    distanceM: Math.round(distance * 10) / 10,
    accuracyM: Math.round(accuracy * 10) / 10,
    radiusM: config.radiusM,
    deviceName: String(p.deviceName || session.deviceName || '').slice(0, 100),
    memo: 'GPS 출석 인증'
  };
  studentAppendObject_(studentSheet_(STUDENT_ATTENDANCE_SHEET), STUDENT_ATTENDANCE_HEADERS, row);
  studentAppendToAllLogs_(row);
  studentUpdateRow_(studentSheet_(STUDENT_SESSION_SHEET), session._row, { lastUsedAt: now });

  return { ok: true, status: status, distanceM: distance, radiusM: config.radiusM, accuracyM: accuracy };
}

function adminStudentRequestsJsonp_(e) {
  setupStudentAuth_();
  studentRequireAdmin_(e);
  var sheet = studentSheet_(STUDENT_REQUEST_SHEET);
  var rows = studentRows_(sheet).filter(function (row) {
    if (row.status !== 'PENDING') return false;
    return Date.now() - new Date(row.createdAt).getTime() <= STUDENT_REQUEST_TTL_MS;
  });
  rows.sort(function (a, b) { return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); });
  var config = studentLocationConfig_();
  return {
    ok: true,
    pendingCount: rows.length,
    requests: rows.slice(0, 50).map(function (row) {
      return {
        requestId: row.requestId,
        createdAt: row.createdAt,
        studentId: row.studentId,
        name: row.name,
        fingerId: row.fingerId,
        deviceName: row.deviceName,
        clientTime: row.clientTime
      };
    }),
    school: { name: config.schoolName, radiusM: config.radiusM, configured: config.configured }
  };
}

function adminDecideStudentRequestJsonp_(e) {
  setupStudentAuth_();
  var admin = studentRequireAdmin_(e) || {};
  var p = e && e.parameter || {};
  var requestId = String(p.requestId || '');
  var decision = String(p.decision || '').toUpperCase();
  if (decision !== 'APPROVED' && decision !== 'DENIED') return studentFail_('DECISION_INVALID', '승인 또는 거절을 선택하세요.');
  var request = studentFindBy_(studentSheet_(STUDENT_REQUEST_SHEET), 'requestId', requestId);
  if (!request) return studentFail_('STUDENT_REQUEST_NOT_FOUND', '로그인 요청을 찾지 못했습니다.');
  if (request.status !== 'PENDING') return studentFail_('STUDENT_REQUEST_ALREADY_DECIDED', '이미 처리된 요청입니다.');

  studentUpdateRow_(studentSheet_(STUDENT_REQUEST_SHEET), request._row, {
    status: decision,
    decidedAt: new Date(),
    decidedBy: String(admin.name || admin.email || admin.adminId || 'ADMIN')
  });

  if (decision === 'APPROVED') {
    request.status = 'APPROVED';
    var token = studentIssueSession_(request);
    PropertiesService.getScriptProperties().setProperty('STUDENT_APPROVAL_TOKEN_' + requestId, token);
  }
  return { ok: true, status: decision, requestId: requestId };
}

function adminStudentAccountsJsonp_(e) {
  setupStudentAuth_();
  studentRequireAdmin_(e);
  var sessionRows = studentRows_(studentSheet_(STUDENT_SESSION_SHEET));
  var sessionCounts = {};
  sessionRows.forEach(function (row) {
    if (!studentTruthy_(row.active)) return;
    var key = String(row.studentId || '');
    sessionCounts[key] = (sessionCounts[key] || 0) + 1;
  });
  var accounts = studentRows_(studentSheet_(STUDENT_ACCOUNT_SHEET)).map(function (row) {
    var studentId = String(row.studentId || '');
    return studentAccountPublic_(row, sessionCounts[studentId] || 0);
  });
  accounts.sort(function (a, b) {
    return String(a.name || a.studentId).localeCompare(String(b.name || b.studentId), 'ko');
  });
  var activeSessionCount = Object.keys(sessionCounts).reduce(function (sum, key) {
    return sum + Number(sessionCounts[key] || 0);
  }, 0);
  return { ok: true, count: accounts.length, activeSessionCount: activeSessionCount, accounts: accounts };
}

function adminSaveStudentAccountJsonp_(e) {
  setupStudentAuth_();
  studentRequireAdmin_(e);
  var p = e && e.parameter || {};
  var studentId = String(p.studentId || '').trim();
  var name = String(p.name || '').trim();
  var fingerId = String(p.fingerId || '').trim();
  var memo = String(p.memo || '').trim().slice(0, 180);
  var active = studentTruthy_(p.active);
  var resetPassword = String(p.resetPassword || '') === '1';

  if (!/^[A-Za-z0-9_-]{1,40}$/.test(studentId)) {
    return studentFail_('STUDENT_ID_INVALID', '학생 ID를 올바르게 입력하세요.');
  }
  if (!name || name.length > 80) return studentFail_('STUDENT_NAME_REQUIRED', '학생 이름을 입력하세요.');

  var sheet = studentSheet_(STUDENT_ACCOUNT_SHEET);
  var rows = studentRows_(sheet);
  var existing = rows.filter(function (row) { return String(row.studentId || '') === studentId; })[0] || null;
  if (fingerId) {
    var duplicateFinger = rows.filter(function (row) {
      return String(row.studentId || '') !== studentId && String(row.fingerId || '').trim() === fingerId;
    })[0];
    if (duplicateFinger) return studentFail_('FINGER_ID_DUPLICATE', '이미 다른 학생이 사용하는 지문 ID입니다.');
  }

  var now = new Date();
  var temporaryPassword = '';
  if (!existing) {
    temporaryPassword = studentTemporaryPassword_();
    studentAppendObject_(sheet, STUDENT_ACCOUNT_HEADERS, {
      createdAt: now,
      studentId: studentId,
      initialPassword: temporaryPassword,
      passwordHash: '',
      name: name,
      fingerId: fingerId,
      active: active,
      memo: memo,
      updatedAt: now
    });
    existing = studentFindAccount_(studentId);
  } else {
    var changes = { name: name, fingerId: fingerId, active: active, memo: memo, updatedAt: now };
    if (resetPassword) {
      temporaryPassword = studentTemporaryPassword_();
      changes.initialPassword = temporaryPassword;
      changes.passwordHash = '';
    }
    studentUpdateRow_(sheet, existing._row, changes);
  }

  if (!active || temporaryPassword) studentDeactivateSessions_(studentId);
  var refreshed = studentFindAccount_(studentId);
  var result = { ok: true, account: studentAccountPublic_(refreshed, 0) };
  if (temporaryPassword) result.credential = { studentId: studentId, name: name, password: temporaryPassword };
  return result;
}

function adminResetStudentPasswordsJsonp_(e) {
  setupStudentAuth_();
  studentRequireAdmin_(e);
  var p = e && e.parameter || {};
  var requested = String(p.studentIds || '').split(',').map(function (value) { return value.trim(); }).filter(Boolean);
  if (!requested.length) return studentFail_('STUDENT_SELECTION_REQUIRED', '비밀번호를 재설정할 학생을 선택하세요.');

  var selected = {};
  requested.forEach(function (studentId) { selected[studentId] = true; });
  var common = String(p.common || '') === '1';
  var commonPassword = common ? studentTemporaryPassword_() : '';
  var sheet = studentSheet_(STUDENT_ACCOUNT_SHEET);
  var credentials = [];

  studentRows_(sheet).forEach(function (row) {
    var studentId = String(row.studentId || '');
    if (!selected[studentId]) return;
    var password = common ? commonPassword : studentTemporaryPassword_();
    studentUpdateRow_(sheet, row._row, {
      initialPassword: password,
      passwordHash: '',
      updatedAt: new Date()
    });
    studentDeactivateSessions_(studentId);
    credentials.push({ studentId: studentId, name: String(row.name || ''), password: password });
  });

  if (!credentials.length) return studentFail_('STUDENT_ACCOUNT_NOT_FOUND', '선택한 학생계정을 찾지 못했습니다.');
  return { ok: true, count: credentials.length, common: common, credentials: credentials };
}

function adminToggleStudentAccountJsonp_(e) {
  setupStudentAuth_();
  studentRequireAdmin_(e);
  var p = e && e.parameter || {};
  var studentId = String(p.studentId || '').trim();
  var account = studentFindAccount_(studentId);
  if (!account) return studentFail_('STUDENT_ACCOUNT_NOT_FOUND', '학생계정을 찾지 못했습니다.');
  var active = studentTruthy_(p.active);
  studentUpdateRow_(studentSheet_(STUDENT_ACCOUNT_SHEET), account._row, { active: active, updatedAt: new Date() });
  if (!active) studentDeactivateSessions_(studentId);
  return { ok: true, studentId: studentId, active: active };
}

function studentAccountPublic_(row, activeSessionCount) {
  var passwordState = String(row.initialPassword || '') ? '임시비밀번호' : String(row.passwordHash || '') ? '설정 완료' : '미설정';
  return {
    studentId: String(row.studentId || ''),
    name: String(row.name || ''),
    fingerId: String(row.fingerId || ''),
    active: studentTruthy_(row.active),
    memo: String(row.memo || ''),
    passwordState: passwordState,
    activeSessionCount: Number(activeSessionCount || 0),
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || ''
  };
}

function studentDeactivateSessions_(studentId) {
  var sheet = studentSheet_(STUDENT_SESSION_SHEET);
  var count = 0;
  studentRows_(sheet).forEach(function (row) {
    if (String(row.studentId || '') === String(studentId || '') && studentTruthy_(row.active)) {
      studentUpdateRow_(sheet, row._row, { active: false, lastUsedAt: new Date() });
      count += 1;
    }
  });
  return count;
}

function studentTemporaryPassword_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var seed = Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + Date.now() + '|' + Math.random();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  var output = '';
  for (var i = 0; i < 8; i++) {
    var value = digest[i];
    if (value < 0) value += 256;
    output += chars.charAt(value % chars.length);
  }
  return output;
}

function adminSaveSchoolLocationJsonp_(e) {
  setupStudentAuth_();
  studentRequireAdmin_(e);
  // 호환성을 위해 엔드포인트는 유지하지만 사용자 좌표는 받지 않습니다.
  return {
    ok: true,
    fixed: true,
    schoolName: STUDENT_SCHOOL_NAME,
    latitude: STUDENT_SCHOOL_LAT,
    longitude: STUDENT_SCHOOL_LNG,
    radiusM: STUDENT_SCHOOL_RADIUS_M,
    message: '학교 위치는 지정 좌표 중심 반경 100m로 자동 적용됩니다.'
  };
}

function studentRequireAdmin_(e) {
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
}

function studentIssueSession_(request) {
  var token = studentRandomToken_(32);
  var sessionSheet = studentSheet_(STUDENT_SESSION_SHEET);
  studentRows_(sessionSheet).forEach(function (row) {
    if (row.studentId === request.studentId && row.deviceKey === request.deviceKey && studentTruthy_(row.active)) {
      studentUpdateRow_(sessionSheet, row._row, { active: false });
    }
  });
  studentAppendObject_(sessionSheet, STUDENT_SESSION_HEADERS, {
    createdAt: new Date(),
    tokenHash: studentHash_(token),
    studentId: request.studentId,
    name: request.name,
    fingerId: request.fingerId,
    deviceName: request.deviceName,
    deviceKey: request.deviceKey,
    userAgent: request.userAgent,
    lastUsedAt: new Date(),
    active: true
  });
  return token;
}

function studentFindSession_(token) {
  if (!token) return null;
  var tokenHash = studentHash_(token);
  var session = studentRows_(studentSheet_(STUDENT_SESSION_SHEET)).filter(function (row) {
    return studentTruthy_(row.active) && studentConstantEqual_(String(row.tokenHash || ''), tokenHash);
  })[0] || null;
  if (!session) return null;
  var account = studentFindAccount_(session.studentId);
  if (!account || !studentTruthy_(account.active)) return null;
  return session;
}

function studentFindAccount_(studentId) {
  return studentFindBy_(studentSheet_(STUDENT_ACCOUNT_SHEET), 'studentId', studentId);
}

function studentVerifyPassword_(account, password) {
  var sheet = studentSheet_(STUDENT_ACCOUNT_SHEET);
  var currentHash = String(account.passwordHash || '');
  if (currentHash) return studentConstantEqual_(currentHash, studentPasswordHash_(password));
  var initial = String(account.initialPassword || '');
  if (!initial || !studentConstantEqual_(initial, password)) return false;
  studentUpdateRow_(sheet, account._row, {
    initialPassword: '',
    passwordHash: studentPasswordHash_(password),
    updatedAt: new Date()
  });
  return true;
}

function studentPasswordHash_(password) {
  return studentHash_(studentGetSalt_() + '|' + String(password || ''));
}

function studentGetSalt_() {
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('STUDENT_AUTH_SALT');
  if (!salt) {
    salt = studentRandomToken_(32);
    props.setProperty('STUDENT_AUTH_SALT', salt);
  }
  return salt;
}

function studentLocationConfig_() {
  // 설정 시트 값과 무관하게 항상 지정 좌표와 반경을 사용합니다.
  return {
    schoolName: STUDENT_SCHOOL_NAME,
    lat: STUDENT_SCHOOL_LAT,
    lng: STUDENT_SCHOOL_LNG,
    radiusM: STUDENT_SCHOOL_RADIUS_M,
    configured: true,
    fixed: true
  };
}

function studentAttendanceStatus_() {
  var tz = Session.getScriptTimeZone() || 'Asia/Seoul';
  var hhmm = Utilities.formatDate(new Date(), tz, 'HH:mm');
  var lateTime = studentGetSetting_('lateTime', '08:30');
  return hhmm > lateTime ? '지각' : '출석';
}

function studentFindTodayAttendance_(studentId) {
  var tz = Session.getScriptTimeZone() || 'Asia/Seoul';
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  return studentRows_(studentSheet_(STUDENT_ATTENDANCE_SHEET)).filter(function (row) {
    if (String(row.studentId || '') !== String(studentId || '')) return false;
    var date = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
    return isFinite(date.getTime()) && Utilities.formatDate(date, tz, 'yyyy-MM-dd') === today;
  })[0] || null;
}

function studentAppendToAllLogs_(row) {
  var ss = studentOpenSpreadsheet_();
  var sheet = ss.getSheetByName('전체로그');
  if (!sheet) {
    sheet = ss.insertSheet('전체로그');
    sheet.getRange(1, 1, 1, 8).setValues([['timestamp', 'deviceId', 'fingerId', 'name', 'status', 'source', 'studentId', 'memo']]);
  }
  var headers = studentHeaders_(sheet);
  var aliases = {
    timestamp: ['timestamp', '시간', '일시', 'createdAt'],
    deviceId: ['deviceId', '장치ID', '기기ID'],
    fingerId: ['fingerId', '지문ID', 'finger_id'],
    name: ['name', '이름', '학생명'],
    status: ['status', '상태', '출석상태'],
    source: ['source', '방식', '출처'],
    studentId: ['studentId', '학생ID', '학번'],
    memo: ['memo', '비고', '메모']
  };
  var values = headers.map(function (header) {
    var key = Object.keys(aliases).filter(function (candidate) {
      return aliases[candidate].indexOf(String(header).trim()) >= 0;
    })[0];
    if (!key) return '';
    if (key === 'deviceId') return 'student-web';
    return row[key] == null ? '' : row[key];
  });
  sheet.appendRow(values);
}

function studentTryPushAdmin_(payload) {
  try {
    if (typeof sendPushNotification_ === 'function') {
      sendPushNotification_(payload.title, payload.body, payload.url);
      return;
    }
    if (typeof sendPushToAllTokens_ === 'function') {
      sendPushToAllTokens_({ title: payload.title, body: payload.body, url: payload.url, tag: 'student-login-request' });
    }
  } catch (error) {
    console.warn('Student admin push hook failed', error);
  }
}

function studentGetSetting_(key, fallback) {
  var sheet = studentOpenSpreadsheet_().getSheetByName('설정');
  if (!sheet || sheet.getLastRow() < 1) return fallback;
  var values = sheet.getDataRange().getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === key) return values[i][1] == null || values[i][1] === '' ? fallback : values[i][1];
  }
  return fallback;
}

function studentNormalizeSheetName_(value) {
  return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
}

function studentFindSheet_(ss, name) {
  var direct = ss.getSheetByName(name);
  if (direct) return direct;
  var target = studentNormalizeSheetName_(name);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (studentNormalizeSheetName_(sheets[i].getName()) === target) return sheets[i];
  }
  return null;
}

function studentSetSetting_(key, value) {
  var ss = studentOpenSpreadsheet_();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = studentFindSheet_(ss, '설정');
    if (!sheet) {
      try {
        sheet = ss.insertSheet('설정');
      } catch (error) {
        sheet = studentFindSheet_(ss, '설정');
        if (!sheet) throw error;
      }
    }
    var values = sheet.getLastRow() ? sheet.getRange(1, 1, sheet.getLastRow(), Math.max(2, sheet.getLastColumn())).getValues() : [];
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        return;
      }
    }
    sheet.appendRow([key, value]);
  } finally {
    lock.releaseLock();
  }
}

function studentEnsureSetting_(key, value) {
  var existing = studentGetSetting_(key, null);
  if (existing === null) studentSetSetting_(key, value);
}

function studentEnsureSheet_(ss, name, headers) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = studentFindSheet_(ss, name);
    if (!sheet) {
      try {
        sheet = ss.insertSheet(name);
      } catch (error) {
        sheet = studentFindSheet_(ss, name);
        if (!sheet) throw error;
      }
    }
    if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  } finally {
    lock.releaseLock();
  }
}

function studentSheet_(name) {
  return studentOpenSpreadsheet_().getSheetByName(name);
}

function studentHeaders_(sheet) {
  if (!sheet || sheet.getLastColumn() < 1) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (v) { return String(v || '').trim(); });
}

function studentRows_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var headers = studentHeaders_(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return values.map(function (row, index) {
    var object = { _row: index + 2 };
    headers.forEach(function (header, column) { object[header] = row[column]; });
    return object;
  });
}

function studentFindBy_(sheet, key, value) {
  var target = String(value || '');
  return studentRows_(sheet).filter(function (row) { return String(row[key] || '') === target; })[0] || null;
}

function studentAppendObject_(sheet, headers, object) {
  sheet.appendRow(headers.map(function (header) { return object[header] == null ? '' : object[header]; }));
}

function studentUpdateRow_(sheet, rowNumber, changes) {
  var headers = studentHeaders_(sheet);
  Object.keys(changes).forEach(function (key) {
    var column = headers.indexOf(key);
    if (column >= 0) sheet.getRange(rowNumber, column + 1).setValue(changes[key]);
  });
}

function studentJsonp_(e, payload) {
  var callback = String(e && e.parameter && e.parameter.callback || 'callback');
  if (!/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) callback = 'callback';
  return ContentService.createTextOutput(callback + '(' + JSON.stringify(payload) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function studentFail_(code, message) {
  return { ok: false, code: code, message: message };
}

function studentRandomToken_(bytes) {
  var seed = Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + new Date().getTime() + '|' + Math.random();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '').slice(0, Math.max(16, bytes * 2));
}

function studentHash_(value) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function studentConstantEqual_(a, b) {
  a = String(a || ''); b = String(b || '');
  var mismatch = a.length ^ b.length;
  var length = Math.max(a.length, b.length);
  for (var i = 0; i < length; i++) mismatch |= (a.charCodeAt(i % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(i % Math.max(1, b.length)) || 0);
  return mismatch === 0;
}

function studentTruthy_(value) {
  if (value === true) return true;
  var text = String(value == null ? '' : value).trim().toLowerCase();
  return text === '' || text === 'true' || text === '1' || text === 'yes' || text === 'y' || text === '활성';
}

function studentHaversineM_(lat1, lng1, lat2, lng2) {
  var toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad;
  var dLng = (lng2 - lng1) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ==========================================================================
 * 관리자 로그인·세션·대시보드 기반 모듈
 * ========================================================================== */

/*
 * 2-12 출석 시스템 관리자 호환 모듈
 * 학생 단일 서버에 관리자 로그인·세션·대시보드 API를 복구합니다.
 */

var ADMIN_COMPAT_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
var ADMIN_COMPAT_CHALLENGE_TTL_SEC = 120;
var ADMIN_COMPAT_GOOGLE_CLIENT_ID = '802531292497-rjso2clr980pru87nc3sbf1nofq31kcc.apps.googleusercontent.com';
var ADMIN_COMPAT_ALLOWED_GOOGLE_EMAILS = 'junho.eum.travel@gmail.com';
var ADMIN_COMPAT_VERSION = '2026-07-17-admin-compat-v1';

var ADMIN_COMPAT_CONFIG_SHEET = '설정';
var ADMIN_COMPAT_ADMIN_SHEET = '관리자';
var ADMIN_COMPAT_USERS_SHEET = '사용자';
var ADMIN_COMPAT_LOGS_SHEET = '전체로그';
var ADMIN_COMPAT_LOGIN_LOGS_SHEET = '로그인기록';
var ADMIN_COMPAT_PUSH_SHEET = '푸시토큰';
var ADMIN_COMPAT_PASSKEY_SHEET = '패스키';

var ADMIN_COMPAT_CONFIG_HEADERS = ['key', 'value'];
var ADMIN_COMPAT_ADMIN_HEADERS = ['adminId', 'adminPw', 'active', 'memo', 'role'];
var ADMIN_COMPAT_USERS_HEADERS = ['name', 'fingerId', 'active', 'memo'];
var ADMIN_COMPAT_LOGS_HEADERS = ['timestamp', 'date', 'time', 'weekSheet', 'status', 'fingerId', 'name', 'deviceId', 'message', 'remark'];
var ADMIN_COMPAT_LOGIN_LOG_HEADERS = ['timestamp', 'date', 'time', 'adminId', 'role', 'deviceName', 'screenSize', 'clientTime', 'clientTimezone', 'userAgent', 'message'];
var ADMIN_COMPAT_PUSH_HEADERS = ['timestamp', 'token', 'platform', 'userAgent', 'loginType', 'loginId', 'role', 'active', 'lastUpdated'];
var ADMIN_COMPAT_PASSKEY_HEADERS = ['createdAt', 'credentialId', 'userId', 'loginType', 'loginId', 'displayName', 'role', 'publicKeyX', 'publicKeyY', 'alg', 'signCount', 'deviceName', 'userAgent', 'active', 'lastUsedAt'];

function adminCompatSetup_() {
  var ss = studentOpenSpreadsheet_();
  studentEnsureSheet_(ss, ADMIN_COMPAT_CONFIG_SHEET, ADMIN_COMPAT_CONFIG_HEADERS);
  var adminSheet = studentEnsureSheet_(ss, ADMIN_COMPAT_ADMIN_SHEET, ADMIN_COMPAT_ADMIN_HEADERS);
  studentEnsureSheet_(ss, ADMIN_COMPAT_USERS_SHEET, ADMIN_COMPAT_USERS_HEADERS);
  studentEnsureSheet_(ss, ADMIN_COMPAT_LOGS_SHEET, ADMIN_COMPAT_LOGS_HEADERS);
  studentEnsureSheet_(ss, ADMIN_COMPAT_LOGIN_LOGS_SHEET, ADMIN_COMPAT_LOGIN_LOG_HEADERS);
  studentEnsureSheet_(ss, ADMIN_COMPAT_PUSH_SHEET, ADMIN_COMPAT_PUSH_HEADERS);
  studentEnsureSheet_(ss, ADMIN_COMPAT_PASSKEY_SHEET, ADMIN_COMPAT_PASSKEY_HEADERS);

  adminCompatEnsureSetting_('timezone', 'Asia/Seoul');
  adminCompatEnsureSetting_('lateTime', '08:25');
  adminCompatEnsureSetting_('googleClientId', ADMIN_COMPAT_GOOGLE_CLIENT_ID);
  adminCompatEnsureSetting_('allowedGoogleEmails', ADMIN_COMPAT_ALLOWED_GOOGLE_EMAILS);

  if (adminSheet.getLastRow() < 2) {
    adminSheet.appendRow(['admin', '1234', true, '기본 관리자 - 운영 전 변경', 'ADMIN']);
  }
  return true;
}

function adminCompatLoginChallenge_(params) {
  var adminIdHash = String(params.adminIdHash || '').trim();
  if (!adminIdHash) return studentFail_('ADMIN_ID_HASH_REQUIRED', '관리자 로그인 식별값이 없습니다.');

  var rows = studentRows_(adminCompatSheet_(ADMIN_COMPAT_ADMIN_SHEET));
  var matched = null;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!adminCompatTrue_(adminCompatValue_(row, ['active', '활성', '사용', '활성여부'], true))) continue;
    var adminId = String(adminCompatValue_(row, ['adminId', '관리자ID', '아이디'], '')).trim();
    if (adminCompatConstantEqual_(adminCompatHash_(adminId), adminIdHash)) {
      matched = row;
      break;
    }
  }

  var challengeId = adminCompatRandom_(24);
  var challenge = adminCompatRandom_(32);
  var salt = adminCompatSalt_();
  var verifier = adminCompatRandom_(32);
  var scheme = 'v2';
  var matchedId = '';
  var role = 'ADMIN';

  if (matched) {
    matchedId = String(adminCompatValue_(matched, ['adminId', '관리자ID', '아이디'], '')).trim();
    role = String(adminCompatValue_(matched, ['role', '권한', '역할'], 'ADMIN') || 'ADMIN');
    var stored = String(adminCompatValue_(matched, ['adminPw', '관리자PW', '비밀번호'], ''));
    if (stored.indexOf('v2:') === 0) {
      verifier = stored.slice(3);
      scheme = 'v2';
    } else if (stored.indexOf('sha256:') === 0) {
      verifier = stored.slice(7);
      scheme = 'legacy-sha256';
    } else {
      verifier = adminCompatHash_(matchedId + '|' + stored + '|' + salt);
      scheme = 'v2';
    }
  }

  CacheService.getScriptCache().put('ADMIN_LOGIN_CHALLENGE_' + challengeId, JSON.stringify({
    adminId: matchedId,
    role: role,
    challenge: challenge,
    verifier: verifier,
    matched: Boolean(matched),
    createdAt: Date.now()
  }), ADMIN_COMPAT_CHALLENGE_TTL_SEC);

  return {
    ok: true,
    challengeId: challengeId,
    challenge: challenge,
    salt: salt,
    scheme: scheme,
    expiresInSec: ADMIN_COMPAT_CHALLENGE_TTL_SEC,
    version: ADMIN_COMPAT_VERSION
  };
}

function adminCompatLoginProof_(params) {
  var challengeId = String(params.challengeId || '').trim();
  var proof = String(params.proof || '').trim();
  if (!challengeId || !proof) return studentFail_('ADMIN_PROOF_REQUIRED', '보안 로그인 증명값이 없습니다.');

  var cache = CacheService.getScriptCache();
  var key = 'ADMIN_LOGIN_CHALLENGE_' + challengeId;
  var raw = cache.get(key);
  cache.remove(key);
  if (!raw) return studentFail_('ADMIN_CHALLENGE_EXPIRED', '로그인 요청이 만료되었습니다. 다시 시도하세요.');

  var data;
  try { data = JSON.parse(raw); }
  catch (error) { return studentFail_('ADMIN_CHALLENGE_INVALID', '로그인 요청이 올바르지 않습니다.'); }

  var expected = adminCompatHash_(String(data.verifier || '') + '|' + String(data.challenge || ''));
  if (!data.matched || !adminCompatConstantEqual_(expected, proof)) {
    adminCompatAppendLoginLog_('', '', '관리자 보안 로그인 실패', params);
    return studentFail_('ADMIN_LOGIN_FAILED', '관리자 ID 또는 비밀번호가 틀립니다.');
  }

  var session = adminCompatCreateSession_({
    loginType: 'admin',
    adminId: String(data.adminId || ''),
    email: '',
    name: String(data.adminId || ''),
    role: String(data.role || 'ADMIN')
  });
  adminCompatAppendLoginLog_(data.adminId, data.role, '관리자 보안 로그인 성공', params);
  return {
    ok: true,
    message: '관리자 로그인 성공',
    sessionToken: session.token,
    sessionExpiresAt: new Date(session.expiresAt).toISOString(),
    sessionExpiresAtMs: session.expiresAt,
    name: String(data.adminId || ''),
    role: String(data.role || 'ADMIN'),
    version: ADMIN_COMPAT_VERSION
  };
}

function adminCompatLegacyLogin_() {
  return studentFail_('LEGACY_LOGIN_DISABLED', '보안 로그인을 사용하세요.');
}

function adminCompatGoogleLogin_(params) {
  var idToken = String(params.idToken || '').trim();
  if (!idToken) return studentFail_('GOOGLE_TOKEN_REQUIRED', 'Google ID Token이 없습니다.');
  var user = adminCompatVerifyGoogleToken_(idToken);
  if (!user.ok) {
    adminCompatAppendLoginLog_(user.email || '', 'GOOGLE', 'Google 로그인 실패: ' + user.message, params);
    return studentFail_('GOOGLE_LOGIN_FAILED', user.message || 'Google 로그인 실패');
  }
  var session = adminCompatCreateSession_({
    loginType: 'google',
    adminId: '',
    email: user.email,
    name: user.name || user.email,
    role: 'ADMIN'
  });
  adminCompatAppendLoginLog_(user.email, 'ADMIN', 'Google 로그인 성공', params);
  return {
    ok: true,
    message: 'Google 로그인 성공',
    sessionToken: session.token,
    sessionExpiresAt: new Date(session.expiresAt).toISOString(),
    sessionExpiresAtMs: session.expiresAt,
    email: user.email,
    name: user.name || user.email,
    role: 'ADMIN',
    version: ADMIN_COMPAT_VERSION
  };
}

function adminCompatVerifyGoogleToken_(idToken) {
  var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), {
    method: 'get', muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) return { ok: false, message: 'Google 토큰 검증에 실패했습니다.' };
  var data;
  try { data = JSON.parse(response.getContentText()); }
  catch (error) { return { ok: false, message: 'Google 토큰 응답을 읽지 못했습니다.' }; }

  var email = String(data.email || '').trim().toLowerCase();
  var clientId = String(adminCompatGetSetting_('googleClientId', ADMIN_COMPAT_GOOGLE_CLIENT_ID)).trim();
  var allowed = String(adminCompatGetSetting_('allowedGoogleEmails', ADMIN_COMPAT_ALLOWED_GOOGLE_EMAILS))
    .split(/[,;\n\r]+/).map(function (value) { return value.trim().toLowerCase(); }).filter(Boolean);
  var verified = data.email_verified === true || String(data.email_verified || '').toLowerCase() === 'true';
  if (String(data.aud || '').trim() !== clientId) return { ok: false, email: email, message: 'Google Client ID가 일치하지 않습니다.' };
  if (!verified) return { ok: false, email: email, message: 'Google 이메일 인증 상태가 아닙니다.' };
  if (allowed.length && allowed.indexOf(email) < 0) return { ok: false, email: email, message: '허용되지 않은 Google 계정입니다.' };
  return { ok: true, email: email, name: String(data.name || email) };
}

function adminCompatCreateSession_(info) {
  var token = adminCompatRandom_(48);
  var expiresAt = Date.now() + ADMIN_COMPAT_SESSION_TTL_MS;
  PropertiesService.getScriptProperties().setProperty('ADMIN_SESSION_' + adminCompatHash_(token), JSON.stringify({
    createdAt: Date.now(),
    expiresAt: expiresAt,
    loginType: info.loginType || '',
    adminId: info.adminId || '',
    email: info.email || '',
    name: info.name || '',
    role: info.role || 'ADMIN'
  }));
  return { token: token, expiresAt: expiresAt };
}

function adminCompatSession_(token) {
  if (!token) return null;
  var props = PropertiesService.getScriptProperties();
  var key = 'ADMIN_SESSION_' + adminCompatHash_(token);
  var raw = props.getProperty(key);
  if (!raw) return null;
  try {
    var session = JSON.parse(raw);
    if (!session.expiresAt || Number(session.expiresAt) <= Date.now()) {
      props.deleteProperty(key);
      return null;
    }
    return session;
  } catch (error) {
    props.deleteProperty(key);
    return null;
  }
}

function requireAuth_(params) {
  var token = String(params && params.sessionToken || '').trim();
  var session = adminCompatSession_(token);
  if (!session) return studentFail_('ADMIN_AUTH_REQUIRED', '관리자 로그인이 필요합니다.');
  return {
    ok: true,
    loginType: session.loginType || '',
    adminId: session.adminId || '',
    email: session.email || '',
    name: session.name || session.email || session.adminId || '',
    role: session.role || 'ADMIN',
    expiresAt: session.expiresAt
  };
}

function adminCompatRequire_(params) {
  var auth = requireAuth_(params);
  if (!auth.ok) {
    var error = new Error(auth.message || '관리자 로그인이 필요합니다.');
    error.code = auth.code || 'ADMIN_AUTH_REQUIRED';
    throw error;
  }
  return auth;
}

function adminCompatReauth_(params) {
  var auth = requireAuth_(params);
  if (!auth.ok) return auth;
  return { ok: true, name: auth.name || '', role: auth.role || '', version: ADMIN_COMPAT_VERSION };
}

function adminCompatLoginEvent_(params) {
  var auth = requireAuth_(params);
  if (!auth.ok) return auth;
  return { ok: true, message: '관리자 로그인 기록 완료', version: ADMIN_COMPAT_VERSION };
}

function adminCompatPasskeyUnavailable_() {
  return studentFail_('PASSKEY_RE_REGISTER_REQUIRED', '서버 교체 후 패스키를 다시 등록해야 합니다. 관리자 ID 또는 Google 로그인으로 접속하세요.');
}

function adminCompatDeletePasskey_(params) {
  var auth = requireAuth_(params);
  if (!auth.ok) return auth;
  return { ok: true, deleted: true, message: '이 기기의 기존 패스키 등록을 초기화했습니다.' };
}

function adminCompatServerStatus_(params) {
  var auth = requireAuth_(params);
  if (!auth.ok && String(params.public || '') !== '1') return auth;
  var ss = studentOpenSpreadsheet_();
  return {
    ok: true,
    version: ADMIN_COMPAT_VERSION,
    serverVersion: ADMIN_COMPAT_VERSION,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    schoolName: STUDENT_SCHOOL_NAME,
    radiusM: STUDENT_SCHOOL_RADIUS_M,
    sheets: ss.getSheets().map(function (sheet) { return sheet.getName(); })
  };
}

function adminCompatLogSchemaStatus_(params) {
  var auth = requireAuth_(params);
  if (!auth.ok) return auth;
  var sheet = adminCompatSheet_(ADMIN_COMPAT_LOGS_SHEET);
  return { ok: true, headers: studentHeaders_(sheet), rowCount: Math.max(0, sheet.getLastRow() - 1), version: ADMIN_COMPAT_VERSION };
}

function adminCompatTodayLogs_(params) {
  var auth = requireAuth_(params);
  if (!auth.ok) return auth;
  var timezone = adminCompatGetSetting_('timezone', 'Asia/Seoul');
  var today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  var roster = adminCompatRoster_();
  var raw = adminCompatLogsForDate_(today, timezone);
  var byFinger = {};
  raw.forEach(function (row) {
    var key = String(row.fingerId || '');
    if (key && !byFinger[key]) byFinger[key] = row;
  });
  var logs = roster.map(function (user) {
    var found = byFinger[String(user.fingerId || '')];
    return found || { timestamp: '', time: '-', status: '미출석', fingerId: user.fingerId, name: user.name, message: '' };
  });
  raw.forEach(function (row) {
    if (!byFinger[String(row.fingerId || '')] || roster.some(function (user) { return String(user.fingerId) === String(row.fingerId); })) return;
    logs.push(row);
  });
  var summary = { total: roster.length || logs.length, present: 0, late: 0, absent: 0, notYet: 0 };
  logs.forEach(function (row) {
    var status = String(row.status || '');
    if (status.indexOf('지각') >= 0) summary.late++;
    else if (status.indexOf('출석') >= 0 && status.indexOf('미출석') < 0) summary.present++;
    else if (status.indexOf('결석') >= 0) summary.absent++;
    else summary.notYet++;
  });
  return { ok: true, date: today, logs: logs, summary: summary, registeredStudentCount: roster.length || logs.length, studentCount: roster.length || logs.length };
}

function adminCompatLogsByDate_(params) {
  var auth = requireAuth_(params);
  if (!auth.ok) return auth;
  var date = String(params.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return studentFail_('DATE_REQUIRED', '조회 날짜를 yyyy-MM-dd 형식으로 입력하세요.');
  return { ok: true, date: date, logs: adminCompatLogsForDate_(date, adminCompatGetSetting_('timezone', 'Asia/Seoul')), sourceSheet: ADMIN_COMPAT_LOGS_SHEET, serverVersion: ADMIN_COMPAT_VERSION };
}

function adminCompatRoster_() {
  var users = studentRows_(adminCompatSheet_(ADMIN_COMPAT_USERS_SHEET)).filter(function (row) {
    return adminCompatTrue_(adminCompatValue_(row, ['active', '활성', '사용', '활성여부'], true));
  }).map(function (row) {
    return { name: String(adminCompatValue_(row, ['name', '이름', '학생이름', '성명'], '')), fingerId: String(adminCompatValue_(row, ['fingerId', 'fingerID', '지문ID', '지문번호'], '')) };
  }).filter(function (row) { return row.fingerId || row.name; });
  if (users.length) return users;
  return studentRows_(adminCompatSheet_(STUDENT_ACCOUNT_SHEET)).filter(function (row) { return adminCompatTrue_(row.active); }).map(function (row) {
    return { name: String(row.name || ''), fingerId: String(row.fingerId || '') };
  });
}

function adminCompatLogsForDate_(date, timezone) {
  return studentRows_(adminCompatSheet_(ADMIN_COMPAT_LOGS_SHEET)).map(function (row) {
    var timestamp = adminCompatValue_(row, ['timestamp', '타임스탬프', '일시', '기록일시'], '');
    var rowDate = String(adminCompatValue_(row, ['date', '날짜', '일자'], '')).trim();
    if (!rowDate && timestamp) {
      var parsed = timestamp instanceof Date ? timestamp : new Date(timestamp);
      if (isFinite(parsed.getTime())) rowDate = Utilities.formatDate(parsed, timezone, 'yyyy-MM-dd');
    }
    return {
      _date: rowDate,
      timestamp: timestamp,
      time: String(adminCompatValue_(row, ['time', '시간', '시각'], timestamp || '-')),
      status: String(adminCompatValue_(row, ['status', '상태', '출석상태', '결과'], '')),
      fingerId: String(adminCompatValue_(row, ['fingerId', 'fingerID', '지문ID', '지문번호'], '')),
      name: String(adminCompatValue_(row, ['name', '이름', '학생이름', '성명'], '')),
      message: String(adminCompatValue_(row, ['message', '메시지', '내용'], ''))
    };
  }).filter(function (row) { return row._date === date; }).map(function (row) { delete row._date; return row; });
}

function adminCompatGetSettings_(params) {
  var auth = requireAuth_(params);
  if (!auth.ok) return auth;
  return { ok: true, secureMode: true, settings: { espOfflineSec: adminCompatGetSetting_('espOfflineSec', '25'), pollingIntervalSec: '10' } };
}

function adminCompatSaveSettings_(params) {
  var auth = requireAuth_(params);
  if (!auth.ok) return auth;
  if (params.espOfflineSec != null) adminCompatSetSetting_('espOfflineSec', String(params.espOfflineSec));
  return { ok: true, secureMode: true, message: '설정을 저장했습니다.' };
}

function adminCompatPushConfig_() { return { ok: true, enabled: false, firebase: null, vapidKey: '' }; }
function adminCompatSavePushToken_(params) { var auth = requireAuth_(params); return auth.ok ? { ok: true, saved: false, disabled: true } : auth; }
function adminCompatSaveStudentPushToken_() { return { ok: true, saved: false, disabled: true }; }
function adminCompatTestPush_(params) { var auth = requireAuth_(params); return auth.ok ? { ok: true, sent: 0, disabled: true, message: '푸시 설정이 없어 테스트를 건너뛰었습니다.' } : auth; }

function adminCompatAppendLoginLog_(adminId, role, message, params) {
  try {
    var now = new Date();
    var timezone = adminCompatGetSetting_('timezone', 'Asia/Seoul');
    studentAppendObject_(adminCompatSheet_(ADMIN_COMPAT_LOGIN_LOGS_SHEET), ADMIN_COMPAT_LOGIN_LOG_HEADERS, {
      timestamp: now,
      date: Utilities.formatDate(now, timezone, 'yyyy-MM-dd'),
      time: Utilities.formatDate(now, timezone, 'HH:mm:ss'),
      adminId: String(adminId || ''),
      role: String(role || ''),
      deviceName: String(params.deviceName || '').slice(0, 100),
      screenSize: String(params.screenSize || '').slice(0, 40),
      clientTime: String(params.clientTime || '').slice(0, 80),
      clientTimezone: String(params.clientTimezone || '').slice(0, 80),
      userAgent: String(params.userAgent || '').slice(0, 180),
      message: String(message || '').slice(0, 200)
    });
  } catch (error) {}
}

function adminCompatSheet_(name) { return studentOpenSpreadsheet_().getSheetByName(name); }
function adminCompatValue_(row, keys, fallback) { for (var i = 0; i < keys.length; i++) if (row[keys[i]] != null && row[keys[i]] !== '') return row[keys[i]]; return fallback; }
function adminCompatTrue_(value) { if (value === true || value === 1) return true; var text = String(value == null ? '' : value).trim().toLowerCase(); return text === '' || text === '1' || text === 'true' || text === 'yes' || text === 'y' || text === '활성' || text === '사용'; }
function adminCompatHash_(value) { var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8); return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, ''); }
function adminCompatRandom_(bytes) { return adminCompatHash_(Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + Date.now() + '|' + Math.random()).slice(0, Math.max(16, bytes * 2)); }
function adminCompatConstantEqual_(a, b) { a = String(a || ''); b = String(b || ''); var mismatch = a.length ^ b.length; var length = Math.max(a.length, b.length); for (var i = 0; i < length; i++) mismatch |= (a.charCodeAt(i % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(i % Math.max(1, b.length)) || 0); return mismatch === 0; }
function adminCompatSalt_() { var props = PropertiesService.getScriptProperties(); var salt = props.getProperty('ADMIN_LOGIN_SALT_V2'); if (!salt) { salt = adminCompatRandom_(48); props.setProperty('ADMIN_LOGIN_SALT_V2', salt); } return salt; }
function adminCompatGetSetting_(key, fallback) { return studentGetSetting_(key, fallback); }
function adminCompatSetSetting_(key, value) { studentSetSetting_(key, value); }
function adminCompatEnsureSetting_(key, value) { var current = adminCompatGetSetting_(key, null); if (current == null || current === '') adminCompatSetSetting_(key, value); }

/* ==========================================================================
 * 개인정보·보안 POST·권한 시트 통합 모듈
 * ========================================================================== */

/*
 * 2-12 출석 시스템 - 학생 개인정보 권한/동의/복구 최종 코드
 * 버전: 2026-07-16-v2
 *
 * 필수 선행 파일:
 *   student-auth-addon.gs
 *
 * 이 파일 하나에 아래 기능이 포함됩니다.
 * - 학생 개인정보 동의 저장/조회/철회
 * - 위치 포함 필수 5개 동의 강제 검증
 * - 선택 5개 권한 저장
 * - 계정별 학생개인정보권한 시트
 * - 학생개인정보동의로그 시트
 * - 시스템오류알림 시트 및 관리자 알림
 * - 관리자 직접 비밀번호 설정
 * - 개인정보/비밀번호 POST 응답
 */

var STUDENT_PRIVACY_PERMISSION_SHEET = '학생개인정보권한';
var STUDENT_PRIVACY_AUDIT_SHEET = '학생개인정보동의로그';
var STUDENT_FALLBACK_EVENT_SHEET = '시스템오류알림';
var STUDENT_PRIVACY_ADMIN_EMAIL = 'junho.eum.travel@gmail.com';
var STUDENT_PRIVACY_CURRENT_VERSION = '2026-07-16-v2';

var STUDENT_PRIVACY_PERMISSION_HEADERS = [
  'updatedAt', 'studentId', 'name', 'fingerId', 'status', 'consentVersion', 'requiredAccepted',
  'privacyRequired', 'locationRequired', 'accountRequired', 'deviceRequired', 'policyRequired',
  'pushOptional', 'diagnosticsOptional', 'updatesOptional', 'rememberOptional', 'backgroundLocationOptional',
  'ageBand', 'guardianConfirmed', 'guardianName', 'consentedAt', 'withdrawnAt', 'source',
  'deviceName', 'userAgent', 'clientTime', 'clientTimezone'
];

var STUDENT_PRIVACY_AUDIT_HEADERS = [
  'timestamp', 'eventType', 'studentId', 'name', 'fingerId', 'status', 'consentVersion', 'requiredAccepted',
  'privacyRequired', 'locationRequired', 'accountRequired', 'deviceRequired', 'policyRequired',
  'pushOptional', 'diagnosticsOptional', 'updatesOptional', 'rememberOptional', 'backgroundLocationOptional',
  'ageBand', 'guardianConfirmed', 'guardianName', 'source', 'deviceName', 'userAgent',
  'clientTime', 'clientTimezone'
];

var STUDENT_FALLBACK_EVENT_HEADERS = [
  'createdAt', 'eventId', 'errorType', 'message', 'sourcePage', 'fallbackUrl',
  'studentId', 'studentName', 'online', 'deviceName', 'userAgent',
  'clientTimezone', 'status', 'notifiedAt'
];

/* ---------- doGet 연결점 ---------- */

function handleStudentPrivacyAction_(action, e) {
  var handlers = {
    studentSavePrivacyConsentJsonp: studentSavePrivacyConsentJsonp_,
    studentPrivacyStatusJsonp: studentPrivacyStatusJsonp_,
    studentWithdrawPrivacyConsentJsonp: studentWithdrawPrivacyConsentJsonp_,
    adminPrivacyPermissionsJsonp: adminPrivacyPermissionsJsonp_,
    adminSetStudentPasswordJsonp: adminSetStudentPasswordJsonp_,
    studentFallbackEventJsonp: studentFallbackEventJsonp_,
    adminFallbackEventsJsonp: adminFallbackEventsJsonp_
  };

  if (!handlers[action]) return null;

  try {
    return studentJsonp_(e, handlers[action](e));
  } catch (error) {
    return studentJsonp_(e, {
      ok: false,
      code: error && error.code || 'STUDENT_PRIVACY_SERVER_ERROR',
      message: error && error.message || String(error)
    });
  }
}

/* ---------- doPost 연결점 ---------- */

function handleStudentSecurePost_(e) {
  var p = e && e.parameter || {};
  var action = String(p.action || '');

  if (action === 'adminSetStudentPasswordPost') {
    return studentSecurePostExecute_(
      e,
      'attendance-admin-password-post',
      adminSetStudentPasswordJsonp_
    );
  }

  if (action === 'studentSavePrivacyConsentPost') {
    return studentSecurePostExecute_(
      e,
      'attendance-student-privacy-post',
      studentSavePrivacyConsentJsonp_
    );
  }

  if (action === 'studentWithdrawPrivacyConsentPost') {
    return studentSecurePostExecute_(
      e,
      'attendance-student-privacy-post',
      studentWithdrawPrivacyConsentJsonp_
    );
  }

  return null;
}

/* 이전 함수명 호환 */
function handleStudentPasswordPost_(e) {
  return handleStudentSecurePost_(e);
}

/* ---------- 최초 설치 ---------- */

function setupStudentPrivacyResilience_() {
  var ss = studentOpenSpreadsheet_();

  studentEnsureSheet_(
    ss,
    STUDENT_PRIVACY_PERMISSION_SHEET,
    STUDENT_PRIVACY_PERMISSION_HEADERS
  );
  studentEnsureSheet_(
    ss,
    STUDENT_PRIVACY_AUDIT_SHEET,
    STUDENT_PRIVACY_AUDIT_HEADERS
  );
  studentEnsureSheet_(
    ss,
    STUDENT_FALLBACK_EVENT_SHEET,
    STUDENT_FALLBACK_EVENT_HEADERS
  );

  return true;
}

/* 수동 실행용 최종 설치 함수 */
function setupStudentPrivacyFinal_() {
  setupStudentAuth_();
  setupStudentPrivacyResilience_();

  return {
    ok: true,
    version: STUDENT_PRIVACY_CURRENT_VERSION,
    sheets: [
      STUDENT_PRIVACY_PERMISSION_SHEET,
      STUDENT_PRIVACY_AUDIT_SHEET,
      STUDENT_FALLBACK_EVENT_SHEET
    ]
  };
}

/* ---------- 학생 개인정보 동의 ---------- */

function studentSavePrivacyConsentJsonp_(e) {
  setupStudentPrivacyResilience_();

  var p = e && e.parameter || {};
  var session = studentFindSession_(String(p.studentToken || ''));

  if (!session) {
    return studentFail_(
      'STUDENT_AUTH_REQUIRED',
      '학생 로그인이 필요합니다.'
    );
  }

  var requiredKeys = [
    'privacyRequired',
    'locationRequired',
    'accountRequired',
    'deviceRequired',
    'policyRequired'
  ];

  var requiredAccepted = requiredKeys.every(function (key) {
    return privacyStrictTrue_(p[key]);
  });

  if (!requiredAccepted) {
    return studentFail_(
      'PRIVACY_REQUIRED_CONSENT_MISSING',
      '위치 정보를 포함한 모든 필수 항목에 동의해야 합니다.'
    );
  }

  var now = new Date();
  var existing = privacyFindPermission_(session.studentId);
  var consentedAt =
    existing && existing.consentedAt
      ? existing.consentedAt
      : now;

  var record = {
    updatedAt: now,
    studentId: String(session.studentId || ''),
    name: String(session.name || ''),
    fingerId: String(session.fingerId || ''),
    status: 'ACTIVE',
    consentVersion: privacyClean_(
      p.consentVersion || STUDENT_PRIVACY_CURRENT_VERSION,
      60
    ),

    requiredAccepted: true,
    privacyRequired: true,
    locationRequired: true,
    accountRequired: true,
    deviceRequired: true,
    policyRequired: true,

    pushOptional: privacyStrictTrue_(p.pushOptional),
    diagnosticsOptional: privacyStrictTrue_(p.diagnosticsOptional),
    updatesOptional: privacyStrictTrue_(p.updatesOptional),
    rememberOptional: privacyStrictTrue_(p.rememberOptional),
    backgroundLocationOptional: privacyStrictTrue_(
      p.backgroundLocationOptional
    ),

    /* 연령 선택 기능은 화면에서 제거됨. 기존 시트 호환값만 유지 */
    ageBand: '14_PLUS',
    guardianConfirmed: false,
    guardianName: '',

    consentedAt: consentedAt,
    withdrawnAt: '',
    source: privacyClean_(p.source || 'student-web', 80),
    deviceName: privacyClean_(p.deviceName, 100),
    userAgent: privacyClean_(p.userAgent, 180),
    clientTime: privacyClean_(p.clientTime, 80),
    clientTimezone: privacyClean_(p.clientTimezone, 80)
  };

  privacyUpsertPermission_(record);
  privacyAppendAudit_('CONSENT_SAVE', record);

  return {
    ok: true,
    consent: privacyPublicConsent_(record)
  };
}

function studentPrivacyStatusJsonp_(e) {
  setupStudentPrivacyResilience_();

  var p = e && e.parameter || {};
  var session = studentFindSession_(String(p.studentToken || ''));

  if (!session) {
    return studentFail_(
      'STUDENT_AUTH_REQUIRED',
      '학생 로그인이 필요합니다.'
    );
  }

  var record = privacyFindPermission_(session.studentId);

  return {
    ok: true,
    consent: record ? privacyPublicConsent_(record) : null
  };
}

function studentWithdrawPrivacyConsentJsonp_(e) {
  setupStudentPrivacyResilience_();

  var p = e && e.parameter || {};
  var session = studentFindSession_(String(p.studentToken || ''));

  if (!session) {
    return studentFail_(
      'STUDENT_AUTH_REQUIRED',
      '학생 로그인이 필요합니다.'
    );
  }

  var record = privacyFindPermission_(session.studentId);

  if (!record) {
    return studentFail_(
      'PRIVACY_CONSENT_NOT_FOUND',
      '저장된 개인정보 동의를 찾지 못했습니다.'
    );
  }

  var now = new Date();

  studentUpdateRow_(
    studentSheet_(STUDENT_PRIVACY_PERMISSION_SHEET),
    record._row,
    {
      updatedAt: now,
      status: 'WITHDRAWN',
      requiredAccepted: false,
      privacyRequired: false,
      locationRequired: false,
      accountRequired: false,
      deviceRequired: false,
      policyRequired: false,
      withdrawnAt: now,
      source: 'student-web-withdrawal'
    }
  );

  var refreshed = privacyFindPermission_(session.studentId);
  privacyAppendAudit_('CONSENT_WITHDRAW', refreshed);
  studentDeactivateSessions_(session.studentId);

  return {
    ok: true,
    status: 'WITHDRAWN',
    studentId: String(session.studentId || '')
  };
}

/* ---------- 관리자 개인정보 권한 현황 ---------- */

function adminPrivacyPermissionsJsonp_(e) {
  setupStudentPrivacyResilience_();
  studentRequireAdmin_(e);

  var permissions = {};

  studentRows_(
    studentSheet_(STUDENT_PRIVACY_PERMISSION_SHEET)
  ).forEach(function (row) {
    permissions[String(row.studentId || '')] = row;
  });

  var result = studentRows_(
    studentSheet_(STUDENT_ACCOUNT_SHEET)
  ).map(function (account) {
    var permission =
      permissions[String(account.studentId || '')] || null;

    if (!permission) {
      return {
        studentId: String(account.studentId || ''),
        name: String(account.name || ''),
        fingerId: String(account.fingerId || ''),
        status: 'MISSING',
        requiredAccepted: false,
        privacyRequired: false,
        locationRequired: false,
        accountRequired: false,
        deviceRequired: false,
        policyRequired: false,
        pushOptional: false,
        diagnosticsOptional: false,
        updatesOptional: false,
        rememberOptional: false,
        backgroundLocationOptional: false
      };
    }

    var output = privacyPublicConsent_(permission);
    output.name = String(account.name || output.name || '');
    output.fingerId = String(
      account.fingerId || output.fingerId || ''
    );

    return output;
  });

  result.sort(function (a, b) {
    var fingerA = Number(a.fingerId);
    var fingerB = Number(b.fingerId);

    if (
      isFinite(fingerA) &&
      isFinite(fingerB) &&
      fingerA !== fingerB
    ) {
      return fingerA - fingerB;
    }

    return String(a.name || a.studentId).localeCompare(
      String(b.name || b.studentId),
      'ko'
    );
  });

  return {
    ok: true,
    count: result.length,
    permissions: result
  };
}

/* ---------- 관리자 학생 비밀번호 직접 설정 ---------- */

function adminSetStudentPasswordJsonp_(e) {
  setupStudentPrivacyResilience_();

  var admin = studentRequireAdmin_(e) || {};
  var p = e && e.parameter || {};
  var studentId = privacyClean_(p.studentId, 40);
  var password = String(p.password || '');
  var account = studentFindAccount_(studentId);

  if (!account) {
    return studentFail_(
      'STUDENT_ACCOUNT_NOT_FOUND',
      '학생계정을 찾지 못했습니다.'
    );
  }

  if (
    password.length < 8 ||
    password.length > 64 ||
    !/[A-Za-z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return studentFail_(
      'STUDENT_PASSWORD_POLICY',
      '비밀번호는 영문과 숫자를 포함해 8~64자로 설정하세요.'
    );
  }

  studentUpdateRow_(
    studentSheet_(STUDENT_ACCOUNT_SHEET),
    account._row,
    {
      initialPassword: '',
      passwordHash: studentPasswordHash_(password),
      updatedAt: new Date()
    }
  );

  var deactivated = studentDeactivateSessions_(studentId);

  privacyAppendSecurityEvent_(
    'ADMIN_PASSWORD_SET',
    studentId,
    account.name,
    {
      admin: String(
        admin.name ||
        admin.email ||
        admin.adminId ||
        'ADMIN'
      ),
      deactivatedSessions: deactivated
    }
  );

  return {
    ok: true,
    studentId: studentId,
    name: String(account.name || ''),
    deactivatedSessions: deactivated
  };
}

/* ---------- 백업 경로 및 오류 알림 ---------- */

function studentFallbackEventJsonp_(e) {
  setupStudentPrivacyResilience_();

  var p = e && e.parameter || {};
  var studentId = privacyClean_(p.studentId, 40);
  var studentName = privacyClean_(p.studentName, 80);
  var token = String(p.studentToken || '');

  if (token) {
    try {
      var session = studentFindSession_(token);

      if (session) {
        studentId = String(session.studentId || studentId);
        studentName = String(session.name || studentName);
      }
    } catch (error) {}
  }

  var eventId = privacyClean_(
    p.eventId || ('FB-' + new Date().getTime()),
    80
  );
  var errorType = privacyClean_(p.errorType || 'UNKNOWN', 80);
  var message = privacyClean_(
    p.message || '오류 내용 없음',
    500
  );
  var sourcePage = privacyClean_(p.sourcePage, 500);
  var fallbackUrl = privacyClean_(p.fallbackUrl, 500);
  var now = new Date();

  var notificationKey =
    'STUDENT_FALLBACK_NOTIFY_' +
    studentHash_(errorType + '|' + sourcePage).slice(0, 32);

  var cache = CacheService.getScriptCache();
  var shouldNotify = !cache.get(notificationKey);
  var status = shouldNotify ? 'NOTIFIED' : 'RATE_LIMITED';
  var notifiedAt = shouldNotify ? now : '';

  if (shouldNotify) {
    cache.put(notificationKey, '1', 600);

    var title = '2-12 출석 백업 시스템 작동';
    var body =
      '[' +
      errorType +
      '] ' +
      (studentName || studentId || '비로그인 사용자') +
      ' · ' +
      message.slice(0, 120);

    studentTryPushAdmin_({
      title: title,
      body: body,
      url:
        'https://212attendence.github.io/admin/system-health/'
    });

    try {
      MailApp.sendEmail({
        to: STUDENT_PRIVACY_ADMIN_EMAIL,
        subject: title + ' - ' + errorType,
        htmlBody:
          '<h2>' +
          privacyHtml_(title) +
          '</h2>' +
          '<p><strong>오류 유형:</strong> ' +
          privacyHtml_(errorType) +
          '</p>' +
          '<p><strong>학생:</strong> ' +
          privacyHtml_(
            studentName || studentId || '비로그인'
          ) +
          '</p>' +
          '<p><strong>내용:</strong> ' +
          privacyHtml_(message) +
          '</p>' +
          '<p><strong>발생 페이지:</strong> ' +
          privacyHtml_(sourcePage) +
          '</p>' +
          '<p><strong>백업 경로:</strong> ' +
          privacyHtml_(fallbackUrl) +
          '</p>' +
          '<p><a href="https://212attendence.github.io/admin/system-health/">' +
          '시스템 상태 열기</a></p>'
      });
    } catch (mailError) {
      status = 'PUSH_ONLY';
    }
  }

  studentAppendObject_(
    studentSheet_(STUDENT_FALLBACK_EVENT_SHEET),
    STUDENT_FALLBACK_EVENT_HEADERS,
    {
      createdAt: now,
      eventId: eventId,
      errorType: errorType,
      message: message,
      sourcePage: sourcePage,
      fallbackUrl: fallbackUrl,
      studentId: studentId,
      studentName: studentName,
      online: privacyClean_(p.online, 10),
      deviceName: privacyClean_(p.deviceName, 100),
      userAgent: privacyClean_(p.userAgent, 180),
      clientTimezone: privacyClean_(p.clientTimezone, 80),
      status: status,
      notifiedAt: notifiedAt
    }
  );

  return {
    ok: true,
    eventId: eventId,
    notified: shouldNotify,
    status: status
  };
}

function adminFallbackEventsJsonp_(e) {
  setupStudentPrivacyResilience_();
  studentRequireAdmin_(e);

  var rows = studentRows_(
    studentSheet_(STUDENT_FALLBACK_EVENT_SHEET)
  );

  rows.sort(function (a, b) {
    return (
      new Date(b.createdAt).getTime() -
      new Date(a.createdAt).getTime()
    );
  });

  var since = Date.now() - 24 * 60 * 60 * 1000;

  var last24Hours = rows.filter(function (row) {
    var time = new Date(row.createdAt).getTime();
    return isFinite(time) && time >= since;
  }).length;

  return {
    ok: true,
    count: rows.length,
    last24Hours: last24Hours,
    events: rows.slice(0, 100).map(function (row) {
      return {
        createdAt: privacyDateText_(row.createdAt),
        eventId: String(row.eventId || ''),
        errorType: String(row.errorType || ''),
        message: String(row.message || ''),
        sourcePage: String(row.sourcePage || ''),
        fallbackUrl: String(row.fallbackUrl || ''),
        studentId: String(row.studentId || ''),
        studentName: String(row.studentName || ''),
        deviceName: String(row.deviceName || ''),
        status: String(row.status || '')
      };
    })
  };
}

/* ---------- 개인정보 내부 헬퍼 ---------- */

function privacyFindPermission_(studentId) {
  return studentFindBy_(
    studentSheet_(STUDENT_PRIVACY_PERMISSION_SHEET),
    'studentId',
    String(studentId || '')
  );
}

function privacyUpsertPermission_(record) {
  var sheet = studentSheet_(STUDENT_PRIVACY_PERMISSION_SHEET);
  var existing = privacyFindPermission_(record.studentId);

  if (existing) {
    studentUpdateRow_(sheet, existing._row, record);
  } else {
    studentAppendObject_(
      sheet,
      STUDENT_PRIVACY_PERMISSION_HEADERS,
      record
    );
  }
}

function privacyAppendAudit_(eventType, record) {
  if (!record) return;

  studentAppendObject_(
    studentSheet_(STUDENT_PRIVACY_AUDIT_SHEET),
    STUDENT_PRIVACY_AUDIT_HEADERS,
    {
      timestamp: new Date(),
      eventType: eventType,
      studentId: record.studentId,
      name: record.name,
      fingerId: record.fingerId,
      status: record.status,
      consentVersion: record.consentVersion,
      requiredAccepted: privacyStrictTrue_(
        record.requiredAccepted
      ),
      privacyRequired: privacyStrictTrue_(
        record.privacyRequired
      ),
      locationRequired: privacyStrictTrue_(
        record.locationRequired
      ),
      accountRequired: privacyStrictTrue_(
        record.accountRequired
      ),
      deviceRequired: privacyStrictTrue_(
        record.deviceRequired
      ),
      policyRequired: privacyStrictTrue_(
        record.policyRequired
      ),
      pushOptional: privacyStrictTrue_(record.pushOptional),
      diagnosticsOptional: privacyStrictTrue_(
        record.diagnosticsOptional
      ),
      updatesOptional: privacyStrictTrue_(
        record.updatesOptional
      ),
      rememberOptional: privacyStrictTrue_(
        record.rememberOptional
      ),
      backgroundLocationOptional: privacyStrictTrue_(
        record.backgroundLocationOptional
      ),
      ageBand: '14_PLUS',
      guardianConfirmed: false,
      guardianName: '',
      source: record.source,
      deviceName: record.deviceName,
      userAgent: record.userAgent,
      clientTime: record.clientTime,
      clientTimezone: record.clientTimezone
    }
  );
}

function privacyAppendSecurityEvent_(
  eventType,
  studentId,
  name,
  details
) {
  studentAppendObject_(
    studentSheet_(STUDENT_FALLBACK_EVENT_SHEET),
    STUDENT_FALLBACK_EVENT_HEADERS,
    {
      createdAt: new Date(),
      eventId: eventType + '-' + new Date().getTime(),
      errorType: eventType,
      message: JSON.stringify(details || {}),
      sourcePage: '/accounts-s/',
      fallbackUrl: '/admin/system-health/',
      studentId: studentId,
      studentName: name,
      online: '1',
      deviceName: 'ADMIN',
      userAgent: '',
      clientTimezone:
        Session.getScriptTimeZone() || 'Asia/Seoul',
      status: 'AUDIT',
      notifiedAt: ''
    }
  );
}

function privacyPublicConsent_(row) {
  return {
    studentId: String(row.studentId || ''),
    name: String(row.name || ''),
    fingerId: String(row.fingerId || ''),
    status: String(row.status || 'MISSING'),
    consentVersion: String(row.consentVersion || ''),

    requiredAccepted:
      privacyStrictTrue_(row.requiredAccepted) &&
      String(row.status || '').toUpperCase() === 'ACTIVE',

    privacyRequired: privacyStrictTrue_(
      row.privacyRequired
    ),
    locationRequired: privacyStrictTrue_(
      row.locationRequired
    ),
    accountRequired: privacyStrictTrue_(
      row.accountRequired
    ),
    deviceRequired: privacyStrictTrue_(
      row.deviceRequired
    ),
    policyRequired: privacyStrictTrue_(
      row.policyRequired
    ),

    pushOptional: privacyStrictTrue_(row.pushOptional),
    diagnosticsOptional: privacyStrictTrue_(
      row.diagnosticsOptional
    ),
    updatesOptional: privacyStrictTrue_(
      row.updatesOptional
    ),
    rememberOptional: privacyStrictTrue_(
      row.rememberOptional
    ),
    backgroundLocationOptional: privacyStrictTrue_(
      row.backgroundLocationOptional
    ),

    ageBand: '14_PLUS',
    guardianConfirmed: false,
    guardianName: '',

    consentedAt: privacyDateText_(row.consentedAt),
    withdrawnAt: privacyDateText_(row.withdrawnAt),
    updatedAt: privacyDateText_(row.updatedAt),
    source: String(row.source || '')
  };
}

function privacyStrictTrue_(value) {
  if (value === true || value === 1) return true;

  var text = String(
    value == null ? '' : value
  ).trim().toLowerCase();

  return (
    text === '1' ||
    text === 'true' ||
    text === 'yes' ||
    text === 'y' ||
    text === '동의' ||
    text === 'active'
  );
}

function privacyClean_(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLength || 300);
}

function privacyDateText_(value) {
  if (!value) return '';

  var date =
    value instanceof Date
      ? value
      : new Date(value);

  if (!isFinite(date.getTime())) {
    return String(value || '');
  }

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone() || 'Asia/Seoul',
    'yyyy-MM-dd HH:mm:ss'
  );
}

function privacyHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- POST 응답 헬퍼 ---------- */

function studentSecurePostExecute_(e, channel, handler) {
  var p = e && e.parameter || {};
  var responseToken = privacyClean_(p.responseToken, 100);
  var responseOrigin = privacySafeOrigin_(p.responseOrigin);
  var payload;

  try {
    payload = handler(e);
  } catch (error) {
    payload = {
      ok: false,
      code:
        error && error.code ||
        'STUDENT_SECURE_POST_ERROR',
      message:
        error && error.message ||
        String(error)
    };
  }

  return privacyPostMessageResponse_(
    responseOrigin,
    responseToken,
    channel,
    payload
  );
}

function privacySafeOrigin_(value) {
  var origin = String(value || '');

  if (origin === 'https://212attendence.github.io') {
    return origin;
  }

  return 'https://212attendence.github.io';
}

function privacyPostMessageResponse_(
  origin,
  responseToken,
  channel,
  payload
) {
  var data = {
    channel: String(
      channel || 'attendance-secure-post'
    ),
    responseToken: String(responseToken || ''),
    payload:
      payload ||
      {
        ok: false,
        message: '응답이 없습니다.'
      }
  };

  var html =
    '<!DOCTYPE html><html><head>' +
    '<meta charset="UTF-8"></head><body>' +
    '<script>' +
    'window.parent.postMessage(' +
    JSON.stringify(data).replace(/</g, '\\u003c') +
    ',' +
    JSON.stringify(origin) +
    ');' +
    '<\/script></body></html>';

  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(
      HtmlService.XFrameOptionsMode.ALLOWALL
    );
}

/* ==========================================================================
 * 서버 V6 단일 진입점·승인·시트 동기화·패스키 모듈
 * ========================================================================== */

/*
 * 2-12 출석 시스템 서버 V6 안정화 모듈
 * - 학생 승인 결과 전달 보강
 * - 기존 사용자/설정 시트 인원 동기화
 * - WebAuthn 패스키 등록/로그인/삭제
 * - dashboard ping/version 호환
 */

var V6_SERVER_VERSION = '2026-07-18-server-v6.1';
var V6_PASSKEY_REQUEST_TTL_SEC = 300;
var V6_ALLOWED_ORIGIN = 'https://212attendence.github.io';
var V6_RP_ID = '212attendence.github.io';
var V6_RP_NAME = '2-12 출석 관리자';

/* 마지막에 대입하여 기존 통합 파일의 버전 검사를 V6로 통일한다. */
STUDENT_SYSTEM_VERSION = V6_SERVER_VERSION;
ADMIN_COMPAT_VERSION = V6_SERVER_VERSION;

function doGet(e) {
  var p = e && e.parameter || {};
  var action = String(p.action || '').trim();
  try {
    if (!action || action === 'health' || action === 'healthJsonp' || action === 'ping') {
      return studentJsonp_(e, v6PublicStatus_());
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
      version: V6_SERVER_VERSION
    });
  } catch (error) {
    return studentJsonp_(e, {
      ok: false,
      code: error && error.code || 'SERVER_ERROR',
      message: error && error.message || String(error),
      version: V6_SERVER_VERSION
    });
  }
}

function v6PublicStatus_() {
  var diagnostics = v6RosterDiagnostics_();
  return {
    ok: true,
    service: '2-12-full-system',
    version: V6_SERVER_VERSION,
    serverVersion: V6_SERVER_VERSION,
    serverV6: true,
    spreadsheetId: STUDENT_SYSTEM_SPREADSHEET_ID,
    registeredStudentCount: diagnostics.registeredStudentCount,
    rosterSource: diagnostics.source
  };
}

function handleAdminCompatAction_(action, e) {
  var handlers = {
    ping: function () { return v6PublicStatus_(); },
    adminLoginChallengeJsonp: adminCompatLoginChallenge_,
    dashboardLoginProofJsonp: adminCompatLoginProof_,
    dashboardLoginJsonp: adminCompatLegacyLogin_,
    googleLoginJsonp: adminCompatGoogleLogin_,
    reauthJsonp: adminCompatReauth_,
    adminLoginEventJsonp: adminCompatLoginEvent_,
    serverStatusJsonp: adminCompatServerStatus_,
    diagnosticsJsonp: adminCompatServerStatus_,
    logSchemaStatusJsonp: adminCompatLogSchemaStatus_,
    todayLogs: adminCompatTodayLogs_,
    logsByDate: adminCompatLogsByDate_,
    getDashboardSettingsJsonp: adminCompatGetSettings_,
    saveDashboardSettingsJsonp: adminCompatSaveSettings_,
    pushClientConfigJsonp: adminCompatPushConfig_,
    savePushTokenJsonp: adminCompatSavePushToken_,
    saveStudentPushTokenJsonp: adminCompatSaveStudentPushToken_,
    testPushJsonp: adminCompatTestPush_,
    passkeyRegisterOptionsJsonp: v6PasskeyRegisterOptions_,
    passkeyRegisterVerifyJsonp: v6PasskeyRegisterVerify_,
    passkeyLoginOptionsJsonp: v6PasskeyLoginOptions_,
    passkeyLoginVerifyJsonp: v6PasskeyLoginVerify_,
    deletePasskeyJsonp: v6DeletePasskey_
  };
  if (!handlers[action]) return null;
  try {
    adminCompatSetup_();
    return studentJsonp_(e, handlers[action](e && e.parameter || {}));
  } catch (error) {
    return studentJsonp_(e, {
      ok: false,
      code: error && error.code || 'ADMIN_V6_SERVER_ERROR',
      message: error && error.message || String(error),
      version: V6_SERVER_VERSION
    });
  }
}

function INSTALL_2_12_STUDENT_SYSTEM() {
  adminCompatSetup_();
  var student = setupStudentPrivacyFinal_();
  v6EnsurePasskeySheet_();
  var roster = v6RosterDiagnostics_();
  SpreadsheetApp.flush();
  return {
    ok: true,
    version: V6_SERVER_VERSION,
    serverV6: true,
    student: student,
    admin: true,
    registeredStudentCount: roster.registeredStudentCount,
    rosterSource: roster.source
  };
}

function TEST_2_12_V6_SERVER() {
  var status = v6PublicStatus_();
  var ss = studentOpenSpreadsheet_();
  return {
    ok: status.ok && String(status.version).indexOf('server-v6') >= 0,
    version: status.version,
    spreadsheetId: ss.getId(),
    registeredStudentCount: status.registeredStudentCount,
    rosterSource: status.rosterSource,
    passkeySheet: Boolean(ss.getSheetByName(ADMIN_COMPAT_PASSKEY_SHEET))
  };
}

/* --------------------------------------------------------------------------
 * 학생 승인 안정화
 * -------------------------------------------------------------------------- */

function adminDecideStudentRequestJsonp_(e) {
  setupStudentAuth_();
  var admin = studentRequireAdmin_(e) || {};
  var p = e && e.parameter || {};
  var requestId = String(p.requestId || '').trim();
  var rawDecision = String(p.decision || p.status || p.result || '').trim().toUpperCase();
  var decision = '';
  if (rawDecision === 'APPROVED' || rawDecision === 'APPROVE' || rawDecision === 'ACCEPT' || rawDecision === '1' || rawDecision === '승인') decision = 'APPROVED';
  if (rawDecision === 'DENIED' || rawDecision === 'DENY' || rawDecision === 'REJECT' || rawDecision === '0' || rawDecision === '거절') decision = 'DENIED';
  if (!requestId) return studentFail_('REQUEST_ID_REQUIRED', '로그인 요청 ID가 없습니다.');
  if (!decision) return studentFail_('DECISION_INVALID', '승인 또는 거절을 선택하세요.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = studentSheet_(STUDENT_REQUEST_SHEET);
    var request = studentFindBy_(sheet, 'requestId', requestId);
    if (!request) return studentFail_('STUDENT_REQUEST_NOT_FOUND', '로그인 요청을 찾지 못했습니다.');
    var current = String(request.status || 'PENDING').trim().toUpperCase();
    if (current === decision) {
      return { ok: true, status: decision, requestId: requestId, alreadyProcessed: true, version: V6_SERVER_VERSION };
    }
    if (current !== 'PENDING') return studentFail_('STUDENT_REQUEST_ALREADY_DECIDED', '이미 처리된 요청입니다.');

    var token = '';
    if (decision === 'APPROVED') {
      request.status = 'APPROVED';
      token = studentIssueSession_(request);
      PropertiesService.getScriptProperties().setProperty('STUDENT_APPROVAL_TOKEN_' + requestId, token);
      PropertiesService.getScriptProperties().setProperty('STUDENT_APPROVAL_RESULT_' + requestId, JSON.stringify({
        status: 'APPROVED',
        studentToken: token,
        studentId: String(request.studentId || ''),
        name: String(request.name || ''),
        fingerId: String(request.fingerId || ''),
        secretHash: String(request.secretHash || ''),
        decidedAt: Date.now()
      }));
    }

    studentUpdateRow_(sheet, request._row, {
      status: decision,
      decidedAt: new Date(),
      decidedBy: String(admin.name || admin.email || admin.adminId || 'ADMIN')
    });
    SpreadsheetApp.flush();
    return { ok: true, status: decision, requestId: requestId, approved: decision === 'APPROVED', version: V6_SERVER_VERSION };
  } finally {
    lock.releaseLock();
  }
}

function studentRequestStatusJsonp_(e) {
  setupStudentAuth_();
  var p = e && e.parameter || {};
  var requestId = String(p.requestId || '').trim();
  var requestSecret = String(p.requestSecret || '').trim();
  if (!requestId || !requestSecret) return studentFail_('STUDENT_REQUEST_REQUIRED', '로그인 요청 정보가 없습니다.');
  var suppliedSecretHash = studentHash_(requestSecret);
  var props = PropertiesService.getScriptProperties();
  var savedResultRaw = props.getProperty('STUDENT_APPROVAL_RESULT_' + requestId);
  if (savedResultRaw) {
    try {
      var savedResult = JSON.parse(savedResultRaw);
      if (studentConstantEqual_(String(savedResult.secretHash || ''), suppliedSecretHash)) {
        var savedToken = String(savedResult.studentToken || '');
        if (savedToken && studentFindSession_(savedToken)) {
          return {
            ok: true,
            status: 'APPROVED',
            approved: true,
            studentToken: savedToken,
            studentId: savedResult.studentId,
            name: savedResult.name,
            fingerId: savedResult.fingerId,
            version: V6_SERVER_VERSION
          };
        }
      }
    } catch (ignore) {}
  }

  var request = studentFindBy_(studentSheet_(STUDENT_REQUEST_SHEET), 'requestId', requestId);
  if (!request || !studentConstantEqual_(String(request.secretHash || ''), suppliedSecretHash)) {
    return studentFail_('STUDENT_REQUEST_NOT_FOUND', '로그인 요청을 찾지 못했습니다.');
  }
  var status = String(request.status || 'PENDING').trim().toUpperCase();
  var age = Date.now() - new Date(request.createdAt).getTime();
  if (age > STUDENT_REQUEST_TTL_MS && status === 'PENDING') {
    studentUpdateRow_(studentSheet_(STUDENT_REQUEST_SHEET), request._row, { status: 'EXPIRED' });
    SpreadsheetApp.flush();
    status = 'EXPIRED';
  }
  if (status !== 'APPROVED') return { ok: true, status: status, name: request.name, version: V6_SERVER_VERSION };

  var propertyKey = 'STUDENT_APPROVAL_TOKEN_' + requestId;
  var token = String(props.getProperty(propertyKey) || '');
  if (!token || !studentFindSession_(token)) {
    token = studentIssueSession_(request);
    props.setProperty(propertyKey, token);
  }
  props.setProperty('STUDENT_APPROVAL_RESULT_' + requestId, JSON.stringify({
    status: 'APPROVED',
    studentToken: token,
    studentId: String(request.studentId || ''),
    name: String(request.name || ''),
    fingerId: String(request.fingerId || ''),
    secretHash: String(request.secretHash || ''),
    decidedAt: request.decidedAt instanceof Date ? request.decidedAt.getTime() : Date.now()
  }));
  return {
    ok: true,
    status: 'APPROVED',
    approved: true,
    studentToken: token,
    studentId: request.studentId,
    name: request.name,
    fingerId: request.fingerId,
    version: V6_SERVER_VERSION
  };
}

/* --------------------------------------------------------------------------
 * 기존 시트 학생 수/명단 동기화
 * -------------------------------------------------------------------------- */

function v6NormalizeHeader_(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/[\s_\-()./\\]/g, '');
}

function v6HeaderIndex_(headers, aliases) {
  var normalized = headers.map(v6NormalizeHeader_);
  for (var i = 0; i < aliases.length; i++) {
    var index = normalized.indexOf(v6NormalizeHeader_(aliases[i]));
    if (index >= 0) return index;
  }
  return -1;
}

function v6RowsFromSheet_(sheet) {
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(String);
  var nameIndex = v6HeaderIndex_(headers, ['name', '이름', '학생이름', '성명', '학생명']);
  var fingerIndex = v6HeaderIndex_(headers, ['fingerId', 'fingerID', '지문ID', '지문번호', '지문']);
  var studentIdIndex = v6HeaderIndex_(headers, ['studentId', '학생ID', '아이디', '학번']);
  var activeIndex = v6HeaderIndex_(headers, ['active', '활성', '사용', '활성여부', '상태']);
  if (nameIndex < 0 && fingerIndex < 0 && studentIdIndex < 0) return [];
  return values.slice(1).map(function (row) {
    var activeValue = activeIndex >= 0 ? row[activeIndex] : true;
    return {
      name: nameIndex >= 0 ? String(row[nameIndex] || '').trim() : '',
      fingerId: fingerIndex >= 0 ? String(row[fingerIndex] || '').trim() : '',
      studentId: studentIdIndex >= 0 ? String(row[studentIdIndex] || '').trim() : '',
      active: adminCompatTrue_(activeValue)
    };
  }).filter(function (row) { return row.active && (row.name || row.fingerId || row.studentId); });
}

function v6RosterData_() {
  var ss = studentOpenSpreadsheet_();
  var sheetNames = ['사용자', '학생명단', '학생목록', '학생', '학생계정'];
  var rows = [];
  var source = '';
  for (var i = 0; i < sheetNames.length; i++) {
    var sheet = ss.getSheetByName(sheetNames[i]);
    var found = v6RowsFromSheet_(sheet);
    if (found.length) {
      rows = found;
      source = sheetNames[i];
      break;
    }
  }
  var unique = {};
  rows = rows.filter(function (row) {
    var key = row.fingerId ? 'F:' + row.fingerId : row.studentId ? 'S:' + row.studentId : 'N:' + row.name;
    if (unique[key]) return false;
    unique[key] = true;
    return true;
  });
  return { rows: rows, source: source || '없음' };
}

function v6ConfiguredStudentCount_() {
  var ss = studentOpenSpreadsheet_();
  var maxCount = 0;
  var keyAliases = ['studentCount', 'registeredStudentCount', 'totalStudents', 'userCount', '학생수', '전체학생수', '재적인원', '등록학생수', '학급인원'];
  var normalizedAliases = keyAliases.map(v6NormalizeHeader_);
  var settingSheet = ss.getSheetByName('설정');
  if (settingSheet && settingSheet.getLastRow() > 0) {
    var values = settingSheet.getDataRange().getDisplayValues();
    for (var r = 0; r < values.length; r++) {
      for (var c = 0; c < values[r].length; c++) {
        if (normalizedAliases.indexOf(v6NormalizeHeader_(values[r][c])) < 0) continue;
        var candidates = [];
        if (c + 1 < values[r].length) candidates.push(values[r][c + 1]);
        if (r + 1 < values.length && c < values[r + 1].length) candidates.push(values[r + 1][c]);
        candidates.forEach(function (candidate) {
          var number = Number(String(candidate || '').replace(/[^0-9.\-]/g, ''));
          if (isFinite(number)) maxCount = Math.max(maxCount, Math.max(0, Math.round(number)));
        });
      }
    }
  }
  ['학생수', '학급인원'].forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 1) return;
    var values = sheet.getDataRange().getDisplayValues();
    values.forEach(function (row) { row.forEach(function (cell) {
      var number = Number(String(cell || '').replace(/[^0-9.\-]/g, ''));
      if (isFinite(number)) maxCount = Math.max(maxCount, Math.max(0, Math.round(number)));
    }); });
  });
  return maxCount;
}

function v6RosterDiagnostics_() {
  var roster = v6RosterData_();
  var configured = v6ConfiguredStudentCount_();
  var accountCount = 0;
  try {
    accountCount = studentRows_(studentSheet_(STUDENT_ACCOUNT_SHEET)).filter(function (row) { return studentTruthy_(row.active); }).length;
  } catch (ignore) {}
  return {
    rows: roster.rows,
    source: roster.source,
    rosterCount: roster.rows.length,
    configuredCount: configured,
    accountCount: accountCount,
    registeredStudentCount: Math.max(roster.rows.length, configured, accountCount)
  };
}

function adminCompatRoster_() {
  return v6RosterData_().rows.map(function (row) {
    return { name: row.name || row.studentId || '', fingerId: row.fingerId || '', studentId: row.studentId || '' };
  });
}

function adminCompatTodayLogs_(params) {
  var auth = requireAuth_(params);
  if (!auth.ok) return auth;
  var timezone = adminCompatGetSetting_('timezone', 'Asia/Seoul');
  var today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  var diagnostics = v6RosterDiagnostics_();
  var roster = diagnostics.rows;
  var raw = adminCompatLogsForDate_(today, timezone);
  var byFinger = {};
  raw.forEach(function (row) {
    var key = String(row.fingerId || '');
    if (key && !byFinger[key]) byFinger[key] = row;
  });
  var logs = roster.map(function (user) {
    var found = byFinger[String(user.fingerId || '')];
    return found || { timestamp: '', time: '-', status: '미출석', fingerId: user.fingerId, name: user.name || user.studentId, message: '' };
  });
  var rosterFinger = {};
  roster.forEach(function (user) { if (user.fingerId) rosterFinger[String(user.fingerId)] = true; });
  raw.forEach(function (row) {
    if (!row.fingerId || !rosterFinger[String(row.fingerId)]) logs.push(row);
  });
  var total = Math.max(diagnostics.registeredStudentCount, logs.length);
  var summary = { total: total, present: 0, late: 0, absent: 0, notYet: 0 };
  logs.forEach(function (row) {
    var status = String(row.status || '');
    if (status.indexOf('지각') >= 0) summary.late++;
    else if (status.indexOf('출석') >= 0 && status.indexOf('미출석') < 0) summary.present++;
    else if (status.indexOf('결석') >= 0) summary.absent++;
    else summary.notYet++;
  });
  summary.notYet += Math.max(0, total - logs.length);
  return {
    ok: true,
    date: today,
    logs: logs,
    summary: summary,
    registeredStudentCount: total,
    studentCount: total,
    rosterCount: diagnostics.rosterCount,
    configuredStudentCount: diagnostics.configuredCount,
    rosterSource: diagnostics.source,
    version: V6_SERVER_VERSION,
    serverVersion: V6_SERVER_VERSION
  };
}

function adminCompatLogsByDate_(params) {
  var auth = requireAuth_(params);
  if (!auth.ok) return auth;
  var date = String(params.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return studentFail_('DATE_REQUIRED', '조회 날짜를 yyyy-MM-dd 형식으로 입력하세요.');
  return {
    ok: true,
    date: date,
    logs: adminCompatLogsForDate_(date, adminCompatGetSetting_('timezone', 'Asia/Seoul')),
    sourceSheet: ADMIN_COMPAT_LOGS_SHEET,
    version: V6_SERVER_VERSION,
    serverVersion: V6_SERVER_VERSION
  };
}

function adminCompatServerStatus_(params) {
  var auth = requireAuth_(params);
  if (!auth.ok && String(params.public || '') !== '1') return auth;
  var ss = studentOpenSpreadsheet_();
  var diagnostics = v6RosterDiagnostics_();
  return {
    ok: true,
    version: V6_SERVER_VERSION,
    serverVersion: V6_SERVER_VERSION,
    serverV6: true,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    schoolName: STUDENT_SCHOOL_NAME,
    radiusM: STUDENT_SCHOOL_RADIUS_M,
    registeredStudentCount: diagnostics.registeredStudentCount,
    rosterCount: diagnostics.rosterCount,
    configuredStudentCount: diagnostics.configuredCount,
    rosterSource: diagnostics.source,
    sheets: ss.getSheets().map(function (sheet) { return sheet.getName(); })
  };
}

/* --------------------------------------------------------------------------
 * WebAuthn passkey
 * -------------------------------------------------------------------------- */

function v6EnsurePasskeySheet_() {
  return studentEnsureSheet_(studentOpenSpreadsheet_(), ADMIN_COMPAT_PASSKEY_SHEET, ADMIN_COMPAT_PASSKEY_HEADERS);
}

function v6PasskeyRegisterOptions_(params) {
  var auth = adminCompatRequire_(params);
  v6EnsurePasskeySheet_();
  var origin = v6ValidatedOrigin_(params.origin, params.hostname);
  var requestId = v6RandomToken_(24);
  var challenge = v6RandomToken_(32);
  var identity = String(auth.email || auth.adminId || auth.name || 'admin');
  var userId = v6B64Encode_(v6Sha256_(v6Utf8Bytes_(identity)));
  var exclude = studentRows_(adminCompatSheet_(ADMIN_COMPAT_PASSKEY_SHEET)).filter(function (row) {
    return adminCompatTrue_(row.active) && String(row.loginId || '') === identity;
  }).map(function (row) { return { type: 'public-key', id: String(row.credentialId || '') }; }).filter(function (item) { return item.id; });
  CacheService.getScriptCache().put('V6_PK_REG_' + requestId, JSON.stringify({
    challenge: challenge,
    origin: origin,
    rpId: V6_RP_ID,
    identity: identity,
    loginType: auth.loginType || (auth.email ? 'google' : 'admin'),
    loginId: identity,
    displayName: auth.name || identity,
    role: auth.role || 'ADMIN',
    userId: userId,
    createdAt: Date.now()
  }), V6_PASSKEY_REQUEST_TTL_SEC);
  return {
    ok: true,
    requestId: requestId,
    version: V6_SERVER_VERSION,
    publicKey: {
      challenge: challenge,
      rp: { name: V6_RP_NAME, id: V6_RP_ID },
      user: { id: userId, name: identity, displayName: auth.name || identity },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', requireResidentKey: false, userVerification: 'required' },
      excludeCredentials: exclude
    }
  };
}

function v6PasskeyRegisterVerify_(params) {
  var auth = adminCompatRequire_(params);
  var requestId = String(params.requestId || '').trim();
  var raw = CacheService.getScriptCache().get('V6_PK_REG_' + requestId);
  if (!raw) return studentFail_('PASSKEY_REQUEST_EXPIRED', '패스키 등록 요청이 만료되었습니다. 다시 시도하세요.');
  var request = JSON.parse(raw);
  var credential = v6ParseJson_(params.credential, '패스키 등록 응답을 읽지 못했습니다.');
  var clientDataBytes = v6B64Decode_(credential && credential.response && credential.response.clientDataJSON);
  var clientData = v6ParseJson_(v6BytesToUtf8_(clientDataBytes), '패스키 등록 확인값이 올바르지 않습니다.');
  v6CheckClientData_(clientData, 'webauthn.create', request.challenge, request.origin);
  var attestationBytes = v6B64Decode_(credential && credential.response && credential.response.attestationObject);
  var parsed = v6ParseAttestation_(attestationBytes, request.rpId);
  var credentialId = String(credential.id || credential.rawId || v6B64Encode_(parsed.credentialId));
  if (!credentialId) return studentFail_('PASSKEY_CREDENTIAL_REQUIRED', '패스키 ID가 없습니다.');

  var sheet = v6EnsurePasskeySheet_();
  studentRows_(sheet).forEach(function (row) {
    if (String(row.credentialId || '') === credentialId && adminCompatTrue_(row.active)) {
      studentUpdateRow_(sheet, row._row, { active: false, lastUsedAt: new Date() });
    }
  });
  studentAppendObject_(sheet, ADMIN_COMPAT_PASSKEY_HEADERS, {
    createdAt: new Date(),
    credentialId: credentialId,
    userId: request.userId,
    loginType: request.loginType,
    loginId: request.loginId,
    displayName: request.displayName,
    role: request.role,
    publicKeyX: v6B64Encode_(parsed.x),
    publicKeyY: v6B64Encode_(parsed.y),
    alg: parsed.alg,
    signCount: parsed.signCount,
    deviceName: String(params.deviceName || '').slice(0, 120),
    userAgent: String(params.userAgent || '').slice(0, 180),
    active: true,
    lastUsedAt: new Date()
  });
  CacheService.getScriptCache().remove('V6_PK_REG_' + requestId);
  SpreadsheetApp.flush();
  return { ok: true, credentialId: credentialId, registered: true, version: V6_SERVER_VERSION, name: auth.name || request.displayName };
}

function v6PasskeyLoginOptions_(params) {
  v6EnsurePasskeySheet_();
  var credentialId = String(params.credentialId || '').trim();
  if (!credentialId) return studentFail_('PASSKEY_CREDENTIAL_REQUIRED', '등록된 패스키 정보가 없습니다.');
  var row = studentRows_(adminCompatSheet_(ADMIN_COMPAT_PASSKEY_SHEET)).filter(function (item) {
    return adminCompatTrue_(item.active) && String(item.credentialId || '') === credentialId;
  })[0] || null;
  if (!row) return studentFail_('PASSKEY_NOT_FOUND', '서버에 등록된 패스키를 찾지 못했습니다. 다른 방법으로 로그인한 뒤 다시 등록하세요.');
  var origin = v6ValidatedOrigin_(params.origin, params.hostname);
  var requestId = v6RandomToken_(24);
  var challenge = v6RandomToken_(32);
  CacheService.getScriptCache().put('V6_PK_LOGIN_' + requestId, JSON.stringify({
    challenge: challenge,
    origin: origin,
    rpId: V6_RP_ID,
    credentialId: credentialId,
    loginType: String(row.loginType || 'passkey'),
    loginId: String(row.loginId || ''),
    displayName: String(row.displayName || row.loginId || '관리자'),
    role: String(row.role || 'ADMIN'),
    publicKeyX: String(row.publicKeyX || ''),
    publicKeyY: String(row.publicKeyY || ''),
    signCount: Number(row.signCount || 0),
    row: row._row,
    createdAt: Date.now()
  }), V6_PASSKEY_REQUEST_TTL_SEC);
  return {
    ok: true,
    requestId: requestId,
    version: V6_SERVER_VERSION,
    publicKey: {
      challenge: challenge,
      timeout: 60000,
      rpId: V6_RP_ID,
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required'
    }
  };
}

function v6PasskeyLoginVerify_(params) {
  var requestId = String(params.requestId || '').trim();
  var cache = CacheService.getScriptCache();
  var raw = cache.get('V6_PK_LOGIN_' + requestId);
  if (!raw) return studentFail_('PASSKEY_REQUEST_EXPIRED', '패스키 로그인 요청이 만료되었습니다. 다시 시도하세요.');
  var request = JSON.parse(raw);
  var credential = v6ParseJson_(params.credential, '패스키 로그인 응답을 읽지 못했습니다.');
  var credentialId = String(credential.id || credential.rawId || '').trim();
  if (!credentialId || credentialId !== request.credentialId) return studentFail_('PASSKEY_CREDENTIAL_MISMATCH', '등록된 패스키와 응답이 일치하지 않습니다.');
  var response = credential.response || {};
  var clientDataBytes = v6B64Decode_(response.clientDataJSON);
  var clientData = v6ParseJson_(v6BytesToUtf8_(clientDataBytes), '패스키 로그인 확인값이 올바르지 않습니다.');
  v6CheckClientData_(clientData, 'webauthn.get', request.challenge, request.origin);
  var authenticatorData = v6B64Decode_(response.authenticatorData);
  var signature = v6B64Decode_(response.signature);
  var auth = v6ParseAuthenticatorData_(authenticatorData, request.rpId, false);
  if ((auth.flags & 1) === 0 || (auth.flags & 4) === 0) return studentFail_('PASSKEY_USER_VERIFICATION_REQUIRED', '기기 사용자 확인이 완료되지 않았습니다.');
  var signedData = authenticatorData.concat(v6Sha256_(clientDataBytes));
  var verified = v6VerifyEcdsaP256_(signedData, signature, v6B64Decode_(request.publicKeyX), v6B64Decode_(request.publicKeyY));
  if (!verified) return studentFail_('PASSKEY_SIGNATURE_INVALID', '패스키 서명을 확인하지 못했습니다.');
  if (request.signCount > 0 && auth.signCount > 0 && auth.signCount <= request.signCount) {
    return studentFail_('PASSKEY_COUNTER_REPLAY', '패스키 사용 횟수 검증에 실패했습니다. 패스키를 다시 등록하세요.');
  }
  var sheet = adminCompatSheet_(ADMIN_COMPAT_PASSKEY_SHEET);
  if (request.row) studentUpdateRow_(sheet, Number(request.row), { signCount: auth.signCount, lastUsedAt: new Date(), active: true });
  var session = adminCompatCreateSession_({
    loginType: 'passkey',
    adminId: request.loginType === 'admin' ? request.loginId : '',
    email: request.loginType === 'google' ? request.loginId : '',
    name: request.displayName || request.loginId,
    role: request.role || 'ADMIN'
  });
  cache.remove('V6_PK_LOGIN_' + requestId);
  adminCompatAppendLoginLog_(request.loginId, request.role, '패스키 로그인 성공', params);
  return {
    ok: true,
    message: '패스키 로그인 성공',
    sessionToken: session.token,
    sessionExpiresAt: new Date(session.expiresAt).toISOString(),
    sessionExpiresAtMs: session.expiresAt,
    name: request.displayName || request.loginId,
    email: request.loginType === 'google' ? request.loginId : '',
    role: request.role || 'ADMIN',
    version: V6_SERVER_VERSION
  };
}

function v6DeletePasskey_(params) {
  var auth = adminCompatRequire_(params);
  var credentialId = String(params.credentialId || '').trim();
  if (!credentialId) return studentFail_('PASSKEY_CREDENTIAL_REQUIRED', '삭제할 패스키 정보가 없습니다.');
  var sheet = v6EnsurePasskeySheet_();
  var changed = 0;
  studentRows_(sheet).forEach(function (row) {
    if (String(row.credentialId || '') === credentialId && adminCompatTrue_(row.active)) {
      studentUpdateRow_(sheet, row._row, { active: false, lastUsedAt: new Date() });
      changed++;
    }
  });
  SpreadsheetApp.flush();
  return { ok: true, deleted: changed > 0, count: changed, credentialId: credentialId, name: auth.name || '', version: V6_SERVER_VERSION };
}

function v6ValidatedOrigin_(origin, hostname) {
  var normalizedOrigin = String(origin || '').trim().replace(/\/$/, '');
  var normalizedHost = String(hostname || '').trim().toLowerCase();
  if (normalizedOrigin !== V6_ALLOWED_ORIGIN || normalizedHost !== V6_RP_ID) {
    var error = new Error('허용되지 않은 사이트에서 패스키를 요청했습니다.');
    error.code = 'PASSKEY_ORIGIN_INVALID';
    throw error;
  }
  return normalizedOrigin;
}

function v6CheckClientData_(clientData, expectedType, expectedChallenge, expectedOrigin) {
  if (!clientData || String(clientData.type || '') !== expectedType) throw v6Error_('PASSKEY_TYPE_INVALID', '패스키 요청 종류가 올바르지 않습니다.');
  if (!studentConstantEqual_(String(clientData.challenge || ''), String(expectedChallenge || ''))) throw v6Error_('PASSKEY_CHALLENGE_INVALID', '패스키 요청 확인값이 일치하지 않습니다.');
  if (String(clientData.origin || '').replace(/\/$/, '') !== String(expectedOrigin || '').replace(/\/$/, '')) throw v6Error_('PASSKEY_ORIGIN_INVALID', '패스키 요청 사이트가 일치하지 않습니다.');
}

function v6ParseAttestation_(bytes, rpId) {
  var decoded = v6CborRead_(bytes, 0).value;
  var authData = decoded && decoded.authData;
  if (!Array.isArray(authData)) throw v6Error_('PASSKEY_ATTESTATION_INVALID', '패스키 등록 데이터를 읽지 못했습니다.');
  var parsed = v6ParseAuthenticatorData_(authData, rpId, true);
  if (!parsed.credentialId || !parsed.cose) throw v6Error_('PASSKEY_PUBLIC_KEY_MISSING', '패스키 공개키를 읽지 못했습니다.');
  var cose = parsed.cose;
  var kty = Number(cose['1']);
  var alg = Number(cose['3']);
  var crv = Number(cose['-1']);
  var x = cose['-2'];
  var y = cose['-3'];
  if (kty !== 2 || alg !== -7 || crv !== 1 || !Array.isArray(x) || !Array.isArray(y)) throw v6Error_('PASSKEY_ALGORITHM_UNSUPPORTED', '지원하지 않는 패스키 공개키 형식입니다.');
  return { credentialId: parsed.credentialId, x: x, y: y, alg: alg, signCount: parsed.signCount };
}

function v6ParseAuthenticatorData_(bytes, rpId, requireAttested) {
  if (!Array.isArray(bytes) || bytes.length < 37) throw v6Error_('PASSKEY_AUTH_DATA_INVALID', '패스키 인증 데이터가 너무 짧습니다.');
  var expectedRpHash = v6Sha256_(v6Utf8Bytes_(rpId));
  var actualRpHash = bytes.slice(0, 32);
  if (!v6BytesEqual_(expectedRpHash, actualRpHash)) throw v6Error_('PASSKEY_RP_ID_INVALID', '패스키 사이트 식별값이 일치하지 않습니다.');
  var flags = bytes[32] & 255;
  var signCount = v6ReadUint32_(bytes, 33);
  var result = { flags: flags, signCount: signCount };
  if (requireAttested) {
    if ((flags & 64) === 0 || bytes.length < 55) throw v6Error_('PASSKEY_ATTESTED_DATA_MISSING', '패스키 등록 공개키가 없습니다.');
    var offset = 53;
    var credentialLength = ((bytes[offset] & 255) << 8) | (bytes[offset + 1] & 255);
    offset += 2;
    if (credentialLength <= 0 || offset + credentialLength > bytes.length) throw v6Error_('PASSKEY_CREDENTIAL_INVALID', '패스키 ID 길이가 올바르지 않습니다.');
    result.credentialId = bytes.slice(offset, offset + credentialLength);
    offset += credentialLength;
    var coseResult = v6CborRead_(bytes, offset);
    result.cose = coseResult.value;
  }
  return result;
}

function v6CborRead_(bytes, start) {
  var offset = start || 0;
  if (offset >= bytes.length) throw v6Error_('CBOR_EOF', '패스키 CBOR 데이터가 끝났습니다.');
  var initial = bytes[offset++] & 255;
  var major = initial >> 5;
  var additional = initial & 31;
  var lengthInfo = v6CborLength_(bytes, offset, additional);
  var length = lengthInfo.value;
  offset = lengthInfo.offset;
  if (major === 0) return { value: length, offset: offset };
  if (major === 1) return { value: -1 - length, offset: offset };
  if (major === 2) return { value: bytes.slice(offset, offset + length), offset: offset + length };
  if (major === 3) return { value: v6BytesToUtf8_(bytes.slice(offset, offset + length)), offset: offset + length };
  if (major === 4) {
    var array = [];
    for (var i = 0; i < length; i++) { var item = v6CborRead_(bytes, offset); array.push(item.value); offset = item.offset; }
    return { value: array, offset: offset };
  }
  if (major === 5) {
    var map = {};
    for (var m = 0; m < length; m++) {
      var keyItem = v6CborRead_(bytes, offset); offset = keyItem.offset;
      var valueItem = v6CborRead_(bytes, offset); offset = valueItem.offset;
      map[String(keyItem.value)] = valueItem.value;
    }
    return { value: map, offset: offset };
  }
  if (major === 6) return v6CborRead_(bytes, offset);
  if (major === 7) {
    if (additional === 20) return { value: false, offset: offset };
    if (additional === 21) return { value: true, offset: offset };
    if (additional === 22 || additional === 23) return { value: null, offset: offset };
  }
  throw v6Error_('CBOR_UNSUPPORTED', '지원하지 않는 패스키 CBOR 형식입니다.');
}

function v6CborLength_(bytes, offset, additional) {
  if (additional < 24) return { value: additional, offset: offset };
  if (additional === 24) return { value: bytes[offset] & 255, offset: offset + 1 };
  if (additional === 25) return { value: ((bytes[offset] & 255) << 8) | (bytes[offset + 1] & 255), offset: offset + 2 };
  if (additional === 26) return { value: v6ReadUint32_(bytes, offset), offset: offset + 4 };
  throw v6Error_('CBOR_LENGTH_UNSUPPORTED', '너무 큰 패스키 CBOR 길이는 지원하지 않습니다.');
}

function v6VerifyEcdsaP256_(data, derSignature, xBytes, yBytes) {
  if (typeof BigInt !== 'function') throw v6Error_('BIGINT_REQUIRED', 'Apps Script V8 런타임을 사용해야 패스키를 검증할 수 있습니다.');
  var signature = v6ParseDerSignature_(derSignature);
  var curve = v6P256_();
  if (signature.r <= 0 || signature.r >= curve.n || signature.s <= 0 || signature.s >= curve.n) return false;
  var q = { x: v6BytesToBigInt_(xBytes), y: v6BytesToBigInt_(yBytes), z: BigInt(1) };
  if (!v6PointValid_(q, curve)) return false;
  var z = v6BytesToBigInt_(v6Sha256_(data)) % curve.n;
  var w = v6ModInverse_(signature.s, curve.n);
  var u1 = v6Mod_(z * w, curve.n);
  var u2 = v6Mod_(signature.r * w, curve.n);
  var g = { x: curve.gx, y: curve.gy, z: BigInt(1) };
  var point = v6PointAdd_(v6PointMultiply_(g, u1, curve), v6PointMultiply_(q, u2, curve), curve);
  if (point.z === BigInt(0)) return false;
  var affine = v6ToAffine_(point, curve);
  return v6Mod_(affine.x, curve.n) === signature.r;
}

function v6P256_() {
  var p = BigInt('0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF');
  return {
    p: p,
    a: p - BigInt(3),
    b: BigInt('0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B'),
    n: BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551'),
    gx: BigInt('0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296'),
    gy: BigInt('0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5')
  };
}

function v6PointValid_(point, curve) {
  if (point.x < 0 || point.x >= curve.p || point.y < 0 || point.y >= curve.p) return false;
  return v6Mod_(point.y * point.y - (point.x * point.x * point.x + curve.a * point.x + curve.b), curve.p) === BigInt(0);
}

function v6PointMultiply_(point, scalar, curve) {
  var result = { x: BigInt(0), y: BigInt(1), z: BigInt(0) };
  var addend = point;
  var k = scalar;
  while (k > 0) {
    if ((k & BigInt(1)) === BigInt(1)) result = v6PointAdd_(result, addend, curve);
    addend = v6PointDouble_(addend, curve);
    k >>= BigInt(1);
  }
  return result;
}

function v6PointDouble_(point, curve) {
  if (point.z === BigInt(0) || point.y === BigInt(0)) return { x: BigInt(0), y: BigInt(1), z: BigInt(0) };
  var p = curve.p;
  var xx = v6Mod_(point.x * point.x, p);
  var yy = v6Mod_(point.y * point.y, p);
  var yyyy = v6Mod_(yy * yy, p);
  var zz = v6Mod_(point.z * point.z, p);
  var s = v6Mod_(BigInt(2) * (v6Mod_((point.x + yy) * (point.x + yy), p) - xx - yyyy), p);
  var m = v6Mod_(BigInt(3) * xx + curve.a * v6Mod_(zz * zz, p), p);
  var x3 = v6Mod_(m * m - BigInt(2) * s, p);
  var y3 = v6Mod_(m * (s - x3) - BigInt(8) * yyyy, p);
  var z3 = v6Mod_(BigInt(2) * point.y * point.z, p);
  return { x: x3, y: y3, z: z3 };
}

function v6PointAdd_(p1, p2, curve) {
  if (p1.z === BigInt(0)) return p2;
  if (p2.z === BigInt(0)) return p1;
  var p = curve.p;
  var z1z1 = v6Mod_(p1.z * p1.z, p);
  var z2z2 = v6Mod_(p2.z * p2.z, p);
  var u1 = v6Mod_(p1.x * z2z2, p);
  var u2 = v6Mod_(p2.x * z1z1, p);
  var s1 = v6Mod_(p1.y * p2.z * z2z2, p);
  var s2 = v6Mod_(p2.y * p1.z * z1z1, p);
  if (u1 === u2) return s1 === s2 ? v6PointDouble_(p1, curve) : { x: BigInt(0), y: BigInt(1), z: BigInt(0) };
  var h = v6Mod_(u2 - u1, p);
  var i = v6Mod_((BigInt(2) * h) * (BigInt(2) * h), p);
  var j = v6Mod_(h * i, p);
  var r = v6Mod_(BigInt(2) * (s2 - s1), p);
  var v = v6Mod_(u1 * i, p);
  var x3 = v6Mod_(r * r - j - BigInt(2) * v, p);
  var y3 = v6Mod_(r * (v - x3) - BigInt(2) * s1 * j, p);
  var z3 = v6Mod_(((p1.z + p2.z) * (p1.z + p2.z) - z1z1 - z2z2) * h, p);
  return { x: x3, y: y3, z: z3 };
}

function v6ToAffine_(point, curve) {
  var zInv = v6ModInverse_(point.z, curve.p);
  var z2 = v6Mod_(zInv * zInv, curve.p);
  return { x: v6Mod_(point.x * z2, curve.p), y: v6Mod_(point.y * z2 * zInv, curve.p) };
}

function v6ModInverse_(value, modulus) {
  var a = v6Mod_(value, modulus);
  var b = modulus;
  var x0 = BigInt(1), x1 = BigInt(0);
  while (b !== BigInt(0)) {
    var q = a / b;
    var t = a % b; a = b; b = t;
    t = x0 - q * x1; x0 = x1; x1 = t;
  }
  return v6Mod_(x0, modulus);
}

function v6Mod_(value, modulus) { var result = value % modulus; return result < 0 ? result + modulus : result; }

function v6ParseDerSignature_(bytes) {
  var offset = 0;
  if ((bytes[offset++] & 255) !== 48) throw v6Error_('PASSKEY_SIGNATURE_FORMAT', '패스키 서명 형식이 올바르지 않습니다.');
  var sequenceLength = v6DerLength_(bytes, offset); offset = sequenceLength.offset;
  if ((bytes[offset++] & 255) !== 2) throw v6Error_('PASSKEY_SIGNATURE_FORMAT', '패스키 서명 R 값이 없습니다.');
  var rLength = v6DerLength_(bytes, offset); offset = rLength.offset;
  var rBytes = bytes.slice(offset, offset + rLength.value); offset += rLength.value;
  if ((bytes[offset++] & 255) !== 2) throw v6Error_('PASSKEY_SIGNATURE_FORMAT', '패스키 서명 S 값이 없습니다.');
  var sLength = v6DerLength_(bytes, offset); offset = sLength.offset;
  var sBytes = bytes.slice(offset, offset + sLength.value);
  while (rBytes.length > 1 && rBytes[0] === 0) rBytes.shift();
  while (sBytes.length > 1 && sBytes[0] === 0) sBytes.shift();
  return { r: v6BytesToBigInt_(rBytes), s: v6BytesToBigInt_(sBytes) };
}

function v6DerLength_(bytes, offset) {
  var first = bytes[offset++] & 255;
  if (first < 128) return { value: first, offset: offset };
  var count = first & 127;
  var value = 0;
  for (var i = 0; i < count; i++) value = value * 256 + (bytes[offset++] & 255);
  return { value: value, offset: offset };
}

function v6BytesToBigInt_(bytes) {
  if (!bytes || !bytes.length) return BigInt(0);
  var hex = bytes.map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
  return BigInt('0x' + hex);
}

function v6RandomToken_(length) {
  var material = Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + Date.now() + '|' + Math.random();
  var bytes = v6Sha256_(v6Utf8Bytes_(material));
  var token = v6B64Encode_(bytes);
  while (token.length < length) token += v6B64Encode_(v6Sha256_(v6Utf8Bytes_(token + material)));
  return token.slice(0, length);
}

function v6B64Decode_(value) {
  var text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (text.length % 4) text += '=';
  try { return Utilities.base64Decode(text).map(function (byte) { return byte & 255; }); }
  catch (error) { throw v6Error_('BASE64_INVALID', '패스키 인코딩을 읽지 못했습니다.'); }
}

function v6B64Encode_(bytes) {
  return Utilities.base64EncodeWebSafe(v6SignedBytes_(bytes)).replace(/=+$/g, '');
}

function v6Utf8Bytes_(text) {
  return Utilities.newBlob(String(text || '')).getBytes().map(function (byte) { return byte & 255; });
}

function v6BytesToUtf8_(bytes) {
  return Utilities.newBlob(v6SignedBytes_(bytes)).getDataAsString('UTF-8');
}

function v6Sha256_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v6SignedBytes_(bytes)).map(function (byte) { return byte & 255; });
}

function v6SignedBytes_(bytes) {
  return (bytes || []).map(function (byte) { var value = byte & 255; return value > 127 ? value - 256 : value; });
}

function v6BytesEqual_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  var mismatch = 0;
  for (var i = 0; i < a.length; i++) mismatch |= (a[i] & 255) ^ (b[i] & 255);
  return mismatch === 0;
}

function v6ReadUint32_(bytes, offset) {
  return ((bytes[offset] & 255) * 16777216) + ((bytes[offset + 1] & 255) << 16) + ((bytes[offset + 2] & 255) << 8) + (bytes[offset + 3] & 255);
}

function v6ParseJson_(value, message) {
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch (error) { throw v6Error_('JSON_INVALID', message || 'JSON 형식이 올바르지 않습니다.'); }
}

function v6Error_(code, message) { var error = new Error(message); error.code = code; return error; }

/*
 * 배포 후 확인 주소
 * ?action=ping&callback=callback
 * ?action=studentFeaturePingJsonp&callback=callback
 * ?action=adminLoginChallengeJsonp&adminIdHash=test&callback=callback
 */
