/*
 * 기존 Code.gs에 아래 내용을 반영하세요.
 * 기존 doGet/doPost/setup 전체를 대체하는 파일이 아니라 연결용 최종 스니펫입니다.
 */

/* doGet(e) 안에서 action 값을 읽은 직후 */
var privacyResponse = handleStudentPrivacyAction_(action, e);
if (privacyResponse) return privacyResponse;

var studentResponse = handleStudentAuthAction_(action, e);
if (studentResponse) return studentResponse;

/* doPost(e) 함수 시작 부분 */
var securePostResponse = handleStudentSecurePost_(e);
if (securePostResponse) return securePostResponse;

/* 기존 setup() 함수 마지막 */
setupStudentAuth_();
setupStudentPrivacyResilience_();
