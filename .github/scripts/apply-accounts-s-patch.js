const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, value) {
  fs.writeFileSync(path, value, 'utf8');
}

function replaceOnce(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) throw new Error('Patch target not found: ' + label);
  return source.replace(search, replacement);
}

// 1. Remove the circular GPS symbol from the permission error page.
{
  const path = 'student/error/gps/index.html';
  let html = read(path);
  html = html.replace(/\.gps-icon\{[^}]*\}/, '');
  html = html.replace(/\s*<div class="gps-icon">◎<\/div>\s*/, '\n    ');
  write(path, html);
}

// 2. Add the student-account button to the administrator dashboard.
{
  const path = 'admin/dashboard/index.html';
  let html = read(path);
  html = replaceOnce(
    html,
    '.btn.help::before{content:"?";',
    '.btn.accounts::before{content:"S";display:grid;place-items:center;width:17px;height:17px;border:1px solid currentColor;border-radius:6px;font-size:10px}.btn.help::before{content:"?";',
    'dashboard account button style'
  );
  html = replaceOnce(
    html,
    '<a class="btn btn-soft help" href="/admin/help/" title="도움말 · F1">도움말</a>',
    '<a class="btn btn-soft accounts" href="/accounts-s/">학생계정 관리</a><a class="btn btn-soft help" href="/admin/help/" title="도움말 · F1">도움말</a>',
    'dashboard account button'
  );
  write(path, html);
}

// 3. Permit the administrator login page to return directly to /accounts-s/.
{
  const path = 'admin/login/index.html';
  let html = read(path);
  html = replaceOnce(
    html,
    'const ALLOWED_NEXT = ["/admin/dashboard/", "/admin/choose-login-method/", "/admin/setup-login-method/"];',
    'const ALLOWED_NEXT = ["/admin/dashboard/", "/admin/choose-login-method/", "/admin/setup-login-method/", "/accounts-s/"];',
    'admin login allowed next route'
  );
  write(path, html);
}

// 4. Add authenticated student-account management endpoints to Apps Script.
{
  const path = 'apps-script/student-auth-addon.gs';
  let code = read(path);
  code = replaceOnce(
    code,
    '    adminDecideStudentRequestJsonp: adminDecideStudentRequestJsonp_,\n    adminSaveSchoolLocationJsonp: adminSaveSchoolLocationJsonp_',
    '    adminDecideStudentRequestJsonp: adminDecideStudentRequestJsonp_,\n    adminStudentAccountsJsonp: adminStudentAccountsJsonp_,\n    adminSaveStudentAccountJsonp: adminSaveStudentAccountJsonp_,\n    adminResetStudentPasswordsJsonp: adminResetStudentPasswordsJsonp_,\n    adminToggleStudentAccountJsonp: adminToggleStudentAccountJsonp_,\n    adminSaveSchoolLocationJsonp: adminSaveSchoolLocationJsonp_',
    'student account action handlers'
  );

  const marker = 'function adminSaveSchoolLocationJsonp_(e) {';
  if (!code.includes('function adminStudentAccountsJsonp_(e) {')) {
    if (!code.includes(marker)) throw new Error('Apps Script insertion marker not found');
    const block = `function adminStudentAccountsJsonp_(e) {
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

  if (!studentId || studentId.length > 40 || studentId.indexOf(',') >= 0) {
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

`;
    code = code.replace(marker, block + marker);
  }
  write(path, code);
}

// 5. Document the new administrator route.
{
  const path = 'README.md';
  let text = read(path);
  if (!text.includes('`/accounts-s/`')) {
    text = text.replace('- `/admin/dashboard/` — 오늘 출석 현황, ESP32/MQTT 상태, 학생 로그인 승인 알림', '- `/admin/dashboard/` — 오늘 출석 현황, ESP32/MQTT 상태, 학생 로그인 승인 알림\n- `/accounts-s/` — 관리자 전용 학생계정, 상태 및 임시비밀번호 관리');
  }
  write(path, text);
}

console.log('Student account management patch applied.');
