(function (window) {
  "use strict";

  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzE5SDb4aYv5MtyUCP1r0sAp24wBEfWbySKRQXxpuiLrv6irwSbG4L8ABSNWZY8pEvX/exec";
  const SESSION_KEY = "attendanceStudentSessionV1";
  const PENDING_KEY = "attendanceStudentPendingRequestV1";
  const CONSENT_KEY = "attendanceStudentConsentV2";
  const BOOLEAN_FIELDS = [
    "requiredAccepted", "privacyRequired", "locationRequired", "accountRequired", "deviceRequired", "policyRequired",
    "pushOptional", "diagnosticsOptional", "updatesOptional", "rememberOptional", "backgroundLocationOptional", "guardianConfirmed"
  ];

  function parseJson(value) {
    try { return JSON.parse(value || "null"); }
    catch (error) { return null; }
  }
  function readLocalJson(key) {
    try { return parseJson(localStorage.getItem(key)); }
    catch (error) { return null; }
  }
  function readSessionJson(key) {
    try { return parseJson(sessionStorage.getItem(key)); }
    catch (error) { return null; }
  }
  function writeLocalJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (error) { return false; }
  }
  function writeSessionJson(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (error) { return false; }
  }
  function removeStorage(storage, key) {
    try { storage.removeItem(key); } catch (error) {}
  }
  function strictBool(value) {
    if (value === true || value === 1) return true;
    const text = String(value == null ? "" : value).trim().toLowerCase();
    return text === "1" || text === "true" || text === "yes" || text === "y" || text === "동의" || text === "active";
  }
  function normalizeConsent(value) {
    const result = Object.assign({}, value || {});
    BOOLEAN_FIELDS.forEach(function (key) { result[key] = strictBool(result[key]); });
    return result;
  }

  const Session = {
    current() {
      const temporary = readSessionJson(SESSION_KEY);
      if (temporary && temporary.token) return Object.assign({}, temporary, { persistent: false });
      const persistent = readLocalJson(SESSION_KEY);
      return persistent && persistent.token ? Object.assign({}, persistent, { persistent: true }) : null;
    },
    save(response) {
      if (!response || !response.studentToken) return false;
      const value = {
        token: String(response.studentToken),
        studentId: String(response.studentId || ""),
        name: String(response.name || ""),
        fingerId: String(response.fingerId || ""),
        savedAt: Date.now()
      };
      removeStorage(localStorage, SESSION_KEY);
      return writeSessionJson(SESSION_KEY, value);
    },
    setPersistence(enabled) {
      const session = this.current();
      if (!session) return false;
      const value = {
        token: session.token,
        studentId: session.studentId || "",
        name: session.name || "",
        fingerId: session.fingerId || "",
        savedAt: session.savedAt || Date.now()
      };
      writeSessionJson(SESSION_KEY, value);
      if (enabled) return writeLocalJson(SESSION_KEY, value);
      removeStorage(localStorage, SESSION_KEY);
      return true;
    },
    clear() {
      removeStorage(localStorage, SESSION_KEY);
      removeStorage(sessionStorage, SESSION_KEY);
    },
    async validate() {
      const session = this.current();
      if (!session) return null;
      try {
        const result = await api("studentSessionJsonp", { studentToken: session.token }, 20000);
        if (!result || !result.ok) {
          this.clear();
          return null;
        }
        const updated = {
          token: session.token,
          studentId: String(result.studentId || session.studentId || ""),
          name: String(result.name || session.name || ""),
          fingerId: String(result.fingerId || session.fingerId || ""),
          savedAt: session.savedAt || Date.now()
        };
        writeSessionJson(SESSION_KEY, updated);
        if (session.persistent) writeLocalJson(SESSION_KEY, updated);
        return this.current();
      } catch (error) {
        return session;
      }
    }
  };

  const Pending = {
    current() { return readLocalJson(PENDING_KEY); },
    save(value) { return writeLocalJson(PENDING_KEY, value || null); },
    clear() { removeStorage(localStorage, PENDING_KEY); }
  };

  const Consent = {
    current(studentId) {
      const store = readLocalJson(CONSENT_KEY) || {};
      const key = String(studentId || "");
      const value = key ? store[key] : null;
      if (!value || String(value.status || "").toUpperCase() === "WITHDRAWN") return null;
      return normalizeConsent(value);
    },
    save(value) {
      if (!value || !value.studentId) return false;
      const normalized = normalizeConsent(value);
      const store = readLocalJson(CONSENT_KEY) || {};
      store[String(normalized.studentId)] = Object.assign({}, normalized, { savedAt: Date.now() });
      const saved = writeLocalJson(CONSENT_KEY, store);
      Session.setPersistence(normalized.rememberOptional);
      return saved;
    },
    clear(studentId) {
      const store = readLocalJson(CONSENT_KEY) || {};
      if (studentId) delete store[String(studentId)];
      else Object.keys(store).forEach(function (key) { delete store[key]; });
      return writeLocalJson(CONSENT_KEY, store);
    },
    async fetch(session) {
      if (!session || !session.token) return null;
      const result = await api("studentPrivacyStatusJsonp", { studentToken: session.token }, 22000);
      if (!result || !result.ok || !result.consent) return null;
      const consent = normalizeConsent(Object.assign({}, result.consent, {
        studentId: String(result.consent.studentId || session.studentId || ""),
        name: String(result.consent.name || session.name || ""),
        fingerId: String(result.consent.fingerId || session.fingerId || "")
      }));
      this.save(consent);
      return consent;
    },
    async ensure(session) {
      const local = this.current(session && session.studentId);
      if (local && local.requiredAccepted) return local;
      try { return await this.fetch(session); }
      catch (error) { return local; }
    }
  };

  function clientParams(params) {
    params.set("deviceName", navigator.userAgentData && navigator.userAgentData.platform || navigator.platform || "");
    params.set("screenSize", window.innerWidth + "x" + window.innerHeight);
    params.set("clientTime", new Date().toISOString());
    params.set("clientTimezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    params.set("userAgent", (navigator.userAgent || "").slice(0, 180));
    return params;
  }

  function api(action, values, timeoutMs) {
    const params = new URLSearchParams(Object.assign({ action: action }, values || {}));
    clientParams(params);
    return AttendanceApp.jsonp(AttendanceApp.apiUrl(APPS_SCRIPT_URL, params), { timeoutMs: timeoutMs || 25000 });
  }

  async function permissionState() {
    if (!navigator.geolocation) return "unsupported";
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const result = await navigator.permissions.query({ name: "geolocation" });
        return result.state || "prompt";
      }
    } catch (error) {}
    return "prompt";
  }

  function getPosition(options) {
    const config = Object.assign({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }, options || {});
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(Object.assign(new Error("이 기기는 위치 기능을 지원하지 않습니다."), { code: "UNSUPPORTED" }));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, config);
    });
  }

  async function getPositionWithRetry() {
    try { return await getPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }); }
    catch (error) {
      if (isPermissionDenied(error) || isUnsupported(error)) throw error;
      return getPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    }
  }

  function isPermissionDenied(error) { return Boolean(error && Number(error.code) === 1); }
  function isUnsupported(error) { return Boolean(error && error.code === "UNSUPPORTED"); }
  function isTransientGpsError(error) { const code = Number(error && error.code); return code === 2 || code === 3; }
  function gpsErrorReason(error) {
    if (!error) return "unknown";
    if (isPermissionDenied(error)) return "denied";
    if (Number(error.code) === 2) return "unavailable";
    if (Number(error.code) === 3) return "timeout";
    if (isUnsupported(error)) return "unsupported";
    return "unknown";
  }
  function gpsErrorMessage(error) {
    if (isPermissionDenied(error)) return "위치 권한이 차단되어 있습니다. 브라우저 또는 기기 설정에서 위치를 허용하세요.";
    if (Number(error && error.code) === 2) return "위치를 일시적으로 확인하지 못했습니다. 위치 서비스와 Wi-Fi를 확인한 뒤 다시 시도하세요.";
    if (Number(error && error.code) === 3) return "위치 확인 시간이 초과되었습니다. 잠시 기다린 뒤 다시 시도하세요.";
    if (isUnsupported(error)) return "이 기기 또는 브라우저는 위치 기능을 지원하지 않습니다.";
    return error && error.message ? error.message : "위치 정보를 확인하지 못했습니다. 다시 시도하세요.";
  }
  function shouldOpenGpsError(error) { return isPermissionDenied(error) || isUnsupported(error); }
  function goGpsError(error) {
    if (!shouldOpenGpsError(error)) return false;
    location.replace("/student/error/gps/?reason=" + encodeURIComponent(gpsErrorReason(error)));
    return true;
  }

  window.StudentAttendance = {
    version: "1.3.0",
    api: api,
    Session: Session,
    Pending: Pending,
    Consent: Consent,
    permissionState: permissionState,
    getPosition: getPosition,
    getPositionWithRetry: getPositionWithRetry,
    isPermissionDenied: isPermissionDenied,
    isUnsupported: isUnsupported,
    isTransientGpsError: isTransientGpsError,
    gpsErrorReason: gpsErrorReason,
    gpsErrorMessage: gpsErrorMessage,
    shouldOpenGpsError: shouldOpenGpsError,
    goGpsError: goGpsError
  };
})(window);
