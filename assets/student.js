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

  function getPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(Object.assign(new Error("이 기기는 위치 기능을 지원하지 않습니다."), { code: "UNSUPPORTED" }));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      });
    });
  }

  function gpsErrorReason(error) {
    if (!error) return "unknown";
    if (error.code === 1) return "denied";
    if (error.code === 2) return "unavailable";
    if (error.code === 3) return "timeout";
    if (error.code === "UNSUPPORTED") return "unsupported";
    return "unknown";
  }

  function goGpsError(error) {
    location.replace("../error-gps/?reason=" + encodeURIComponent(gpsErrorReason(error)));
  }

  window.StudentAttendance = {
    version: "1.0.0",
    api: api,
    Session: Session,
    Pending: Pending,
    permissionState: permissionState,
    getPosition: getPosition,
    goGpsError: goGpsError
  };
})(window);
