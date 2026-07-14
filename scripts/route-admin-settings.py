from pathlib import Path

# Dashboard settings button now opens the dedicated settings page.
p = Path('admin/dashboard/index.html')
text = p.read_text(encoding='utf-8')
old = '<button class="btn btn-soft settings" onclick="openSettingsModal()">설정</button>'
new = '<a class="btn btn-soft settings" href="/admin/settings/">설정</a>'
if old not in text:
    raise SystemExit('dashboard settings button not found')
text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')

# Preserve /admin/settings/ as a safe post-login destination.
p = Path('admin/login/index.html')
text = p.read_text(encoding='utf-8')
old = 'const ALLOWED_NEXT = ["/admin/dashboard/", "/admin/choose-login-method/", "/admin/setup-login-method/", "/accounts-s/"];'
new = 'const ALLOWED_NEXT = ["/admin/dashboard/", "/admin/settings/", "/admin/choose-login-method/", "/admin/setup-login-method/", "/accounts-s/"];'
if old not in text:
    raise SystemExit('admin login allowed routes not found')
text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
