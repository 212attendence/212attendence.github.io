from pathlib import Path
p = Path('assets/role-app.js')
text = p.read_text(encoding='utf-8')
text = text.replace('if (Notification.permission === "granted") registerPushToken();', 'if ("Notification" in window && Notification.permission === "granted") registerPushToken();', 1)
p.write_text(text, encoding='utf-8')
