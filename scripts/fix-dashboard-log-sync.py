from pathlib import Path


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


# Administrator dashboard: merge roster response with raw 전체로그 rows.
p = Path('admin/dashboard/index.html')
text = p.read_text(encoding='utf-8')
text = text.replace('../assets/app.js?v=21', '../assets/app.js?v=25', 1)
text = text.replace('/assets/role-app.js?v=24', '/assets/role-app.js?v=25', 1)
text = text.replace('const SNAPSHOT_KEY="attendanceTodaySnapshotV1",SNAPSHOT_TTL=24*60*60*1000;', 'const SNAPSHOT_KEY="attendanceTodaySnapshotV2",SNAPSHOT_TTL=2*60*1000;', 1)
text = text.replace(
    'function authParams(action){const p=new URLSearchParams({action:action});AttendanceApp.Session.addAuthParams(p);return p}',
    'function authParams(action){const p=new URLSearchParams({action:action,_ts:String(Date.now())});AttendanceApp.Session.addAuthParams(p);return p}',
    1,
)
old = 'async function loadTodayLogs(showToast,deferAnimation){try{const r=await AttendanceApp.jsonp(AttendanceApp.apiUrl(APPS_SCRIPT_URL,authParams("todayLogs")));if(!r||!r.ok){if(AttendanceApp.Session.isUnauthorizedResponse(r)){AttendanceApp.Session.clear();location.replace("/admin/login/?next=/admin/dashboard/");return}throw new Error(r&&r.message||"로그 불러오기 실패")}const logs=normalizeLogs(r.logs||[]),summary=r.summary||{},registered=registeredStudentCount(r,summary);if(registered===0&&logs.length===0){location.replace("/admin/no-student-added/");return}saveSnapshot(r,registered);renderLogs(logs);renderSummary(logs,summary,r,deferAnimation);document.getElementById("logSub").textContent="마지막 업데이트 "+new Date().toLocaleTimeString("ko-KR");if(showToast)AttendanceApp.UI.toast("새로고침 완료")}catch(e){AttendanceApp.UI.toast(e.message||String(e),3600)}}'
new = '''function seoulDateKey(){const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()),map={};parts.forEach(x=>map[x.type]=x.value);return map.year+"-"+map.month+"-"+map.day}
    function attendanceStatus(value){const s=String(value||"");return s.includes("지각")?"지각":s.includes("출석")&&!s.includes("미출석")?"출석":""}
    function mergeDashboardRows(rosterRows,rawRows){const result=[],index={};(Array.isArray(rosterRows)?rosterRows:[]).forEach(function(row){const key=String(row.fingerId||row.지문ID||"");if(key)index[key]=result.length;result.push(row)});(Array.isArray(rawRows)?rawRows:[]).filter(function(row){return attendanceStatus(row.status||row.상태)}).sort(function(a,b){return String(a.time||a.시간||"").localeCompare(String(b.time||b.시간||""))}).forEach(function(row){const key=String(row.fingerId||row.지문ID||"");if(!key)return;const item={timestamp:row.timestamp||row.타임스탬프||"",time:row.time||row.시간||"-",status:attendanceStatus(row.status||row.상태),fingerId:key,name:row.name||row.이름||"-",message:row.message||row.메시지||""};if(index[key]===undefined){index[key]=result.length;result.push(item);return}const current=result[index[key]],currentStatus=attendanceStatus(current.status||current.상태);if(!currentStatus||String(item.time)<String(current.time||current.시간||"99:99:99"))result[index[key]]=Object.assign({},current,item)});return result}
    function uniqueStudentCount(rows){const ids={};(Array.isArray(rows)?rows:[]).forEach(function(row){const id=String(row.fingerId||row.지문ID||"");if(id)ids[id]=true});return Object.keys(ids).length}
    async function loadTodayLogs(showToast,deferAnimation){try{const summaryParams=authParams("todayLogs"),rawParams=authParams("logsByDate");rawParams.set("date",seoulDateKey());const responses=await Promise.all([AttendanceApp.jsonp(AttendanceApp.apiUrl(APPS_SCRIPT_URL,summaryParams),{timeoutMs:22000}),AttendanceApp.jsonp(AttendanceApp.apiUrl(APPS_SCRIPT_URL,rawParams),{timeoutMs:22000}).catch(function(){return null})]),r=responses[0],raw=responses[1];if(!r||!r.ok){if(AttendanceApp.Session.isUnauthorizedResponse(r)){AttendanceApp.Session.clear();location.replace("/admin/login/?next=/admin/dashboard/");return}throw new Error(r&&r.message||"로그 불러오기 실패")}const mergedRows=mergeDashboardRows(r.logs||[],raw&&raw.ok?raw.logs||[]:[]),logs=normalizeLogs(mergedRows),serverCount=registeredStudentCount(r,r.summary||{})||0,registered=Math.max(serverCount,uniqueStudentCount(mergedRows)),mergedResponse=Object.assign({},r,{logs:mergedRows,summary:{},registeredStudentCount:registered,studentCount:registered});if(registered===0&&logs.length===0){location.replace("/admin/no-student-added/");return}saveSnapshot(mergedResponse,registered);renderLogs(logs);renderSummary(logs,{},mergedResponse,deferAnimation);document.getElementById("logSub").textContent="전체로그 동기화 완료 · "+new Date().toLocaleTimeString("ko-KR");if(showToast)AttendanceApp.UI.toast("최신 전체로그로 새로고침했습니다.")}catch(e){document.getElementById("logSub").textContent="서버 동기화 실패 · 저장된 화면 표시 중";AttendanceApp.UI.toast(e.message||String(e),4200)}}'''
