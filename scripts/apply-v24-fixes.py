from pathlib import Path


def save(path, text):
    Path(path).write_text(text, encoding="utf-8")


# Secure login supports migrated password schemes and falls back only until V5 is deployed.
p = Path("assets/role-app.js")
text = p.read_text(encoding="utf-8")
old = '''  async function secureAdminLogin(adminId, adminPassword) {
    if (!window.crypto || !crypto.subtle) throw new Error("이 브라우저는 보안 로그인을 지원하지 않습니다.");
    const idHash = await sha256Base64Url(String(adminId || "").trim());
    const challenge = await jsonp("adminLoginChallengeJsonp", { adminIdHash: idHash }, 22000);
    if (!challenge || !challenge.ok || !challenge.challengeId || !challenge.challenge || !challenge.salt) {
      throw new Error(challenge && challenge.message || "보안 로그인 요청을 만들지 못했습니다.");
    }
    const verifier = await sha256Base64Url(String(adminId || "").trim() + "|" + String(adminPassword || "") + "|" + challenge.salt);
    const proof = await sha256Base64Url(verifier + "|" + challenge.challenge);
    const params = new URLSearchParams({ action: "dashboardLoginProofJsonp", challengeId: challenge.challengeId, proof: proof });
    AttendanceApp.addClientParams(params);
    return AttendanceApp.jsonp(AttendanceApp.apiUrl(API_URL, params), { timeoutMs: 25000 });
  }
'''
new = '''  async function secureAdminLogin(adminId, adminPassword) {
    if (!window.crypto || !crypto.subtle) throw new Error("이 브라우저는 보안 로그인을 지원하지 않습니다.");
    try {
      const idHash = await sha256Base64Url(String(adminId || "").trim());
      const challenge = await jsonp("adminLoginChallengeJsonp", { adminIdHash: idHash }, 22000);
      if (!challenge || !challenge.ok || !challenge.challengeId || !challenge.challenge || !challenge.salt) {
        throw new Error(challenge && challenge.message || "보안 로그인 요청을 만들지 못했습니다.");
      }
      const verifier = challenge.scheme === "legacy-sha256"
        ? await sha256Base64Url(String(adminPassword || ""))
        : await sha256Base64Url(String(adminId || "").trim() + "|" + String(adminPassword || "") + "|" + challenge.salt);
      const proof = await sha256Base64Url(verifier + "|" + challenge.challenge);
      const params = new URLSearchParams({ action: "dashboardLoginProofJsonp", challengeId: challenge.challengeId, proof: proof });
      AttendanceApp.addClientParams(params);
      return AttendanceApp.jsonp(AttendanceApp.apiUrl(API_URL, params), { timeoutMs: 25000 });
    } catch (error) {
      const legacy = new URLSearchParams({ action: "dashboardLoginJsonp", adminId: String(adminId || ""), adminPw: String(adminPassword || "") });
      AttendanceApp.addClientParams(legacy);
      const result = await AttendanceApp.jsonp(AttendanceApp.apiUrl(API_URL, legacy), { timeoutMs: 25000 });
      if (!result || !result.ok) throw error;
      return result;
    }
  }
'''
if old in text:
    text = text.replace(old, new, 1)
save(p, text)


# Dashboard cutoff rule.
p = Path("admin/dashboard/index.html")
text = p.read_text(encoding="utf-8")
text = text.replace(
    'function applyCutoff(c){const afterFour=new Date().getHours()>=16,known=c.present+c.late+c.absent+c.notYet;c.total=Math.max(c.total,known);const remainder=Math.max(0,c.total-known);if(afterFour){c.absent+=c.notYet+remainder;c.notYet=0}else{c.notYet+=c.absent+remainder;c.absent=0}return{...c,afterFour:afterFour}}',
    'function applyCutoff(c){const now=new Date(),cutoff=now.getDay()===4?15*60+55:15*60,afterCutoff=now.getHours()*60+now.getMinutes()>=cutoff,known=c.present+c.late+c.absent+c.notYet;c.total=Math.max(c.total,known);const remainder=Math.max(0,c.total-known);if(afterCutoff){c.absent+=c.notYet+remainder;c.notYet=0}else{c.notYet+=c.absent+remainder;c.absent=0}return{...c,afterFour:afterCutoff,cutoffText:now.getDay()===4?"오후 3시 55분":"오후 3시"}}',
    1,
)
text = text.replace(
    'document.getElementById("progressSub").textContent=c.afterFour?"오후 4시 이후 미출석 인원은 결석으로 표시":"오후 4시 전 미확인 인원은 미출석으로 표시";',
    'document.getElementById("progressSub").textContent=c.afterFour?c.cutoffText+" 이후 미확인 인원은 결석으로 표시":c.cutoffText+" 전 미확인 인원은 미출석으로 표시";',
    1,
)
save(p, text)


