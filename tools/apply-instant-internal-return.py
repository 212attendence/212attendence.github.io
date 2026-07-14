from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, path):
    if old not in text:
        raise RuntimeError(f"Expected text not found in {path}: {old[:120]!r}")
    return text.replace(old, new, 1)


# 1) Shared internal-navigation detector.
path = "assets/app.js"
text = read(path)
anchor = '  function apiUrl(base, params) { return base + "?" + params.toString(); }\n'
navigation = r'''

  const Navigation = {
    key: "attendanceInternalNavigationV1",
    ttlMs: 5 * 60 * 1000,
    bound: false,

    normalize(value) {
      try {
        const url = new URL(value || location.href, location.origin);
        return (url.pathname.replace(/\/+$/, "") || "/");
      } catch (error) {
        return String(value || "/").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
      }
    },

    mark(target) {
      try {
        const url = new URL(target, location.href);
        if (url.origin !== location.origin) return false;
        safeStorage(sessionStorage, "set", this.key, JSON.stringify({
          from: this.normalize(location.href),
          to: this.normalize(url.href),
          at: Date.now()
        }));
        return true;
      } catch (error) {
        return false;
      }
    },

    isFastEntry() {
      try {
        const entries = performance.getEntriesByType && performance.getEntriesByType("navigation");
        if (entries && entries[0] && entries[0].type === "back_forward") return true;
      } catch (error) {}
      try {
        const record = JSON.parse(safeStorage(sessionStorage, "get", this.key) || "null");
        if (!record || Date.now() - Number(record.at || 0) > this.ttlMs) return false;
        return this.normalize(record.to) === this.normalize(location.href);
      } catch (error) {
        return false;
      }
    },

    bind() {
      if (this.bound) return;
      this.bound = true;
      const self = this;
      document.addEventListener("click", function (event) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
        if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
        const href = link.getAttribute("href") || "";
        if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
        self.mark(link.href);
      }, true);
    }
  };
'''
text = replace_once(text, anchor, anchor + navigation, path)
text = replace_once(
    text,
    '    apiUrl: apiUrl,\n    AdminStudentNotifications: AdminStudentNotifications',
    '    apiUrl: apiUrl,\n    Navigation: Navigation,\n    AdminStudentNotifications: AdminStudentNotifications',
    path,
)
text = replace_once(
    text,
    '  document.addEventListener("DOMContentLoaded", function () {\n    AdminStudentNotifications.init();\n  });',
    '  document.addEventListener("DOMContentLoaded", function () {\n    Navigation.bind();\n    AdminStudentNotifications.init();\n  });',
    path,
)
text = text.replace('version: "13.0.0"', 'version: "14.0.0"', 1)
write(path, text)


# 2) Dashboard: instant cached render on internal return, silent refresh afterwards.
path = "admin/dashboard/index.html"
text = read(path)
old = '''    document.addEventListener("DOMContentLoaded",async function(){
      AttendanceApp.Theme.init();
      if(!AttendanceApp.Session.require("/admin/login/","/admin/dashboard/"))return;
      document.getElementById("todayText").textContent="2학년 12반 · "+new Date().toLocaleDateString("ko-KR")+" 출석 현황";
      renderPasskeySetting();
      document.addEventListener("keydown",function(event){if(event.key==="F1"){event.preventDefault();location.href="/admin/help/"}});

      isInternalReturn();
      renderCachedDashboard(readSnapshot());
      initialLoad=true;
      AttendanceApp.UI.loading("대시보드를 한 번에 불러오는 중입니다","출석 로그, 서버 상태와 실시간 연결을 동시에 확인합니다.");
      try{
        await Promise.allSettled([
          loadTodayLogs(false,true),
          checkServerCompatibility(),
          startDeviceServices()
        ]);
      }finally{
        initialLoad=false;
        document.body.classList.remove("dashboard-booting");
        AttendanceApp.UI.stopLoading();
        animateProgress(pendingRate);
      }
    });'''
