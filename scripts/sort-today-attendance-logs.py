from pathlib import Path

path = Path('admin/dashboard/index.html')
text = path.read_text(encoding='utf-8')

old = '''    function normalizeLogs(rows){return Array.isArray(rows)?rows.map(r=>({time:r.time||r.시간||r.timestamp||"-",status:r.status||r.상태||"-",name:r.name||r.이름||"-",fingerId:r.fingerId||r.지문ID||"-"})).reverse():[]}
    function renderLogs(logs){const el=document.getElementById("logList");if(!logs.length){el.innerHTML='<div class="log-row"><div>-</div><div><span class="status-chip notyet">없음</span></div><div>오늘 출석 로그가 없습니다.</div><div>-</div></div>';return}el.innerHTML=logs.map(x=>'<div class="log-row"><div>'+AttendanceApp.UI.escapeHtml(formatTime(x.time))+'</div><div><span class="status-chip '+statusClass(x.status)+'">'+AttendanceApp.UI.escapeHtml(x.status)+'</span></div><div>'+AttendanceApp.UI.escapeHtml(x.name)+'</div><div>'+AttendanceApp.UI.escapeHtml(x.fingerId)+'</div></div>').join("")}
'''

new = '''    function logStatusRank(value){const s=String(value||"");if((s.includes("출석")&&!s.includes("미출석"))||s.includes("정상"))return 0;if(s.includes("지각"))return 1;if(s.includes("미출석")||s.includes("결석"))return 2;return 3}
    function logTimeValue(value){const m=String(value||"").match(/(\\d{1,2}):(\\d{2})(?::(\\d{2}))?/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]||0):0}
    function displayLogStatus(value){const s=String(value||"");return s.includes("출석")&&!s.includes("미출석")?"정상":s}
    function normalizeLogs(rows){return Array.isArray(rows)?rows.map(r=>({time:r.time||r.시간||r.timestamp||"-",status:r.status||r.상태||"-",name:r.name||r.이름||"-",fingerId:r.fingerId||r.지문ID||"-"})).sort(function(a,b){const rank=logStatusRank(a.status)-logStatusRank(b.status);if(rank)return rank;const time=logTimeValue(b.time)-logTimeValue(a.time);if(time)return time;return String(a.name||"").localeCompare(String(b.name||""),"ko")}):[]}
    function renderLogs(logs){const el=document.getElementById("logList");if(!logs.length){el.innerHTML='<div class="log-row"><div>-</div><div><span class="status-chip notyet">없음</span></div><div>오늘 출석 로그가 없습니다.</div><div>-</div></div>';return}el.innerHTML=logs.map(x=>'<div class="log-row"><div>'+AttendanceApp.UI.escapeHtml(formatTime(x.time))+'</div><div><span class="status-chip '+statusClass(x.status)+'">'+AttendanceApp.UI.escapeHtml(displayLogStatus(x.status))+'</span></div><div>'+AttendanceApp.UI.escapeHtml(x.name)+'</div><div>'+AttendanceApp.UI.escapeHtml(x.fingerId)+'</div></div>').join("")}
'''

if old not in text:
    raise SystemExit('target log functions not found')

text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