if old not in text:
    raise SystemExit('dashboard loadTodayLogs block not found')
text = text.replace(old, new, 1)
write(p, text)


# Attendance-rate page: use the same merged source when opened directly.
p = Path('admin/attendance-rate/index.html')
text = p.read_text(encoding='utf-8')
text = text.replace('../assets/app.js?v=21', '../assets/app.js?v=25', 1)
text = text.replace('/assets/role-app.js?v=24', '/assets/role-app.js?v=25', 1)
old = '''        const r=await AttendanceApp.jsonp(AttendanceApp.apiUrl(APPS_SCRIPT_URL,p));
        if(!r||!r.ok){
          if(AttendanceApp.Session.isUnauthorizedResponse(r)){AttendanceApp.Session.clear();location.replace("/admin/login/?next=/admin/attendance-rate/");return}
          throw new Error(r&&r.message||"출석 데이터를 불러오지 못했습니다.");
        }
        const logs=r.logs||[],summary=r.summary||{},registered=registeredStudentCount(r,summary);
        if(registered===0&&!logs.length){location.replace("/admin/no-student-added/");return}
        saveSnapshot(r,registered);
        render(applyCutoff(rawCounts(logs,summary,r)));'''
new = '''        p.set("_ts",String(Date.now()));
        const dateParts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()),dateMap={};dateParts.forEach(x=>dateMap[x.type]=x.value);const dateKey=dateMap.year+"-"+dateMap.month+"-"+dateMap.day;
        const rawParams=new URLSearchParams({action:"logsByDate",date:dateKey,_ts:String(Date.now())});AttendanceApp.Session.addAuthParams(rawParams);
        const results=await Promise.all([AttendanceApp.jsonp(AttendanceApp.apiUrl(APPS_SCRIPT_URL,p)),AttendanceApp.jsonp(AttendanceApp.apiUrl(APPS_SCRIPT_URL,rawParams)).catch(function(){return null})]),r=results[0],raw=results[1];
        if(!r||!r.ok){
          if(AttendanceApp.Session.isUnauthorizedResponse(r)){AttendanceApp.Session.clear();location.replace("/admin/login/?next=/admin/attendance-rate/");return}
          throw new Error(r&&r.message||"출석 데이터를 불러오지 못했습니다.");
        }
        const base=Array.isArray(r.logs)?r.logs.slice():[],byFinger={};base.forEach(function(row,i){const key=String(row.fingerId||row.지문ID||"");if(key)byFinger[key]=i});if(raw&&raw.ok&&Array.isArray(raw.logs))raw.logs.filter(function(row){const s=String(row.status||row.상태||"");return s.includes("지각")||(s.includes("출석")&&!s.includes("미출석"))}).forEach(function(row){const key=String(row.fingerId||row.지문ID||"");if(!key)return;const item={time:row.time||row.시간||"-",status:row.status||row.상태||"출석",fingerId:key,name:row.name||row.이름||"-"};if(byFinger[key]===undefined){byFinger[key]=base.length;base.push(item)}else{const cur=base[byFinger[key]],s=String(cur.status||"");if(!s.includes("출석")&&!s.includes("지각"))base[byFinger[key]]=Object.assign({},cur,item)}});
        const unique={};base.forEach(function(row){const key=String(row.fingerId||"");if(key)unique[key]=true});const registered=Math.max(registeredStudentCount(r,r.summary||{})||0,Object.keys(unique).length),merged=Object.assign({},r,{logs:base,summary:{},registeredStudentCount:registered,studentCount:registered});
        if(registered===0&&!base.length){location.replace("/admin/no-student-added/");return}
        saveSnapshot(merged,registered);
        render(applyCutoff(rawCounts(base,{},merged)));'''
if old not in text:
    raise SystemExit('attendance-rate load block not found')
text = text.replace(old, new, 1)
write(p, text)