new = '''    document.addEventListener("DOMContentLoaded",async function(){
      AttendanceApp.Theme.init();
      if(!AttendanceApp.Session.require("/admin/login/","/admin/dashboard/"))return;
      document.getElementById("todayText").textContent="2학년 12반 · "+new Date().toLocaleDateString("ko-KR")+" 출석 현황";
      renderPasskeySetting();
      document.addEventListener("keydown",function(event){if(event.key==="F1"){event.preventDefault();location.href="/admin/help/"}});

      const fastEntry=(AttendanceApp.Navigation&&AttendanceApp.Navigation.isFastEntry())||isInternalReturn();
      const cached=readSnapshot();
      if(cached)renderCachedDashboard(cached);

      if(fastEntry){
        initialLoad=false;
        document.body.classList.remove("dashboard-booting");
        AttendanceApp.UI.stopLoading();
        if(cached)animateProgress(pendingRate);
        Promise.allSettled([
          loadTodayLogs(false,false),
          checkServerCompatibility(),
          startDeviceServices()
        ]).then(function(){animateProgress(pendingRate)});
        return;
      }

      initialLoad=true;
      AttendanceApp.UI.loading("대시보드를 한 번에 불러오는 중입니다","출석 로그, 서버 상태와 실시간 연결을 동시에 확인합니다.");
      try{
        await Promise.allSettled([
          loadTodayLogs(false,true),
          checkServerCompatibility(),
          startDeviceServices()
        ]);
      }finally{
        initialLoad=false;
        document.body.classList.remove("dashboard-booting");
        AttendanceApp.UI.stopLoading();
        animateProgress(pendingRate);
      }
    });'''
text = replace_once(text, old, new, path)
text = replace_once(
    text,
    '    function openAttendanceRate(){sessionStorage.setItem("dashboardFastReturn","1");location.href="/admin/attendance-rate/"}',
    '    function openAttendanceRate(){sessionStorage.setItem("dashboardFastReturn","1");sessionStorage.setItem("attendanceReturnToDashboard","1");if(AttendanceApp.Navigation)AttendanceApp.Navigation.mark("/admin/attendance-rate/");location.href="/admin/attendance-rate/"}',
    path,
)
text = re.sub(r'app\.js\?v=\d+', 'app.js?v=30', text)
text = re.sub(r'role-app\.js\?v=\d+', 'role-app.js?v=30', text)
write(path, text)


# 3) Settings: show immediately on internal return; status checks continue silently.
path = "admin/settings/index.html"
text = read(path)
old = '''    document.addEventListener("DOMContentLoaded",async function(){
      AttendanceApp.Theme.init();
      if(!AttendanceApp.Session.require("/admin/login/","/admin/settings/"))return;
      AttendanceApp.UI.loading("관리자 설정을 불러오는 중입니다","패스키, 권한과 서버 상태를 동시에 확인합니다.");
      try{
        await Promise.allSettled([
          Promise.resolve().then(renderPasskey),
          inspectPermissions(),
          checkServer()
        ]);
      }finally{
        document.body.classList.remove("settings-booting");
        AttendanceApp.UI.stopLoading();
      }
    });'''
new = '''    document.addEventListener("DOMContentLoaded",async function(){
      AttendanceApp.Theme.init();
      if(!AttendanceApp.Session.require("/admin/login/","/admin/settings/"))return;
      const fastEntry=AttendanceApp.Navigation&&AttendanceApp.Navigation.isFastEntry();
      renderPasskey();

      if(fastEntry){
        document.body.classList.remove("settings-booting");
        AttendanceApp.UI.stopLoading();
        Promise.allSettled([inspectPermissions(),checkServer()]);
        return;
      }

      AttendanceApp.UI.loading("관리자 설정을 불러오는 중입니다","패스키, 권한과 서버 상태를 동시에 확인합니다.");
      try{
        await Promise.allSettled([inspectPermissions(),checkServer()]);
      }finally{
        document.body.classList.remove("settings-booting");
        AttendanceApp.UI.stopLoading();
      }
    });'''
text = replace_once(text, old, new, path)
text = re.sub(r'app\.js\?v=\d+', 'app.js?v=30', text)
text = re.sub(r'role-app\.js\?v=\d+', 'role-app.js?v=30', text)
write(path, text)


