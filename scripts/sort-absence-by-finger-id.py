from pathlib import Path

path = Path('admin/dashboard/index.html')
text = path.read_text(encoding='utf-8')

old = '''function normalizeLogs(rows){return Array.isArray(rows)?rows.map(r=>({time:r.time||r.시간||r.timestamp||"-",status:r.status||r.상태||"-",name:r.name||r.이름||"-",fingerId:r.fingerId||r.지문ID||"-"})).sort(function(a,b){const rank=logStatusRank(a.status)-logStatusRank(b.status);if(rank)return rank;const time=logTimeValue(b.time)-logTimeValue(a.time);if(time)return time;return String(a.name||"").localeCompare(String(b.name||""),"ko")}):[]}'''

new = '''function fingerIdSortValue(value){const text=String(value==null?"":value).trim(),number=Number(text);return Number.isFinite(number)?{number:number,text:text}:{number:Number.MAX_SAFE_INTEGER,text:text}}\n    function normalizeLogs(rows){return Array.isArray(rows)?rows.map(r=>({time:r.time||r.시간||r.timestamp||"-",status:r.status||r.상태||"-",name:r.name||r.이름||"-",fingerId:r.fingerId||r.지문ID||"-"})).sort(function(a,b){const rankA=logStatusRank(a.status),rankB=logStatusRank(b.status),rank=rankA-rankB;if(rank)return rank;if(rankA===2){const idA=fingerIdSortValue(a.fingerId),idB=fingerIdSortValue(b.fingerId);if(idA.number!==idB.number)return idA.number-idB.number;const idText=idA.text.localeCompare(idB.text,"ko",{numeric:true});if(idText)return idText;return String(a.name||"").localeCompare(String(b.name||""),"ko")}const time=logTimeValue(b.time)-logTimeValue(a.time);if(time)return time;return String(a.name||"").localeCompare(String(b.name||""),"ko")}):[]}'''

if old not in text:
    raise SystemExit('normalizeLogs target not found')

text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
