/*
 * 관리자 지정 비밀번호·학생 개인정보 동의 POST 전송 확장
 *
 * 기존 Code.gs의 doPost(e) 시작 부분에 아래 코드를 추가하세요.
 *
 *   var securePostResponse = handleStudentSecurePost_(e);
 *   if (securePostResponse) return securePostResponse;
 *
 * 이전 함수명 handleStudentPasswordPost_도 호환용으로 유지합니다.
 * student-privacy-resilience-addon.gs와 함께 사용합니다.
 */

function handleStudentSecurePost_(e) {
  var p = e && e.parameter || {};
  var action = String(p.action || '');
  if (action === 'adminSetStudentPasswordPost') {
    return studentSecurePostExecute_(e, 'attendance-admin-password-post', adminSetStudentPasswordJsonp_);
  }
  if (action === 'studentSavePrivacyConsentPost') {
    return studentSecurePostExecute_(e, 'attendance-student-privacy-post', studentSavePrivacyConsentJsonp_);
  }
  if (action === 'studentWithdrawPrivacyConsentPost') {
    return studentSecurePostExecute_(e, 'attendance-student-privacy-post', studentWithdrawPrivacyConsentJsonp_);
  }
  return null;
}

function handleStudentPasswordPost_(e) {
  return handleStudentSecurePost_(e);
}

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
      code: error && error.code || 'STUDENT_SECURE_POST_ERROR',
      message: error && error.message || String(error)
    };
  }
  return privacyPostMessageResponse_(responseOrigin, responseToken, channel, payload);
}

function privacySafeOrigin_(value) {
  var origin = String(value || '');
  if (origin === 'https://212attendence.github.io') return origin;
  return 'https://212attendence.github.io';
}

function privacyPostMessageResponse_(origin, responseToken, channel, payload) {
  var data = {
    channel: String(channel || 'attendance-secure-post'),
    responseToken: String(responseToken || ''),
    payload: payload || { ok: false, message: '응답이 없습니다.' }
  };
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
    '<script>' +
    'window.parent.postMessage(' + JSON.stringify(data).replace(/</g, '\\u003c') + ',' + JSON.stringify(origin) + ');' +
    '<\/script></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
