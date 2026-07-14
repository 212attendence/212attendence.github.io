from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"{label}: target not found")
    return text.replace(old, new, 1)


# Administrator settings: hide partial UI, load all status checks concurrently, then reveal once.
p = Path("admin/settings/index.html")
text = p.read_text(encoding="utf-8")
text = replace_once(
    text,
    '    body{background:var(--bg);overflow-x:hidden}\n',
    '    body{background:var(--bg);overflow-x:hidden}\n    body.settings-booting .app{visibility:hidden;opacity:0}body .app{transition:opacity .18s ease}\n',
    "settings boot CSS",
)
text = replace_once(text, '<body>\n', '<body class="settings-booting">\n', "settings body class")
text = replace_once(
    text,
    '''    document.addEventListener("DOMContentLoaded",function(){
      AttendanceApp.Theme.init();
      if(!AttendanceApp.Session.require("/admin/login/","/admin/settings/"))return;
      renderPasskey();
      checkServer();
    });
''',
    '''    document.addEventListener("DOMContentLoaded",async function(){
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
    });
''',
    "settings DOMContentLoaded",
)
marker = '''    async function configurePermissions(){
'''
inspect = '''    async function inspectPermissions(){
      const box=document.getElementById("permissionStatus");
      const notification=("Notification" in window)?Notification.permission:"지원 안 됨";
      let locationState=navigator.geolocation?"확인 필요":"지원 안 됨";
      if(navigator.permissions&&navigator.permissions.query&&navigator.geolocation){
        try{const result=await navigator.permissions.query({name:"geolocation"});locationState=result.state||"확인 필요"}catch(error){}
      }
      const notificationOk=notification==="granted",locationOk=locationState==="granted";
      box.className="status-box show "+(notificationOk&&locationOk?"ok":"warn");
      box.textContent="알림 "+notification+" · 위치 "+locationState;
      return{notification:notification,location:locationState};
    }

'''
if inspect not in text:
    text = replace_once(text, marker, inspect + marker, "permission inspector")
text = replace_once(
    text,
    '''        const notification=("Notification" in window)?Notification.permission:"지원 안 됨";
        box.className="status-box show "+(notification==="granted"?"ok":"warn");
        box.textContent=notification==="granted"?"알림 권한이 허용됐고 관리자 기기 등록을 요청했습니다.":"알림 권한 상태: "+notification+". 브라우저 사이트 설정도 확인하세요.";
''',
    '''        await inspectPermissions();
''',
    "permission result",
)
text = text.replace('/assets/app.js?v=25', '/assets/app.js?v=27', 1)
text = text.replace('/assets/role-app.js?v=25', '/assets/role-app.js?v=27', 1)
p.write_text(text, encoding="utf-8")


# Dashboard: one overlay, run log/server/device initialization together, reveal once.
p = Path("admin/dashboard/index.html")
text = p.read_text(encoding="utf-8")
text = replace_once(
    text,
    '    body{position:relative;overflow-x:hidden;background:var(--bg)}',
    '    body{position:relative;overflow-x:hidden;background:var(--bg)}body.dashboard-booting .app{visibility:hidden;opacity:0}body .app{transition:opacity .18s ease}',
    "dashboard boot CSS",
)
text = replace_once(text, '<body>\n', '<body class="dashboard-booting">\n', "dashboard body class")
old = '''      checkServerCompatibility();
      document.getElementById("todayText").textContent="2학년 12반 · "+new Date().toLocaleDateString("ko-KR")+" 출석 현황";
      renderPasskeySetting();
      document.addEventListener("keydown",function(event){if(event.key==="F1"){event.preventDefault();location.href="/admin/help/"}});

      const fastReturn=isInternalReturn();
      const warmStart=renderCachedDashboard(readSnapshot());
      const showOverlay=!fastReturn&&!warmStart;
      initialLoad=showOverlay;
      if(showOverlay)AttendanceApp.UI.loading("대시보드 로딩 중입니다","오늘 출석 현황을 불러옵니다.");else AttendanceApp.UI.stopLoading();

      const attendanceTask=loadTodayLogs(false,showOverlay);
      scheduleDeviceServices();
      if(showOverlay){
        await attendanceTask;
        initialLoad=false;
        AttendanceApp.UI.stopLoading();
        animateProgress(pendingRate);
      }
'''
new = '''      document.getElementById("todayText").textContent="2학년 12반 · "+new Date().toLocaleDateString("ko-KR")+" 출석 현황";
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
'''
text = replace_once(text, old, new, "dashboard initializer")
text = text.replace('../assets/app.js?v=25', '../assets/app.js?v=27', 1)
text = text.replace('/assets/role-app.js?v=25', '/assets/role-app.js?v=27', 1)
p.write_text(text, encoding="utf-8")
