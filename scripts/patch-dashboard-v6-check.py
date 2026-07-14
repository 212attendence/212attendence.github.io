from pathlib import Path

p = Path('admin/dashboard/index.html')
text = p.read_text(encoding='utf-8')

text = text.replace('../assets/app.js?v=25', '../assets/app.js?v=26')
text = text.replace('/assets/role-app.js?v=25', '/assets/role-app.js?v=26')

needle = '''      if(!AttendanceApp.Session.require("/admin/login/","/admin/dashboard/"))return;
      document.getElementById("todayText").textContent="2학년 12반 · "+new Date().toLocaleDateString("ko-KR")+" 출석 현황";'''
replacement = '''      if(!AttendanceApp.Session.require("/admin/login/","/admin/dashboard/"))return;
      checkServerCompatibility();
      document.getElementById("todayText").textContent="2학년 12반 · "+new Date().toLocaleDateString("ko-KR")+" 출석 현황";'''
if needle in text:
    text = text.replace(needle, replacement, 1)

marker = '    function scheduleDeviceServices()'
helper = '''    async function checkServerCompatibility(){
      try{
        const params=new URLSearchParams({action:"ping",_ts:String(Date.now())});
        const result=await AttendanceApp.jsonp(AttendanceApp.apiUrl(APPS_SCRIPT_URL,params),{timeoutMs:15000});
        const version=String(result&&result.version||"");
        if(!version.includes("server-v6")){
          document.getElementById("logSub").textContent="현재 "+(version||"구버전 서버")+" · V6 배포 필요";
          AttendanceApp.UI.toast("기존 시트 로그 연동을 위해 Apps Script V6를 배포하세요.",6500);
        }
      }catch(error){
        document.getElementById("logSub").textContent="Apps Script 서버 버전을 확인하지 못했습니다.";
      }
    }

'''
if marker in text and 'function checkServerCompatibility' not in text:
    text = text.replace(marker, helper + marker, 1)

p.write_text(text, encoding='utf-8')
