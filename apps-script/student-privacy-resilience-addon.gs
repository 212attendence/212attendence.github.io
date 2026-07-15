/*
 * 2-12 출석 시스템 개인정보 권한·복구 알림 확장 모듈
 *
 * 기존 Code.gs의 doGet(e)에서 action을 읽은 직후 아래 두 줄을 추가하세요.
 *
 *   var privacyResponse = handleStudentPrivacyAction_(action, e);
 *   if (privacyResponse) return privacyResponse;
 *
 * 기존 setup() 마지막에는 setupStudentPrivacyResilience_(); 를 추가하고
 * 웹 앱을 새 버전으로 배포하세요.
 *
 * 이 파일은 apps-script/student-auth-addon.gs와 함께 사용합니다.
 */

var STUDENT_PRIVACY_PERMISSION_SHEET = '학생개인정보권한';
var STUDENT_PRIVACY_AUDIT_SHEET = '학생개인정보동의로그';
var STUDENT_FALLBACK_EVENT_SHEET = '시스템오류알림';
var STUDENT_PRIVACY_ADMIN_EMAIL = 'junho.eum.travel@gmail.com';
var STUDENT_PRIVACY_CURRENT_VERSION = '2026-07-15-v1';

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
  'ageBand', 'guardianConfirmed', 'guardianName', 'source', 'deviceName', 'userAgent', 'clientTime', 'clientTimezone'
];

var STUDENT_FALLBACK_EVENT_HEADERS = [
  'createdAt', 'eventId', 'errorType', 'message', 'sourcePage', 'fallbackUrl', 'studentId', 'studentName',
  'online', 'deviceName', 'userAgent', 'clientTimezone', 'status', 'notifiedAt'
];

