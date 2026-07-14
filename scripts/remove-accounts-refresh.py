from pathlib import Path

path = Path('accounts-s/index.html')
text = path.read_text(encoding='utf-8')
old = '<div class="search-wrap"><input id="searchInput" type="search" placeholder="이름, 학생 ID, 지문 ID 검색" oninput="renderAccounts()"><button class="btn btn-soft" type="button" onclick="loadAccounts(true)">새로고침</button></div>'
new = '<div class="search-wrap"><input id="searchInput" type="search" placeholder="이름, 학생 ID, 지문 ID 검색" oninput="renderAccounts()"></div>'
if old not in text:
    raise SystemExit('refresh button markup not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