# Attendance-rate page uses the same rule.
p = Path("admin/attendance-rate/index.html")
text = p.read_text(encoding="utf-8")
text = text.replace("오후 4시 이후 표시", "기준 시각 이후 표시")
text = text.replace("오후 4시 전까지 표시", "기준 시각 전까지 표시")
text = text.replace(
    "오후 4시 전에는 확인되지 않은 인원을 미출석으로, 오후 4시 이후에는 결석으로 표시합니다.",
    "월·화·수·금은 오후 3시, 목요일은 오후 3시 55분을 기준으로 미출석을 결석으로 전환합니다.",
)
text = text.replace(
    'function applyCutoff(c){const afterFour=new Date().getHours()>=16,known=c.present+c.late+c.absent+c.notYet;c.total=Math.max(c.total,known);const remainder=Math.max(0,c.total-known);if(afterFour){c.absent+=c.notYet+remainder;c.notYet=0}else{c.notYet+=c.absent+remainder;c.absent=0}return{...c,afterFour:afterFour}}',
    'function applyCutoff(c){const now=new Date(),cutoff=now.getDay()===4?15*60+55:15*60,afterCutoff=now.getHours()*60+now.getMinutes()>=cutoff,known=c.present+c.late+c.absent+c.notYet;c.total=Math.max(c.total,known);const remainder=Math.max(0,c.total-known);if(afterCutoff){c.absent+=c.notYet+remainder;c.notYet=0}else{c.notYet+=c.absent+remainder;c.absent=0}return{...c,afterFour:afterCutoff,cutoffText:now.getDay()===4?"오후 3시 55분":"오후 3시"}}',
    1,
)
text = text.replace(
    'document.getElementById("cutoffText").textContent=c.afterFour?"오후 4시 이후 · 미확인 인원은 결석으로 표시":"오후 4시 전 · 미확인 인원은 미출석으로 표시";',
    'document.getElementById("cutoffText").textContent=c.afterFour?c.cutoffText+" 이후 · 미확인 인원은 결석으로 표시":c.cutoffText+" 전 · 미확인 인원은 미출석으로 표시";',
    1,
)
save(p, text)


# Student screen handles vacation and holiday responses.
p = Path("student/identity/index.html")
text = p.read_text(encoding="utf-8")
needle = '''          if(response&&response.code==="GPS_ACCURACY_LOW"){
            const measured=Math.round(Number(response.accuracyM||accuracy||0)),maximum=Math.round(Number(response.maxAccuracyM||200));
            renderPermission("retry");
            showResult(false,"GPS 정확도가 부족합니다.","현재 위치 정확도 ±"+measured+"m · 허용 최대 ±"+maximum+"m입니다. Wi-Fi와 정확한 위치를 켜고 창가 또는 운동장에서 다시 시도하세요.");return
          }
'''
if needle in text and 'response.code==="SCHOOL_CLOSED"' not in text:
    text = text.replace(
        needle,
        needle + '''          if(response&&response.code==="SCHOOL_CLOSED"){
            localStorage.setItem("studentAutoAttendanceDate",todayKey());
            showResult(false,"오늘은 출석 인증일이 아닙니다.",response.message||"방학·주말·공휴일 또는 학교 휴업일입니다.");return
          }
''',
        1,
    )
save(p, text)