# 4) Student account management: cache the previous list and refresh silently.
path = "accounts-s/index.html"
text = read(path)
text = replace_once(
    text,
    '    let accounts=[],editingId="",busy=false;\n',
    '    const ACCOUNTS_SNAPSHOT_KEY="studentAccountsSnapshotV1",ACCOUNTS_SNAPSHOT_TTL=10*60*1000;\n    let accounts=[],editingId="",busy=false;\n',
    path,
)
old = '''    document.addEventListener("DOMContentLoaded",function(){
      AttendanceApp.Theme.init();
      if(!AttendanceApp.Session.require("/admin/login/","/accounts-s/"))return;
      loadAccounts(false);
    });'''
new = '''    document.addEventListener("DOMContentLoaded",function(){
      AttendanceApp.Theme.init();
      if(!AttendanceApp.Session.require("/admin/login/","/accounts-s/"))return;
      const fastEntry=AttendanceApp.Navigation&&AttendanceApp.Navigation.isFastEntry();
      const cached=readAccountsSnapshot();
      if(cached){accounts=cached.accounts;renderAccounts();renderStats(cached)}
      loadAccounts(false,Boolean(fastEntry));
    });'''
text = replace_once(text, old, new, path)
old = '''    async function loadAccounts(showToast){if(busy)return;busy=true;setLoading(accounts.length===0,"학생계정 확인 중입니다","Google Sheets의 학생계정을 불러옵니다.");try{const result=await callApi("adminStudentAccountsJsonp",{});accounts=Array.isArray(result.accounts)?result.accounts:[];renderAccounts();renderStats(result);if(showToast)AttendanceApp.UI.toast("학생계정을 새로고침했습니다.")}catch(error){document.getElementById("accountsBody").innerHTML='<tr><td colspan="8"><div class="empty">'+AttendanceApp.UI.escapeHtml(error.message||String(error))+'</div></td></tr>';AttendanceApp.UI.toast(error.message||String(error),4200)}finally{busy=false;setLoading(false)}}'''
new = '''    function readAccountsSnapshot(){try{const value=JSON.parse(sessionStorage.getItem(ACCOUNTS_SNAPSHOT_KEY)||localStorage.getItem(ACCOUNTS_SNAPSHOT_KEY)||"null");return value&&Array.isArray(value.accounts)&&Date.now()-Number(value.savedAt||0)<ACCOUNTS_SNAPSHOT_TTL?value:null}catch(error){return null}}
    function saveAccountsSnapshot(result){const value=JSON.stringify({savedAt:Date.now(),accounts:accounts,activeSessionCount:Number(result&&result.activeSessionCount||0)});try{sessionStorage.setItem(ACCOUNTS_SNAPSHOT_KEY,value)}catch(error){}try{localStorage.setItem(ACCOUNTS_SNAPSHOT_KEY,value)}catch(error){}}
    async function loadAccounts(showToast,silent){if(busy)return;busy=true;const showOverlay=!silent&&accounts.length===0;if(showOverlay)setLoading(true,"학생계정 확인 중입니다","Google Sheets의 학생계정을 불러옵니다.");try{const result=await callApi("adminStudentAccountsJsonp",{});accounts=Array.isArray(result.accounts)?result.accounts:[];saveAccountsSnapshot(result);renderAccounts();renderStats(result);if(showToast)AttendanceApp.UI.toast("학생계정을 새로고침했습니다.")}catch(error){if(!accounts.length)document.getElementById("accountsBody").innerHTML='<tr><td colspan="8"><div class="empty">'+AttendanceApp.UI.escapeHtml(error.message||String(error))+'</div></td></tr>';AttendanceApp.UI.toast(error.message||String(error),4200)}finally{busy=false;if(showOverlay)setLoading(false)}}'''
text = replace_once(text, old, new, path)
text = re.sub(r'app\.js\?v=\d+', 'app.js?v=30', text)
text = re.sub(r'role-app\.js\?v=\d+', 'role-app.js?v=30', text)
write(path, text)


