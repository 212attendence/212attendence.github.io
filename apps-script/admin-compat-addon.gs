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

function handleAdminCompatAction_(action, e) {
  var handlers = {
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
    passkeyRegisterOptionsJsonp: adminCompatPasskeyUnavailable_,
    passkeyRegisterVerifyJsonp: adminCompatPasskeyUnavailable_,
    passkeyLoginOptionsJsonp: adminCompatPasskeyUnavailable_,
    passkeyLoginVerifyJsonp: adminCompatPasskeyUnavailable_,
    deletePasskeyJsonp: adminCompatDeletePasskey_
  };
  if (!handlers[action]) return null;
  try {
    adminCompatSetup_();
    return studentJsonp_(e, handlers[action](e && e.parameter || {}));
  } catch (error) {
    return studentJsonp_(e, {
      ok: false,
      code: error && error.code || 'ADMIN_COMPAT_SERVER_ERROR',
      message: error && error.message || String(error),
      version: ADMIN_COMPAT_VERSION
    });
  }
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
