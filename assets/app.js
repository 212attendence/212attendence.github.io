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
    return Boolean(
      session &&
      session.sessionToken &&
      Number(session.expiresAt) > Date.now()
    );
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
      try {
        stored = JSON.parse(safeStorage(localStorage, "get", SESSION_KEY) || "null");
      } catch (error) {
        stored = null;
      }

      if (!validSession(stored)) {
        this.clear();
        return null;
      }

      writeSessionStorage(stored);
      return stored;
    },

    current() {
      return this.restore();
    },

    has() {
      return Boolean(this.restore());
    },

    clear() {
      safeStorage(localStorage, "remove", SESSION_KEY);
      safeStorage(localStorage, "remove", "attendancePersistentAuth");
      SESSION_FIELDS.forEach(function (key) {
        safeStorage(sessionStorage, "remove", key);
      });
    },

    addAuthParams(params) {
      const session = this.restore();
      if (session && session.sessionToken) {
        params.set("sessionToken", session.sessionToken);
      }
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
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    },

    isUnauthorizedResponse(response) {
      if (!response || response.ok !== false) return false;
      const code = String(response.code || response.errorCode || "").toLowerCase();
      const message = String(response.message || response.error || "").toLowerCase();
      return (
        code.includes("auth") ||
        code.includes("session") ||
        message.includes("로그인") ||
        message.includes("세션") ||
        message.includes("인증") ||
        message.includes("unauthorized") ||
        message.includes("expired")
      );
    }
  };

  const Passkey = {
    isRegistered() {
      return (
        safeStorage(localStorage, "get", PASSKEY_KEYS.registered) === "1" &&
        Boolean(safeStorage(localStorage, "get", PASSKEY_KEYS.credentialId))
      );
    },

    getCredentialId() {
      return safeStorage(localStorage, "get", PASSKEY_KEYS.credentialId) || "";
    },

    getDeviceName() {
      return safeStorage(localStorage, "get", PASSKEY_KEYS.deviceName) || "";
    },

    save(credentialId, deviceName) {
      safeStorage(localStorage, "set", PASSKEY_KEYS.registered, "1");
      safeStorage(localStorage, "set", PASSKEY_KEYS.credentialId, credentialId || "");
      safeStorage(localStorage, "set", PASSKEY_KEYS.deviceName, deviceName || "Passkey device");
    },

    clear() {
      Object.keys(PASSKEY_KEYS).forEach(function (key) {
        safeStorage(localStorage, "remove", PASSKEY_KEYS[key]);
      });
    },

    supported() {
      return "PublicKeyCredential" in window && Boolean(navigator.credentials);
    },

    deviceInfo() {
      const ua = navigator.userAgent || "";
      const iPadDesktop = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
      if (/Windows/i.test(ua)) {
        return {
          kind: "windows",
          name: "Windows Hello",
          title: "Windows Hello",
          hint: "얼굴 · 지문 · Windows Hello PIN"
        };
      }
      if (/iPhone|iPad|iPod/i.test(ua) || iPadDesktop) {
        return {
          kind: "apple-mobile",
          name: /iPhone/i.test(ua) ? "iPhone Face ID" : "iPad Touch ID/Face ID",
          title: "Face ID",
          hint: "Face ID · Touch ID · 기기 암호"
        };
      }
      if (/Macintosh|Mac OS X/i.test(ua)) {
        return {
          kind: "mac",
          name: "Mac Touch ID",
          title: "Touch ID",
          hint: "Touch ID · Mac 로그인 암호"
        };
      }
      if (/Android/i.test(ua)) {
        return {
          kind: "android",
          name: "Android device authentication",
          title: "기기 인증",
          hint: "지문 · 얼굴 · 화면 잠금 PIN"
        };
      }
      return {
        kind: "generic",
        name: navigator.platform || "Passkey device",
        title: "기기 인증",
        hint: "생체인식 · 화면 잠금 PIN"
      };
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
        this.media.addEventListener("change", function () {
          if (self.getMode() === "system") self.apply("system");
        });
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
        if (error) reject(error);
        else resolve(data);
      }

      const timer = setTimeout(function () {
        finish(new Error("서버 응답 시간이 초과되었습니다."));
      }, timeoutMs);

      window[callbackName] = function (data) {
        finish(null, data);
      };

      script.async = true;
      script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + encodeURIComponent(callbackName);
      script.onerror = function () {
        finish(new Error("서버에 연결하지 못했습니다."));
      };
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
      this.toastTimer = setTimeout(function () {
        element.classList.remove("show");
      }, Number(duration || 2800));
    },

    loading(title, subtitle) {
      const overlay = document.getElementById("loadingOverlay") || document.getElementById("loading");
      const titleElement = document.getElementById("loadingTitle");
      const subtitleElement = document.getElementById("loadingSub");
      if (titleElement) titleElement.textContent = title || "처리 중입니다";
      if (subtitleElement) subtitleElement.textContent = subtitle || "잠시만 기다려주세요.";
      if (overlay) {
        overlay.classList.add("show");
        overlay.setAttribute("aria-hidden", "false");
      }
    },

    stopLoading() {
      const overlay = document.getElementById("loadingOverlay") || document.getElementById("loading");
      if (overlay) {
        overlay.classList.remove("show");
        overlay.setAttribute("aria-hidden", "true");
      }
    },

    escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
  };

  function base64UrlToBytes(value) {
    let source = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    while (source.length % 4) source += "=";
    const binary = atob(source);
    return Uint8Array.from(binary, function (char) {
      return char.charCodeAt(0);
    });
  }

  function bytesToBase64Url(value) {
    const bytes = new Uint8Array(value);
    let binary = "";
    bytes.forEach(function (byte) {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function addClientParams(params) {
    params.set("deviceName", navigator.platform || "");
    params.set("screenSize", window.innerWidth + "x" + window.innerHeight);
    params.set("clientTime", new Date().toISOString());
    params.set("clientTimezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    params.set("userAgent", navigator.userAgent || "");
    return params;
  }

  function apiUrl(base, params) {
    return base + "?" + params.toString();
  }

  window.AttendanceApp = {
    version: "12.0.0",
    Session: Session,
    Passkey: Passkey,
    Theme: Theme,
    UI: UI,
    jsonp: jsonp,
    base64UrlToBytes: base64UrlToBytes,
    bytesToBase64Url: bytesToBase64Url,
    addClientParams: addClientParams,
    apiUrl: apiUrl
  };
})(window);
