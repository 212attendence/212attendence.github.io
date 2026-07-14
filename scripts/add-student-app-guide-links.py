from pathlib import Path


def save(path, text):
    Path(path).write_text(text, encoding="utf-8")


# Student identity screen: show app guide first, help below it, then device logout.
p = Path("student/identity/index.html")
text = p.read_text(encoding="utf-8")
text = text.replace(
    '.footer-links{display:flex;justify-content:center;gap:16px;margin-top:16px}.footer-links a,.footer-links button{border:0;background:none;color:var(--muted);font-size:12px;font-weight:800;text-decoration:none;cursor:pointer}',
    '.footer-links{display:grid;gap:8px;margin-top:16px}.footer-links a,.footer-links button{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:14px;background:var(--surface-soft);color:var(--text);font-size:12px;font-weight:850;text-decoration:none;text-align:center;cursor:pointer}.footer-links a:first-child{background:var(--student-soft);color:var(--student);border-color:color-mix(in srgb,var(--student) 24%,var(--line))}',
    1,
)
text = text.replace(
    '<div class="footer-links"><a href="/student/help/">도움말</a><button type="button" onclick="forgetDevice()">이 기기 로그인 해제</button></div>',
    '<div class="footer-links"><a href="/student/app-guide/">앱 설치 가이드</a><a href="/student/help/">도움말</a><button type="button" onclick="forgetDevice()">이 기기 로그인 해제</button></div>',
    1,
)
text = text.replace('/assets/app.js?v=22', '/assets/app.js?v=28')
text = text.replace('/assets/role-app.js?v=24', '/assets/role-app.js?v=28')
text = text.replace('/assets/student.js?v=22', '/assets/student.js?v=28')
save(p, text)


# Student login and approval waiting screens: app guide above help.
p = Path("student/login/index.html")
text = p.read_text(encoding="utf-8")
text = text.replace(
    '<a class="link-button" href="/student/help/">학생 도움말</a>',
    '<div class="actions-stack" style="margin-top:10px"><a class="btn btn-soft btn-block" href="/student/app-guide/">앱 설치 가이드</a><a class="btn btn-soft btn-block" href="/student/help/">학생 도움말</a></div>',
    1,
)
text = text.replace(
    '<a class="link-button" href="/student/help/">승인 절차 도움말</a>',
    '<div class="actions-stack" style="margin-top:10px"><a class="btn btn-soft btn-block" href="/student/app-guide/">앱 설치 가이드</a><a class="btn btn-soft btn-block" href="/student/help/">승인 절차 도움말</a></div>',
    1,
)
text = text.replace('/assets/app.js?v=22', '/assets/app.js?v=28')
text = text.replace('/assets/role-app.js?v=24', '/assets/role-app.js?v=28')
text = text.replace('/assets/student.js?v=22', '/assets/student.js?v=28')
save(p, text)


# Student help: direct guide shortcut, dedicated section, and bottom navigation.
p = Path("student/help/index.html")
text = p.read_text(encoding="utf-8")
text = text.replace(
    '<div class="quick"><a href="#login">로그인 방법</a><a href="#approval">관리자 승인</a><a href="#location-permission">위치 권한</a><a href="#attendance">출석 인증</a></div>',
    '<div class="quick"><a href="/student/app-guide/">앱 설치 가이드</a><a href="#login">로그인 방법</a><a href="#approval">관리자 승인</a><a href="#location-permission">위치 권한</a><a href="#attendance">출석 인증</a></div>',
    1,
)
text = text.replace(
    '<section class="section"><h2>5. 앱 설치·자동 확인·알림</h2><p>학생용 앱은 관리자용 앱과 별도로 설치됩니다. 앱을 처음 실행하면 한 화면에서 위치와 알림 권한 설정을 안내합니다.</p><ol class="steps"><li>최초 안내에서 <strong>권한 허용하고 시작</strong>을 한 번 누릅니다.</li><li>앱을 열거나 다시 활성화하면 오늘 출석 여부를 자동 확인합니다.</li><li>출석 인증이 완료되면 화면 메시지와 알림으로 결과를 알려줍니다.</li></ol><div class="warning">웹앱은 완전히 종료된 상태에서 GPS를 계속 실행할 수 없습니다. 자동 인증은 앱이 열리거나 화면이 다시 활성화된 때 작동합니다.</div></section>',
    '<section id="app-install" class="section"><h2>5. 앱 설치·자동 확인·알림</h2><p>학생용 앱은 관리자용 앱과 별도로 설치됩니다. 기기별 설치 방법은 전용 가이드에서 바로 확인할 수 있습니다.</p><div class="actions-stack" style="margin-top:12px"><a class="btn btn-primary btn-block" href="/student/app-guide/">앱 설치 가이드 바로가기</a></div><ol class="steps"><li>최초 안내에서 <strong>권한 허용하고 시작</strong>을 한 번 누릅니다.</li><li>앱을 열거나 다시 활성화하면 오늘 출석 여부를 자동 확인합니다.</li><li>출석 인증이 완료되면 화면 메시지와 알림으로 결과를 알려줍니다.</li></ol><div class="warning">웹앱은 완전히 종료된 상태에서 GPS를 계속 실행할 수 없습니다. 자동 인증은 앱이 열리거나 화면이 다시 활성화된 때 작동합니다.</div></section>',
    1,
)
text = text.replace(
    '<div class="actions-stack"><a class="btn btn-primary btn-block" href="/student/login/">학생 로그인으로 이동</a><a class="btn btn-soft btn-block" href="../">처음 화면으로 이동</a></div>',
    '<div class="actions-stack"><a class="btn btn-primary btn-block" href="/student/app-guide/">앱 설치 가이드</a><a class="btn btn-soft btn-block" href="/student/login/">학생 로그인으로 이동</a><a class="btn btn-soft btn-block" href="../">처음 화면으로 이동</a></div>',
    1,
)
text = text.replace('/assets/app.js?v=21', '/assets/app.js?v=28')
text = text.replace('/assets/role-app.js?v=24', '/assets/role-app.js?v=28')
save(p, text)