function handleStudentPrivacyAction_(action, e) {
  var handlers = {
    studentSavePrivacyConsentJsonp: studentSavePrivacyConsentJsonp_,
    studentPrivacyStatusJsonp: studentPrivacyStatusJsonp_,
    studentWithdrawPrivacyConsentJsonp: studentWithdrawPrivacyConsentJsonp_,
    adminPrivacyPermissionsJsonp: adminPrivacyPermissionsJsonp_,
    adminSetStudentPasswordJsonp: adminSetStudentPasswordJsonp_,
    adminMarkGuardianConsentJsonp: adminMarkGuardianConsentJsonp_,
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

function setupStudentPrivacyResilience_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  studentEnsureSheet_(ss, STUDENT_PRIVACY_PERMISSION_SHEET, STUDENT_PRIVACY_PERMISSION_HEADERS);
  studentEnsureSheet_(ss, STUDENT_PRIVACY_AUDIT_SHEET, STUDENT_PRIVACY_AUDIT_HEADERS);
  studentEnsureSheet_(ss, STUDENT_FALLBACK_EVENT_SHEET, STUDENT_FALLBACK_EVENT_HEADERS);
  return true;
}

function studentSavePrivacyConsentJsonp_(e) {
  setupStudentPrivacyResilience_();
  var p = e && e.parameter || {};
  var session = studentFindSession_(String(p.studentToken || ''));
  if (!session) return studentFail_('STUDENT_AUTH_REQUIRED', '학생 로그인이 필요합니다.');

  var requiredKeys = ['privacyRequired', 'locationRequired', 'accountRequired', 'deviceRequired', 'policyRequired'];
  var requiredAccepted = requiredKeys.every(function (key) { return privacyStrictTrue_(p[key]); });
  if (!requiredAccepted) {
    return studentFail_('PRIVACY_REQUIRED_CONSENT_MISSING', '위치 정보를 포함한 모든 필수 항목에 동의해야 합니다.');
  }

  var ageBand = privacyClean_(p.ageBand || '14_PLUS', 20).toUpperCase();
  if (ageBand !== 'UNDER_14' && ageBand !== '14_PLUS') ageBand = '14_PLUS';
  var guardianConfirmed = privacyStrictTrue_(p.guardianConfirmed);
  var guardianName = privacyClean_(p.guardianName, 40);
  if (ageBand === 'UNDER_14' && (!guardianConfirmed || !guardianName)) {
    return studentFail_('GUARDIAN_CONSENT_REQUIRED', '만 14세 미만은 법정대리인 동의 확인과 성명이 필요합니다.');
  }

  var now = new Date();
  var existing = privacyFindPermission_(session.studentId);
  var consentedAt = existing && existing.consentedAt ? existing.consentedAt : now;
  var record = {
    updatedAt: now,
    studentId: String(session.studentId || ''),
    name: String(session.name || ''),
    fingerId: String(session.fingerId || ''),
    status: 'ACTIVE',
    consentVersion: privacyClean_(p.consentVersion || STUDENT_PRIVACY_CURRENT_VERSION, 60),
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
    backgroundLocationOptional: privacyStrictTrue_(p.backgroundLocationOptional),
    ageBand: ageBand,
    guardianConfirmed: guardianConfirmed,
    guardianName: guardianName,
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
  return { ok: true, consent: privacyPublicConsent_(record) };
}

function studentPrivacyStatusJsonp_(e) {
  setupStudentPrivacyResilience_();
  var p = e && e.parameter || {};
  var session = studentFindSession_(String(p.studentToken || ''));
  if (!session) return studentFail_('STUDENT_AUTH_REQUIRED', '학생 로그인이 필요합니다.');
  var record = privacyFindPermission_(session.studentId);
  return { ok: true, consent: record ? privacyPublicConsent_(record) : null };
}

function studentWithdrawPrivacyConsentJsonp_(e) {
  setupStudentPrivacyResilience_();
  var p = e && e.parameter || {};
  var session = studentFindSession_(String(p.studentToken || ''));
  if (!session) return studentFail_('STUDENT_AUTH_REQUIRED', '학생 로그인이 필요합니다.');
  var record = privacyFindPermission_(session.studentId);
  if (!record) return studentFail_('PRIVACY_CONSENT_NOT_FOUND', '저장된 개인정보 동의를 찾지 못했습니다.');

  var now = new Date();
  studentUpdateRow_(studentSheet_(STUDENT_PRIVACY_PERMISSION_SHEET), record._row, {
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
  });
  var refreshed = privacyFindPermission_(session.studentId);
  privacyAppendAudit_('CONSENT_WITHDRAW', refreshed);
  studentDeactivateSessions_(session.studentId);
  return { ok: true, status: 'WITHDRAWN', studentId: session.studentId };
}

function adminPrivacyPermissionsJsonp_(e) {
  setupStudentPrivacyResilience_();
  studentRequireAdmin_(e);
  var permissions = {};
  studentRows_(studentSheet_(STUDENT_PRIVACY_PERMISSION_SHEET)).forEach(function (row) {
    permissions[String(row.studentId || '')] = row;
  });
  var result = studentRows_(studentSheet_(STUDENT_ACCOUNT_SHEET)).map(function (account) {
    var permission = permissions[String(account.studentId || '')] || null;
    if (!permission) {
      return {
        studentId: String(account.studentId || ''),
        name: String(account.name || ''),
        fingerId: String(account.fingerId || ''),
        status: 'MISSING',
        requiredAccepted: false
      };
    }
    var output = privacyPublicConsent_(permission);
    output.name = String(account.name || output.name || '');
    output.fingerId = String(account.fingerId || output.fingerId || '');
    return output;
  });
  result.sort(function (a, b) {
    var fingerA = Number(a.fingerId), fingerB = Number(b.fingerId);
    if (isFinite(fingerA) && isFinite(fingerB) && fingerA !== fingerB) return fingerA - fingerB;
    return String(a.name || a.studentId).localeCompare(String(b.name || b.studentId), 'ko');
  });
  return { ok: true, count: result.length, permissions: result };
}

function adminSetStudentPasswordJsonp_(e) {
  setupStudentPrivacyResilience_();
  var admin = studentRequireAdmin_(e) || {};
  var p = e && e.parameter || {};
  var studentId = privacyClean_(p.studentId, 40);
  var password = String(p.password || '');
  var account = studentFindAccount_(studentId);
  if (!account) return studentFail_('STUDENT_ACCOUNT_NOT_FOUND', '학생계정을 찾지 못했습니다.');
  if (password.length < 8 || password.length > 64 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return studentFail_('STUDENT_PASSWORD_POLICY', '비밀번호는 영문과 숫자를 포함해 8~64자로 설정하세요.');
  }

  studentUpdateRow_(studentSheet_(STUDENT_ACCOUNT_SHEET), account._row, {
    initialPassword: '',
    passwordHash: studentPasswordHash_(password),
    updatedAt: new Date()
  });
  var deactivated = studentDeactivateSessions_(studentId);
  privacyAppendSecurityEvent_('ADMIN_PASSWORD_SET', studentId, account.name, {
    admin: String(admin.name || admin.email || admin.adminId || 'ADMIN'),
    deactivatedSessions: deactivated
  });
  return { ok: true, studentId: studentId, name: String(account.name || ''), deactivatedSessions: deactivated };
}

function adminMarkGuardianConsentJsonp_(e) {
  setupStudentPrivacyResilience_();
  var admin = studentRequireAdmin_(e) || {};
  var p = e && e.parameter || {};
  var studentId = privacyClean_(p.studentId, 40);
  var record = privacyFindPermission_(studentId);
  if (!record) return studentFail_('PRIVACY_CONSENT_NOT_FOUND', '학생 개인정보 권한 기록을 찾지 못했습니다.');
  var confirmed = privacyStrictTrue_(p.confirmed);
  studentUpdateRow_(studentSheet_(STUDENT_PRIVACY_PERMISSION_SHEET), record._row, {
    updatedAt: new Date(),
    guardianConfirmed: confirmed,
    guardianName: privacyClean_(p.guardianName || record.guardianName, 40),
    source: 'admin-guardian-confirmation:' + privacyClean_(admin.name || admin.email || 'ADMIN', 80)
  });
  var refreshed = privacyFindPermission_(studentId);
  privacyAppendAudit_('GUARDIAN_CONFIRMATION_UPDATE', refreshed);
  return { ok: true, consent: privacyPublicConsent_(refreshed) };
}

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

  var eventId = privacyClean_(p.eventId || ('FB-' + new Date().getTime()), 80);
  var errorType = privacyClean_(p.errorType || 'UNKNOWN', 80);
  var message = privacyClean_(p.message || '오류 내용 없음', 500);
  var sourcePage = privacyClean_(p.sourcePage, 500);
  var fallbackUrl = privacyClean_(p.fallbackUrl, 500);
  var now = new Date();
  var notificationKey = 'STUDENT_FALLBACK_NOTIFY_' + studentHash_(errorType + '|' + sourcePage).slice(0, 32);
  var cache = CacheService.getScriptCache();
  var shouldNotify = !cache.get(notificationKey);
  var status = shouldNotify ? 'NOTIFIED' : 'RATE_LIMITED';
  var notifiedAt = shouldNotify ? now : '';

  if (shouldNotify) {
    cache.put(notificationKey, '1', 600);
    var title = '2-12 출석 백업 시스템 작동';
    var body = '[' + errorType + '] ' + (studentName || studentId || '비로그인 사용자') + ' · ' + message.slice(0, 120);
    studentTryPushAdmin_({ title: title, body: body, url: 'https://212attendence.github.io/admin/system-health/' });
    try {
      MailApp.sendEmail({
        to: STUDENT_PRIVACY_ADMIN_EMAIL,
        subject: title + ' - ' + errorType,
        htmlBody: '<h2>' + privacyHtml_(title) + '</h2>' +
          '<p><strong>오류 유형:</strong> ' + privacyHtml_(errorType) + '</p>' +
          '<p><strong>학생:</strong> ' + privacyHtml_(studentName || studentId || '비로그인') + '</p>' +
          '<p><strong>내용:</strong> ' + privacyHtml_(message) + '</p>' +
          '<p><strong>발생 페이지:</strong> ' + privacyHtml_(sourcePage) + '</p>' +
          '<p><strong>백업 경로:</strong> ' + privacyHtml_(fallbackUrl) + '</p>' +
          '<p><a href="https://212attendence.github.io/admin/system-health/">시스템 상태 열기</a></p>'
      });
    } catch (mailError) {
      status = 'PUSH_ONLY';
    }
  }

  studentAppendObject_(studentSheet_(STUDENT_FALLBACK_EVENT_SHEET), STUDENT_FALLBACK_EVENT_HEADERS, {
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
  });
  return { ok: true, eventId: eventId, notified: shouldNotify, status: status };
}

function adminFallbackEventsJsonp_(e) {
  setupStudentPrivacyResilience_();
  studentRequireAdmin_(e);
  var rows = studentRows_(studentSheet_(STUDENT_FALLBACK_EVENT_SHEET));
  rows.sort(function (a, b) { return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); });
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
        createdAt: row.createdAt,
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

function privacyFindPermission_(studentId) {
  return studentFindBy_(studentSheet_(STUDENT_PRIVACY_PERMISSION_SHEET), 'studentId', String(studentId || ''));
}

function privacyUpsertPermission_(record) {
  var sheet = studentSheet_(STUDENT_PRIVACY_PERMISSION_SHEET);
  var existing = privacyFindPermission_(record.studentId);
  if (existing) studentUpdateRow_(sheet, existing._row, record);
  else studentAppendObject_(sheet, STUDENT_PRIVACY_PERMISSION_HEADERS, record);
}

function privacyAppendAudit_(eventType, record) {
  if (!record) return;
  studentAppendObject_(studentSheet_(STUDENT_PRIVACY_AUDIT_SHEET), STUDENT_PRIVACY_AUDIT_HEADERS, {
    timestamp: new Date(),
    eventType: eventType,
    studentId: record.studentId,
    name: record.name,
    fingerId: record.fingerId,
    status: record.status,
    consentVersion: record.consentVersion,
    requiredAccepted: privacyStrictTrue_(record.requiredAccepted),
    privacyRequired: privacyStrictTrue_(record.privacyRequired),
    locationRequired: privacyStrictTrue_(record.locationRequired),
    accountRequired: privacyStrictTrue_(record.accountRequired),
    deviceRequired: privacyStrictTrue_(record.deviceRequired),
    policyRequired: privacyStrictTrue_(record.policyRequired),
    pushOptional: privacyStrictTrue_(record.pushOptional),
    diagnosticsOptional: privacyStrictTrue_(record.diagnosticsOptional),
    updatesOptional: privacyStrictTrue_(record.updatesOptional),
    rememberOptional: privacyStrictTrue_(record.rememberOptional),
    backgroundLocationOptional: privacyStrictTrue_(record.backgroundLocationOptional),
    ageBand: record.ageBand,
    guardianConfirmed: privacyStrictTrue_(record.guardianConfirmed),
    guardianName: record.guardianName,
    source: record.source,
    deviceName: record.deviceName,
    userAgent: record.userAgent,
    clientTime: record.clientTime,
    clientTimezone: record.clientTimezone
  });
}

function privacyAppendSecurityEvent_(eventType, studentId, name, details) {
  studentAppendObject_(studentSheet_(STUDENT_FALLBACK_EVENT_SHEET), STUDENT_FALLBACK_EVENT_HEADERS, {
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
    clientTimezone: Session.getScriptTimeZone() || 'Asia/Seoul',
    status: 'AUDIT',
    notifiedAt: ''
  });
}

function privacyPublicConsent_(row) {
  return {
    studentId: String(row.studentId || ''),
    name: String(row.name || ''),
    fingerId: String(row.fingerId || ''),
    status: String(row.status || 'MISSING'),
    consentVersion: String(row.consentVersion || ''),
    requiredAccepted: privacyStrictTrue_(row.requiredAccepted) && String(row.status || '').toUpperCase() === 'ACTIVE',
    privacyRequired: privacyStrictTrue_(row.privacyRequired),
    locationRequired: privacyStrictTrue_(row.locationRequired),
    accountRequired: privacyStrictTrue_(row.accountRequired),
    deviceRequired: privacyStrictTrue_(row.deviceRequired),
    policyRequired: privacyStrictTrue_(row.policyRequired),
    pushOptional: privacyStrictTrue_(row.pushOptional),
    diagnosticsOptional: privacyStrictTrue_(row.diagnosticsOptional),
    updatesOptional: privacyStrictTrue_(row.updatesOptional),
    rememberOptional: privacyStrictTrue_(row.rememberOptional),
    backgroundLocationOptional: privacyStrictTrue_(row.backgroundLocationOptional),
    ageBand: String(row.ageBand || ''),
    guardianConfirmed: privacyStrictTrue_(row.guardianConfirmed),
    guardianName: String(row.guardianName || ''),
    consentedAt: privacyDateText_(row.consentedAt),
    withdrawnAt: privacyDateText_(row.withdrawnAt),
    updatedAt: privacyDateText_(row.updatedAt),
    source: String(row.source || '')
  };
}

function privacyStrictTrue_(value) {
  if (value === true || value === 1) return true;
  var text = String(value == null ? '' : value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'y' || text === '동의' || text === 'active';
}

function privacyClean_(value, maxLength) {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength || 300);
}

function privacyDateText_(value) {
  if (!value) return '';
  var date = value instanceof Date ? value : new Date(value);
  if (!isFinite(date.getTime())) return String(value || '');
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}

function privacyHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
