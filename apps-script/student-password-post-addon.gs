/*
 * 관리자 지정 학생 비밀번호 POST 전송 확장
 *
 * 기존 Code.gs의 doPost(e) 시작 부분에 아래 코드를 추가하세요.
 *
 *   var passwordPostResponse = handleStudentPasswordPost_(e);
 *   if (passwordPostResponse) return passwordPostResponse;
 *
 * student-privacy-resilience-addon.gs와 함께 사용합니다.
 */

function handleStudentPasswordPost_(e) {
  var p = e && e.parameter || {};
  if (String(p.action || '') !== 'adminSetStudentPasswordPost') return null;
  var responseToken = privacyClean_(p.responseToken, 100);
  var responseOrigin = privacySafeOrigin_(p.responseOrigin);
  var payload;
  try {
    payload = adminSetStudentPasswordJsonp_(e);
  } catch (error) {
    payload = {
      ok: false,
      code: error && error.code || 'ADMIN_PASSWORD_POST_ERROR',
      message: error && error.message || String(error)
    };
  }
  return privacyPostMessageResponse_(responseOrigin, responseToken, payload);
}

function privacySafeOrigin_(value) {
  var origin = String(value || '');
  if (origin === 'https://212attendence.github.io') return origin;
  return 'https://212attendence.github.io';
}

function privacyPostMessageResponse_(origin, responseToken, payload) {
  var data = {
    channel: 'attendance-admin-password-post',
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
