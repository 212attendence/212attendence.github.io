/*
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
    var error = new Error('기존 Code.gs의 requireAuth_ 함수가 필요합니다.');
    error.code = 'ADMIN_AUTH_UNAVAILABLE';
    throw error;
  }
  return requireAuth_(e);
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
 * Code.gs 연결 안내
 * ==========================================================================
 * 기존 doGet(e)에서 action을 만든 직후:
 *
 *   var privacyResponse = handleStudentPrivacyAction_(action, e);
 *   if (privacyResponse) return privacyResponse;
 *   var studentResponse = handleStudentAuthAction_(action, e);
 *   if (studentResponse) return studentResponse;
 *
 * 기존 doPost(e) 시작 부분:
 *
 *   var securePostResponse = handleStudentSecurePost_(e);
 *   if (securePostResponse) return securePostResponse;
 */
