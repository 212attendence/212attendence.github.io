(function (window) {
  "use strict";

  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzE5SDb4aYv5MtyUCP1r0sAp24wBEfWbySKRQXxpuiLrv6irwSbG4L8ABSNWZY8pEvX/exec";
  const SESSION_KEY = "attendanceStudentSessionV1";
  const PENDING_KEY = "attendanceStudentPendingRequestV1";

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (error) { return null; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (error) { return false; }
  }

  const Session = {
    current() {
      const value = readJson(SESSION_KEY);
      return value && value.token ? value : null;
    },
    save(response) {
      if (!response || !response.studentToken) return false;
      return writeJson(SESSION_KEY, {
        token: String(response.studentToken),
        studentId: String(response.studentId || ""),
        name: String(response.name || ""),
        fingerId: String(response.fingerId || ""),
        savedAt: Date.now()
      });
    },
    clear() {
      try { localStorage.removeItem(SESSION_KEY); } catch (error) {}
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
        if (result.name || result.studentId) {
          writeJson(SESSION_KEY, Object.assign({}, session, {
            name: String(result.name || session.name || ""),
            studentId: String(result.studentId || session.studentId || ""),
            fingerId: String(result.fingerId || session.fingerId || "")
          }));
        }
        return this.current();
      } catch (error) {
        return session;
      }
    }
  };

  const Pending = {
    current() { return readJson(PENDING_KEY); },
    save(value) { return writeJson(PENDING_KEY, value || null); },
    clear() { try { localStorage.removeItem(PENDING_KEY); } catch (error) {} }
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
    const config = Object.assign({
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0
    }, options || {});

    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(Object.assign(new Error("이 기기는 위치 기능을 지원하지 않습니다."), { code: "UNSUPPORTED" }));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, config);
    });
  }

  async function getPositionWithRetry() {
    try {
      return await getPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    } catch (error) {
      if (isPermissionDenied(error) || isUnsupported(error)) throw error;
      return getPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    }
  }

  function isPermissionDenied(error) {
    return Boolean(error && Number(error.code) === 1);
  }

  function isUnsupported(error) {
    return Boolean(error && error.code === "UNSUPPORTED");
  }

  function isTransientGpsError(error) {
    const code = Number(error && error.code);
    return code === 2 || code === 3;
  }

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

  function shouldOpenGpsError(error) {
    return isPermissionDenied(error) || isUnsupported(error);
  }

  function goGpsError(error) {
    if (!shouldOpenGpsError(error)) return false;
    location.replace("/student/error/gps/?reason=" + encodeURIComponent(gpsErrorReason(error)));
    return true;
  }

  window.StudentAttendance = {
    version: "1.1.0",
    api: api,
    Session: Session,
    Pending: Pending,
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
