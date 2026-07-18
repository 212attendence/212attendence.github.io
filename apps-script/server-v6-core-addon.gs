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
