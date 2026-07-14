from pathlib import Path
p = Path('assets/role-app.js')
text = p.read_text(encoding='utf-8')
old = '''    } catch (error) {
      const legacy = new URLSearchParams({ action: "dashboardLoginJsonp", adminId: String(adminId || ""), adminPw: String(adminPassword || "") });
      AttendanceApp.addClientParams(legacy);
      const result = await AttendanceApp.jsonp(AttendanceApp.apiUrl(API_URL, legacy), { timeoutMs: 25000 });
      if (!result || !result.ok) throw error;
      return result;
    }
'''
new = '''    } catch (error) {
      throw new Error(error && error.message || "보안 로그인 서버에 연결하지 못했습니다. Apps Script V5 배포를 확인하세요.");
    }
'''
if old not in text:
    raise SystemExit('legacy block not found')
text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
