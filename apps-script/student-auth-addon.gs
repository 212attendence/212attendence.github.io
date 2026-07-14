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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('설정');
  if (!sheet || sheet.getLastRow() < 1) return fallback;
  var values = sheet.getDataRange().getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === key) return values[i][1] == null || values[i][1] === '' ? fallback : values[i][1];
  }
  return fallback;
}

function studentSetSetting_(key, value) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('설정') || ss.insertSheet('설정');
  var values = sheet.getLastRow() ? sheet.getRange(1, 1, sheet.getLastRow(), Math.max(2, sheet.getLastColumn())).getValues() : [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function studentEnsureSetting_(key, value) {
  var existing = studentGetSetting_(key, null);
  if (existing === null) studentSetSetting_(key, value);
}

function studentEnsureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

function studentSheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
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
