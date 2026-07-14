from pathlib import Path

p = Path('accounts-s/index.html')
text = p.read_text(encoding='utf-8')
old = '''    function filteredAccounts(){const q=document.getElementById("searchInput").value.trim().toLowerCase();if(!q)return accounts;return accounts.filter(function(x){return [x.name,x.studentId,x.fingerId,x.memo].join(" ").toLowerCase().includes(q)})}
'''
new = '''    function accountFingerSortValue(value){const text=String(value==null?"":value).trim(),number=Number(text);return text&&Number.isFinite(number)?{missing:false,number:number,text:text}:{missing:true,number:Number.MAX_SAFE_INTEGER,text:text}}
    function sortStudentAccounts(rows){return rows.slice().sort(function(a,b){const idA=accountFingerSortValue(a.fingerId),idB=accountFingerSortValue(b.fingerId);if(idA.missing!==idB.missing)return idA.missing?1:-1;if(idA.number!==idB.number)return idA.number-idB.number;const idText=idA.text.localeCompare(idB.text,"ko",{numeric:true});if(idText)return idText;const name=String(a.name||"").localeCompare(String(b.name||""),"ko");if(name)return name;return String(a.studentId||"").localeCompare(String(b.studentId||""),"ko",{numeric:true})})}
    function filteredAccounts(){const q=document.getElementById("searchInput").value.trim().toLowerCase(),rows=q?accounts.filter(function(x){return [x.name,x.studentId,x.fingerId,x.memo].join(" ").toLowerCase().includes(q)}):accounts;return sortStudentAccounts(rows)}
'''
if old not in text:
    raise SystemExit('filteredAccounts function not found')
text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