# 5) Attendance-rate page: reuse dashboard snapshot and never block an internal return.
path = "admin/attendance-rate/index.html"
text = read(path)
text = replace_once(text, '    const SNAPSHOT_KEY="attendanceTodaySnapshotV1";', '    const SNAPSHOT_KEY="attendanceTodaySnapshotV2";', path)
old = '''    document.addEventListener("DOMContentLoaded",function(){
      AttendanceApp.Theme.init();
      if(!AttendanceApp.Session.require("/admin/login/","/admin/attendance-rate/"))return;
      document.getElementById("dateText").textContent="2학년 12반 · "+new Date().toLocaleDateString("ko-KR")+" 현황";
      const cached=readSnapshot();
      if(cached){
        const registered=registeredStudentCount(cached,cached.summary||{});
        if(registered===0&&!(cached.logs||[]).length){location.replace("/admin/no-student-added/");return}
        render(applyCutoff(rawCounts(cached.logs||[],cached.summary||{},cached)));
        loadData(false,false);
      }else{
        loadData(false,true);
      }
    });'''
new = '''    document.addEventListener("DOMContentLoaded",function(){
      AttendanceApp.Theme.init();
      if(!AttendanceApp.Session.require("/admin/login/","/admin/attendance-rate/"))return;
      document.getElementById("dateText").textContent="2학년 12반 · "+new Date().toLocaleDateString("ko-KR")+" 현황";
      const fastEntry=AttendanceApp.Navigation&&AttendanceApp.Navigation.isFastEntry();
      const cached=readSnapshot();
      if(cached){
        const registered=registeredStudentCount(cached,cached.summary||{});
        if(registered===0&&!(cached.logs||[]).length){location.replace("/admin/no-student-added/");return}
        render(applyCutoff(rawCounts(cached.logs||[],cached.summary||{},cached)));
      }
      loadData(false,!(cached||fastEntry));
    });'''
text = replace_once(text, old, new, path)
old = '''    function returnToDashboard(){
      const fromDashboard=sessionStorage.getItem("attendanceReturnToDashboard")==="1";
      sessionStorage.removeItem("attendanceReturnToDashboard");
      AttendanceApp.UI.stopLoading();
      if(fromDashboard&&history.length>1){history.back();return}
      location.replace("/admin/dashboard/");
    }'''
new = '''    function returnToDashboard(){
      const fromDashboard=sessionStorage.getItem("attendanceReturnToDashboard")==="1";
      sessionStorage.removeItem("attendanceReturnToDashboard");
      sessionStorage.setItem("dashboardFastReturn","1");
      if(AttendanceApp.Navigation)AttendanceApp.Navigation.mark("/admin/dashboard/");
      AttendanceApp.UI.stopLoading();
      if(fromDashboard&&history.length>1){history.back();return}
      location.replace("/admin/dashboard/?resume=1");
    }'''
text = replace_once(text, old, new, path)
old = '    function readSnapshot(){try{const s=JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY)||"null");return s&&Date.now()-Number(s.savedAt||0)<300000?s:null}catch(e){return null}}\n    function saveSnapshot(response,registered){try{sessionStorage.setItem(SNAPSHOT_KEY,JSON.stringify({savedAt:Date.now(),logs:response.logs||[],summary:response.summary||{},registeredStudentCount:registered}))}catch(e){}}'
new = '    function parseSnapshot(value){try{const s=JSON.parse(value||"null"),saved=Number(s&&s.savedAt||0),a=new Date(saved),b=new Date();return s&&saved&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()?s:null}catch(e){return null}}\n    function readSnapshot(){return parseSnapshot(sessionStorage.getItem(SNAPSHOT_KEY))||parseSnapshot(localStorage.getItem(SNAPSHOT_KEY))}\n    function saveSnapshot(response,registered){const value=JSON.stringify({savedAt:Date.now(),logs:response.logs||[],summary:response.summary||{},registeredStudentCount:registered});try{sessionStorage.setItem(SNAPSHOT_KEY,value)}catch(e){}try{localStorage.setItem(SNAPSHOT_KEY,value)}catch(e){}}'
text = replace_once(text, old, new, path)
text = re.sub(r'app\.js\?v=\d+', 'app.js?v=30', text)
text = re.sub(r'role-app\.js\?v=\d+', 'role-app.js?v=30', text)
write(path, text)

print("Applied instant internal-return navigation to shared app and data pages.")
