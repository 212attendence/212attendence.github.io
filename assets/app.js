(function (window) {
  "use strict";

  const SESSION_KEY = "attendanceSessionV2";
  const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
  const SESSION_FIELDS = [
    "loginType",
    "sessionToken",
    "loginEmail",
    "loginName",
    "loginRole",
    "sessionExpiresAt"
  ];

  const PASSKEY_KEYS = {
    registered: "attendancePasskeyRegistered",
    credentialId: "attendancePasskeyCredentialId",
    deviceName: "attendancePasskeyDeviceName"
  };

  const STUDENT_API_BASE = "https://script.google.com/macros/s/AKfycbzE5SDb4aYv5MtyUCP1r0sAp24wBEfWbySKRQXxpuiLrv6irwSbG4L8ABSNWZY8pEvX/exec";

  function safeStorage(storage, method, key, value) {
    try {
      if (method === "get") return storage.getItem(key);
      if (method === "set") storage.setItem(key, value);
      if (method === "remove") storage.removeItem(key);
    } catch (error) {
      console.warn("Storage operation failed", error);
    }
    return null;
  }

  function parseExpiry(value) {
    if (value == null || value === "") return 0;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 1e12) return numeric;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function responseExpiry(response) {
    const candidate = response && (
      response.sessionExpiresAtMs ||
      response.sessionExpiresAt ||
      response.expiresAtMs ||
      response.expiresAt
    );
    const parsed = parseExpiry(candidate);
    return parsed > Date.now() ? parsed : Date.now() + SESSION_TTL_MS;
  }

  function readSessionStorage() {
    const token = safeStorage(sessionStorage, "get", "sessionToken") || "";
    if (!token) return null;
    return {
      loginType: safeStorage(sessionStorage, "get", "loginType") || "",
      sessionToken: token,
      loginEmail: safeStorage(sessionStorage, "get", "loginEmail") || "",
      loginName: safeStorage(sessionStorage, "get", "loginName") || "",
      loginRole: safeStorage(sessionStorage, "get", "loginRole") || "ADMIN",
      expiresAt: parseExpiry(safeStorage(sessionStorage, "get", "sessionExpiresAt")) || Date.now() + SESSION_TTL_MS
    };
  }

  function writeSessionStorage(session) {
    safeStorage(sessionStorage, "set", "loginType", session.loginType || "");
    safeStorage(sessionStorage, "set", "sessionToken", session.sessionToken || "");
    safeStorage(sessionStorage, "set", "loginEmail", session.loginEmail || "");
    safeStorage(sessionStorage, "set", "loginName", session.loginName || "");
    safeStorage(sessionStorage, "set", "loginRole", session.loginRole || "ADMIN");
    safeStorage(sessionStorage, "set", "sessionExpiresAt", String(session.expiresAt || 0));
  }

  function validSession(session) {
    return Boolean(session && session.sessionToken && Number(session.expiresAt) > Date.now());
  }

  const Session = {
    ttlMs: SESSION_TTL_MS,

    save(loginType, response) {
      if (!response || !response.sessionToken) return false;
      const session = {
        version: 2,
        loginType: loginType || "",
        sessionToken: String(response.sessionToken),
        loginEmail: String(response.email || ""),
        loginName: String(response.name || ""),
        loginRole: String(response.role || "ADMIN"),
        expiresAt: responseExpiry(response),
        savedAt: Date.now()
      };
      safeStorage(localStorage, "set", SESSION_KEY, JSON.stringify(session));
      writeSessionStorage(session);
      return true;
    },

    restore() {
      const current = readSessionStorage();
      if (validSession(current)) {
        const persistedRaw = safeStorage(localStorage, "get", SESSION_KEY);
        if (!persistedRaw) {
          const migrated = Object.assign({ version: 2, savedAt: Date.now() }, current);
          safeStorage(localStorage, "set", SESSION_KEY, JSON.stringify(migrated));
          writeSessionStorage(migrated);
          return migrated;
        }
        return current;
      }

      let stored = null;
      try { stored = JSON.parse(safeStorage(localStorage, "get", SESSION_KEY) || "null"); }
      catch (error) { stored = null; }

      if (!validSession(stored)) {
        this.clear();
        return null;
      }

      writeSessionStorage(stored);
      return stored;
    },

    current() { return this.restore(); },
    has() { return Boolean(this.restore()); },

    clear() {
      safeStorage(localStorage, "remove", SESSION_KEY);
      safeStorage(localStorage, "remove", "attendancePersistentAuth");
      SESSION_FIELDS.forEach(function (key) { safeStorage(sessionStorage, "remove", key); });
    },

    addAuthParams(params) {
      const session = this.restore();
      if (session && session.sessionToken) params.set("sessionToken", session.sessionToken);
      return params;
    },

    require(loginRelativeUrl, nextPath) {
      if (this.restore()) return true;
      if (nextPath) safeStorage(sessionStorage, "set", "postLoginRoute", nextPath);
      const target = loginRelativeUrl + (nextPath ? "?next=" + encodeURIComponent(nextPath) : "");
      window.location.replace(target);
      return false;
    },

    expiryText() {
      const session = this.restore();
      if (!session) return "로그인 필요";
      return new Date(session.expiresAt).toLocaleString("ko-KR", {
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
      });
    },

    isUnauthorizedResponse(response) {
      if (!response || response.ok !== false) return false;
      const code = String(response.code || response.errorCode || "").toLowerCase();
      const message = String(response.message || response.error || "").toLowerCase();
      return code.includes("auth") || code.includes("session") || message.includes("로그인") ||
        message.includes("세션") || message.includes("인증") || message.includes("unauthorized") || message.includes("expired");
    }
  };

  const Passkey = {
    isRegistered() {
      return safeStorage(localStorage, "get", PASSKEY_KEYS.registered) === "1" &&
        Boolean(safeStorage(localStorage, "get", PASSKEY_KEYS.credentialId));
    },
    getCredentialId() { return safeStorage(localStorage, "get", PASSKEY_KEYS.credentialId) || ""; },
    getDeviceName() { return safeStorage(localStorage, "get", PASSKEY_KEYS.deviceName) || ""; },
    save(credentialId, deviceName) {
      safeStorage(localStorage, "set", PASSKEY_KEYS.registered, "1");
      safeStorage(localStorage, "set", PASSKEY_KEYS.credentialId, credentialId || "");
      safeStorage(localStorage, "set", PASSKEY_KEYS.deviceName, deviceName || "Passkey device");
    },
    clear() {
      Object.keys(PASSKEY_KEYS).forEach(function (key) { safeStorage(localStorage, "remove", PASSKEY_KEYS[key]); });
    },
    supported() { return "PublicKeyCredential" in window && Boolean(navigator.credentials); },
    deviceInfo() {
      const ua = navigator.userAgent || "";
      const uaPlatform = navigator.userAgentData && navigator.userAgentData.platform || "";
      const platform = [uaPlatform, navigator.platform || "", ua].join(" ");
      const iPadDesktop = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
      if (/Windows|Win32|Win64|Win86/i.test(platform)) {
        return { kind: "windows", name: "Windows Hello", title: "Windows Hello", hint: "얼굴 · 지문 · Windows Hello PIN" };
      }
      if (/iPhone|iPad|iPod/i.test(ua) || iPadDesktop) {
        return { kind: "apple-mobile", name: /iPhone/i.test(ua) ? "iPhone Face ID" : "iPad Touch ID/Face ID", title: /iPhone/i.test(ua) ? "Face ID" : "기기 인증", hint: "Face ID · Touch ID · 기기 암호" };
      }
      if (/Macintosh|Mac OS X/i.test(platform)) {
        return { kind: "mac", name: "Mac Touch ID", title: "Touch ID", hint: "Touch ID · Mac 로그인 암호" };
      }
      if (/Android/i.test(ua)) {
        return { kind: "android", name: "Android device authentication", title: "기기 인증", hint: "지문 · 얼굴 · 화면 잠금 PIN" };
      }
      return { kind: "generic", name: navigator.platform || "Passkey device", title: "기기 인증", hint: "생체인식 · 화면 잠금 PIN" };
    }
  };

  const Theme = {
    key: "attendanceThemeMode",
    media: window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null,
    getMode() {
      const mode = safeStorage(localStorage, "get", this.key);
      return ["system", "light", "dark"].includes(mode) ? mode : "system";
    },
    resolve(mode) {
      if (mode === "light" || mode === "dark") return mode;
      return this.media && this.media.matches ? "dark" : "light";
    },
    apply(mode) {
      const nextMode = ["system", "light", "dark"].includes(mode) ? mode : "system";
      const resolved = this.resolve(nextMode);
      document.documentElement.setAttribute("data-theme", resolved);
      document.documentElement.setAttribute("data-theme-mode", nextMode);
      safeStorage(localStorage, "set", this.key, nextMode);
      safeStorage(localStorage, "set", "attendanceTheme", resolved);
      safeStorage(sessionStorage, "set", "theme", resolved);
      document.querySelectorAll("[data-theme-choice]").forEach(function (button) {
        button.classList.toggle("active", button.getAttribute("data-theme-choice") === nextMode);
      });
      return resolved;
    },
    init() {
      const self = this;
      this.apply(this.getMode());
      if (this.media && this.media.addEventListener) {
        this.media.addEventListener("change", function () { if (self.getMode() === "system") self.apply("system"); });
      }
    }
  };

  function jsonp(url, options) {
    const config = options || {};
    const timeoutMs = Number(config.timeoutMs || 15000);
    return new Promise(function (resolve, reject) {
      const callbackName = "attendance_jsonp_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
      const script = document.createElement("script");
      let finished = false;
      function cleanup() {
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      function finish(error, data) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cleanup();
        if (error) reject(error); else resolve(data);
      }
      const timer = setTimeout(function () { finish(new Error("서버 응답 시간이 초과되었습니다.")); }, timeoutMs);
      window[callbackName] = function (data) { finish(null, data); };
      script.async = true;
      script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + encodeURIComponent(callbackName);
      script.onerror = function () { finish(new Error("서버에 연결하지 못했습니다.")); };
      document.head.appendChild(script);
    });
  }

  const UI = {
    toastTimer: null,
    toast(message, duration) {
      const element = document.getElementById("toast");
      if (!element) return;
      element.textContent = message || "알림";
      element.classList.add("show");
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(function () { element.classList.remove("show"); }, Number(duration || 2800));
    },
    loading(title, subtitle) {
      const overlay = document.getElementById("loadingOverlay") || document.getElementById("loading");
      const titleElement = document.getElementById("loadingTitle");
      const subtitleElement = document.getElementById("loadingSub");
      if (titleElement) titleElement.textContent = title || "처리 중입니다";
      if (subtitleElement) subtitleElement.textContent = subtitle || "잠시만 기다려주세요.";
      if (overlay) { overlay.classList.add("show"); overlay.setAttribute("aria-hidden", "false"); }
    },
    stopLoading() {
      const overlay = document.getElementById("loadingOverlay") || document.getElementById("loading");
      if (overlay) { overlay.classList.remove("show"); overlay.setAttribute("aria-hidden", "true"); }
    },
    escapeHtml(value) {
      return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
  };

  function base64UrlToBytes(value) {
    let source = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    while (source.length % 4) source += "=";
    const binary = atob(source);
    return Uint8Array.from(binary, function (char) { return char.charCodeAt(0); });
  }

  function bytesToBase64Url(value) {
    const bytes = new Uint8Array(value);
    let binary = "";
    bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function addClientParams(params) {
    params.set("deviceName", navigator.userAgentData && navigator.userAgentData.platform || navigator.platform || "");
    params.set("screenSize", window.innerWidth + "x" + window.innerHeight);
    params.set("clientTime", new Date().toISOString());
    params.set("clientTimezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    params.set("userAgent", (navigator.userAgent || "").slice(0, 180));
    return params;
  }

  function apiUrl(base, params) { return base + "?" + params.toString(); }


  const Navigation = {
    key: "attendanceInternalNavigationV1",
    ttlMs: 5 * 60 * 1000,
    bound: false,

    normalize(value) {
      try {
        const url = new URL(value || location.href, location.origin);
        return (url.pathname.replace(/\/+$/, "") || "/");
      } catch (error) {
        return String(value || "/").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
      }
    },

    mark(target) {
      try {
        const url = new URL(target, location.href);
        if (url.origin !== location.origin) return false;
        safeStorage(sessionStorage, "set", this.key, JSON.stringify({
          from: this.normalize(location.href),
          to: this.normalize(url.href),
          at: Date.now()
        }));
        return true;
      } catch (error) {
        return false;
      }
    },

    isFastEntry() {
      try {
        const entries = performance.getEntriesByType && performance.getEntriesByType("navigation");
        if (entries && entries[0] && entries[0].type === "back_forward") return true;
      } catch (error) {}
      try {
        const record = JSON.parse(safeStorage(sessionStorage, "get", this.key) || "null");
        if (!record || Date.now() - Number(record.at || 0) > this.ttlMs) return false;
        return this.normalize(record.to) === this.normalize(location.href);
      } catch (error) {
        return false;
      }
    },

    bind() {
      if (this.bound) return;
      this.bound = true;
      const self = this;
      document.addEventListener("click", function (event) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
        if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
        const href = link.getAttribute("href") || "";
        if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
        self.mark(link.href);
      }, true);
    }
  };

  const AdminStudentNotifications = {
    pollTimer: null,
    button: null,
    badge: null,
    dot: null,
    modal: null,
    status: null,
    list: null,
    featureAvailable: null,

    init() {
      if (!location.pathname.includes("/dashboard/")) return;
      this.injectStyles();
      this.injectUi();
      const self = this;
      setTimeout(function () { self.refresh(false); }, 900);
      this.pollTimer = setInterval(function () { self.refresh(false); }, 10000);
      if (new URLSearchParams(location.search).get("student-requests") === "1") setTimeout(function () { self.open(); }, 1100);
    },

    injectStyles() {
      if (document.getElementById("studentAdminStyles")) return;
      const style = document.createElement("style");
      style.id = "studentAdminStyles";
      style.textContent = ".student-alert-btn{position:relative}.student-alert-dot{position:absolute;right:-3px;top:-4px;display:none;width:9px;height:9px;border:2px solid var(--surface-strong);border-radius:50%;background:#d83232;box-shadow:0 0 0 3px rgba(216,50,50,.12)}.student-alert-dot.show{display:block}.student-alert-count{display:none;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:#b6423a;color:#fff;font-size:10px;line-height:19px;text-align:center;font-weight:900}.student-alert-count.show{display:inline-block}.student-request-overlay{position:fixed;inset:0;z-index:650;display:none;place-items:center;padding:18px;background:rgba(18,19,18,.48);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}.student-request-overlay.show{display:grid}.student-request-modal{width:min(620px,100%);max-height:min(760px,calc(100vh - 36px));overflow:auto;border:1px solid var(--line);border-radius:28px;background:var(--surface-strong);box-shadow:0 28px 90px rgba(0,0,0,.28)}.student-request-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--surface-strong) 93%,transparent);backdrop-filter:blur(18px)}.student-request-head h2{font-size:20px}.student-request-body{padding:18px}.student-request-status{margin-bottom:13px;padding:12px;border:1px solid var(--line);border-radius:15px;background:var(--surface-soft);color:var(--muted);font-size:12px;line-height:1.55;font-weight:700}.student-request-list{display:grid;gap:10px}.student-request-card{padding:14px;border:1px solid var(--line);border-radius:18px;background:var(--surface-soft)}.student-request-card strong{display:block;font-size:15px}.student-request-meta{margin-top:5px;color:var(--muted);font-size:11px;line-height:1.5}.student-request-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.student-school-config{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}.student-school-config h3{font-size:15px}.student-school-config p{margin:5px 0 11px;color:var(--muted);font-size:12px;line-height:1.55}@media(max-width:560px){.student-request-overlay{padding:0;align-items:end}.student-request-modal{width:100%;max-height:88vh;border-radius:26px 26px 0 0}.student-request-actions{grid-template-columns:1fr}}";
      document.head.appendChild(style);
    },

    injectUi() {
      const actions = document.querySelector(".actions");
      this.button = document.createElement("button");
      this.button.type = "button";
      this.button.className = "btn btn-soft student-alert-btn";
      this.button.innerHTML = "알림 <span class=\"student-alert-dot\" aria-hidden=\"true\"></span><span class=\"student-alert-count\">0</span>";
      this.dot = this.button.querySelector(".student-alert-dot");
      this.badge = this.button.querySelector(".student-alert-count");
      this.button.addEventListener("click", this.open.bind(this));
      if (actions) actions.insertBefore(this.button, actions.firstChild);
      else { this.button.style.cssText = "position:fixed;right:18px;top:18px;z-index:80"; document.body.appendChild(this.button); }

      const overlay = document.createElement("div");
      overlay.className = "student-request-overlay";
      overlay.innerHTML = '<section class="student-request-modal"><header class="student-request-head"><div><h2>학생 로그인 알림</h2><div style="margin-top:4px;color:var(--muted);font-size:12px;font-weight:650">승인된 기기는 만료 없이 로그인됩니다.</div></div><button class="btn btn-soft" type="button" data-close>닫기</button></header><div class="student-request-body"><div class="student-request-status">학생 로그인 요청을 확인하는 중입니다.</div><div class="student-request-list"></div><div class="student-school-config"><h3>해강중학교 출석 범위</h3><p><strong>35°09&#39;50.70&quot;N 129°08&#39;08.69&quot;E</strong>를 중심으로 반경 <strong>100m</strong>가 서버에서 자동 적용됩니다. 별도 위치 설정은 필요하지 않습니다.</p></div></div></section>';
      document.body.appendChild(overlay);
      this.modal = overlay;
      this.status = overlay.querySelector(".student-request-status");
      this.list = overlay.querySelector(".student-request-list");
      overlay.querySelector("[data-close]").addEventListener("click", this.close.bind(this));
      overlay.addEventListener("click", function (event) { if (event.target === overlay) overlay.classList.remove("show"); });
    },

    open() {
      if (this.modal) this.modal.classList.add("show");
      this.refresh(true);
    },
    close() { if (this.modal) this.modal.classList.remove("show"); },

    adminParams(action, values) {
      const params = new URLSearchParams(Object.assign({ action: action }, values || {}));
      Session.addAuthParams(params);
      addClientParams(params);
      return params;
    },

    async refresh(showErrors) {
      if (!Session.has() || !this.status || document.hidden) return;
      try {
        const result = await jsonp(apiUrl(STUDENT_API_BASE, this.adminParams("adminStudentRequestsJsonp")), { timeoutMs: 22000 });
        if (!result || !result.ok) throw new Error(result && result.message || "학생 알림 서버를 확인할 수 없습니다.");
        this.featureAvailable = true;
        const requests = Array.isArray(result.requests) ? result.requests : [];
        this.render(requests, result.school || {});
        this.setCount(Number(result.pendingCount || requests.length));
      } catch (error) {
        this.featureAvailable = false;
        this.setCount(0);
        if (showErrors) {
          this.status.textContent = "학생 로그인 백엔드가 아직 배포되지 않았거나 연결할 수 없습니다. apps-script/student-auth-addon.gs를 Apps Script에 반영해야 합니다.";
          this.list.innerHTML = "";
        }
      }
    },

    setCount(count) {
      if (!this.badge) return;
      this.badge.textContent = count > 99 ? "99+" : String(count);
      this.badge.classList.toggle("show", count > 0);
      if (this.dot) this.dot.classList.toggle("show", count > 0);
      this.button.setAttribute("aria-label", count > 0 ? "학생 로그인 알림 " + count + "건" : "학생 로그인 알림 없음");
    },

    render(requests, school) {
      this.status.textContent = requests.length ? requests.length + "개의 승인 요청이 있습니다." : "대기 중인 학생 로그인 요청이 없습니다.";
      if (school && school.configured) this.status.textContent += " · 학교 반경 " + Number(school.radiusM || 100) + "m 설정 완료";
      this.list.innerHTML = requests.map(function (request) {
        return '<article class="student-request-card"><strong>' + UI.escapeHtml(request.name || request.studentId || "학생") + '</strong><div class="student-request-meta">학생 ID ' + UI.escapeHtml(request.studentId || "-") + ' · 지문ID ' + UI.escapeHtml(request.fingerId || "-") + '<br>' + UI.escapeHtml(request.deviceName || "기기 정보 없음") + ' · ' + UI.escapeHtml(formatRequestTime(request.createdAt)) + '</div><div class="student-request-actions"><button class="btn btn-primary" type="button" data-decision="APPROVED" data-id="' + UI.escapeHtml(request.requestId) + '">로그인 허용</button><button class="btn btn-danger" type="button" data-decision="DENIED" data-id="' + UI.escapeHtml(request.requestId) + '">거절</button></div></article>';
      }).join("") || '<div style="padding:22px;text-align:center;color:var(--muted);font-size:13px;font-weight:700">새 요청이 도착하면 이곳에 표시됩니다.</div>';
      const self = this;
      this.list.querySelectorAll("[data-decision]").forEach(function (button) {
        button.addEventListener("click", function () { self.decide(button.getAttribute("data-id"), button.getAttribute("data-decision"), button); });
      });
    },

    async decide(requestId, decision, button) {
      if (!requestId || !decision) return;
      button.disabled = true;
      try {
        const result = await jsonp(apiUrl(STUDENT_API_BASE, this.adminParams("adminDecideStudentRequestJsonp", { requestId: requestId, decision: decision })), { timeoutMs: 22000 });
        if (!result || !result.ok) throw new Error(result && result.message || "요청 처리에 실패했습니다.");
        UI.toast(decision === "APPROVED" ? "학생 로그인을 허용했습니다." : "학생 로그인을 거절했습니다.");
        await this.refresh(false);
      } catch (error) {
        UI.toast(error.message || String(error), 4000);
        button.disabled = false;
      }
    },

  };

  function formatRequestTime(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "시간 정보 없음";
  }

  window.AttendanceApp = {
    version: "14.0.0",
    Session: Session,
    Passkey: Passkey,
    Theme: Theme,
    UI: UI,
    jsonp: jsonp,
    base64UrlToBytes: base64UrlToBytes,
    bytesToBase64Url: bytesToBase64Url,
    addClientParams: addClientParams,
    apiUrl: apiUrl,
    Navigation: Navigation,
    AdminStudentNotifications: AdminStudentNotifications
  };

  document.addEventListener("DOMContentLoaded", function () {
    Navigation.bind();
    AdminStudentNotifications.init();
  });
})(window);
