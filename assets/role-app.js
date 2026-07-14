(function (window) {
  "use strict";

  const API_URL = "https://script.google.com/macros/s/AKfycbzE5SDb4aYv5MtyUCP1r0sAp24wBEfWbySKRQXxpuiLrv6irwSbG4L8ABSNWZY8pEvX/exec";
  const PERMISSION_KEY = "attendanceCombinedPermissionAskedV1";
  const PUSH_REGISTERED_KEY = "attendancePushRegisteredV1";
  const FIREBASE_SCRIPTS = [
    "https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js"
  ];

  let deferredInstallPrompt = null;
  let serviceWorkerRegistration = null;
  let permissionBusy = false;

  function role() {
    if (location.pathname.indexOf("/student/") === 0) return "student";
    if (location.pathname.indexOf("/admin/") === 0 || location.pathname.indexOf("/accounts-s/") === 0) return "admin";
    return "root";
  }

  function isStandalone() {
    return navigator.standalone === true ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      serviceWorkerRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
      return serviceWorkerRegistration;
    } catch (error) {
      console.warn("Service worker registration failed", error);
      return null;
    }
  }

  function geolocationPermissionState() {
    if (!navigator.geolocation) return Promise.resolve("unsupported");
    if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve("prompt");
    return navigator.permissions.query({ name: "geolocation" })
      .then(function (result) { return result.state || "prompt"; })
      .catch(function () { return "prompt"; });
  }

  function requestLocationPermission() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve({ state: "unsupported" });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (position) { resolve({ state: "granted", position: position }); },
        function (error) { resolve({ state: Number(error && error.code) === 1 ? "denied" : "temporary", error: error }); },
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
      );
    });
  }

  function createPermissionModal() {
    if (document.getElementById("combinedPermissionOverlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "combinedPermissionOverlay";
    overlay.setAttribute("aria-hidden", "false");
    overlay.innerHTML = '<section class="combined-permission-card" role="dialog" aria-modal="true" aria-labelledby="combinedPermissionTitle">' +
      '<div class="combined-permission-chip">최초 1회 설정</div>' +
      '<h2 id="combinedPermissionTitle">위치와 알림 권한을 설정합니다</h2>' +
      '<p>출석 위치 확인과 로그인·출석 완료 알림에 사용합니다. 원본 GPS 좌표는 출석 로그에 저장하지 않습니다.</p>' +
      '<div class="combined-permission-list"><span>✓ 위치 권한 및 정확한 위치</span><span>✓ 출석·로그인 알림</span></div>' +
      '<button id="combinedPermissionAllow" class="btn btn-primary btn-block" type="button">권한 허용하고 시작</button>' +
      '<button id="combinedPermissionLater" class="btn btn-soft btn-block" type="button">나중에 설정</button>' +
      '<small>브라우저 또는 운영체제가 위치와 알림을 각각 한 번씩 확인할 수 있습니다.</small>' +
      '</section>';
    const style = document.createElement("style");
    style.id = "combinedPermissionStyles";
    style.textContent = "#combinedPermissionOverlay{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:18px;background:rgba(15,17,16,.54);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.combined-permission-card{width:min(430px,100%);padding:24px;border:1px solid var(--line);border-radius:28px;background:var(--surface-strong);box-shadow:0 28px 90px rgba(0,0,0,.3)}.combined-permission-card h2{margin:12px 0 8px;font-size:23px}.combined-permission-card p{color:var(--muted);font-size:13px;line-height:1.65;font-weight:650}.combined-permission-chip{display:inline-flex;padding:6px 10px;border-radius:999px;background:var(--surface-soft);font-size:11px;font-weight:900}.combined-permission-list{display:grid;gap:8px;margin:16px 0}.combined-permission-list span{padding:11px 12px;border:1px solid var(--line);border-radius:14px;background:var(--surface-soft);font-size:13px;font-weight:800}.combined-permission-card .btn{margin-top:9px}.combined-permission-card small{display:block;margin-top:13px;color:var(--muted);font-size:11px;line-height:1.55;text-align:center}";
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    document.getElementById("combinedPermissionAllow").addEventListener("click", requestCombinedPermissions);
    document.getElementById("combinedPermissionLater").addEventListener("click", function () {
      localStorage.setItem(PERMISSION_KEY, "later");
      overlay.remove();
    });
  }

  async function requestCombinedPermissions() {
    if (permissionBusy) return;
    permissionBusy = true;
    const allowButton = document.getElementById("combinedPermissionAllow");
    if (allowButton) {
      allowButton.disabled = true;
      allowButton.textContent = "권한 확인 중…";
    }

    const notificationPromise = ("Notification" in window && Notification.permission === "default")
      ? Notification.requestPermission().catch(function () { return "denied"; })
      : Promise.resolve(("Notification" in window) ? Notification.permission : "unsupported");
    const locationPromise = requestLocationPermission();

    const results = await Promise.all([notificationPromise, locationPromise]);
    localStorage.setItem(PERMISSION_KEY, "done");
    const overlay = document.getElementById("combinedPermissionOverlay");
    if (overlay) overlay.remove();
    permissionBusy = false;

    if (results[0] === "granted") await registerPushToken();
    window.dispatchEvent(new CustomEvent("attendance-permissions-ready", { detail: { notification: results[0], location: results[1] } }));
  }

  async function maybeShowPermissionOnboarding() {
    if (role() === "root") return;
    if (localStorage.getItem(PERMISSION_KEY)) return;
    const locationState = await geolocationPermissionState();
    const notificationState = ("Notification" in window) ? Notification.permission : "unsupported";
    if (locationState === "granted" && notificationState === "granted") {
      localStorage.setItem(PERMISSION_KEY, "done");
      await registerPushToken();
      return;
    }
    createPermissionModal();
  }

  async function showLocalNotification(title, body, targetUrl) {
    if (!("Notification" in window) || Notification.permission !== "granted") return false;
    const registration = serviceWorkerRegistration || await registerServiceWorker();
    if (registration && registration.showNotification) {
      await registration.showNotification(title, {
        body: body || "",
        icon: "/favicon.png?v=24",
        badge: "/favicon.png?v=24",
        tag: "attendance-local-" + Date.now(),
        data: { url: targetUrl || location.href }
      });
      return true;
    }
    return false;
  }

  function jsonp(action, values, timeoutMs) {
    const params = new URLSearchParams(Object.assign({ action: action }, values || {}));
    if (window.AttendanceApp && AttendanceApp.addClientParams) AttendanceApp.addClientParams(params);
    return AttendanceApp.jsonp(AttendanceApp.apiUrl(API_URL, params), { timeoutMs: timeoutMs || 25000 });
  }

  async function getPushClientConfig() {
    try {
      const result = await jsonp("pushClientConfigJsonp", {}, 18000);
      return result && result.ok ? result : null;
    } catch (error) {
      return null;
    }
  }

  async function registerPushToken() {
    if (!("Notification" in window) || Notification.permission !== "granted") return false;
    const registration = serviceWorkerRegistration || await registerServiceWorker();
    const config = await getPushClientConfig();
    if (!registration || !config || !config.firebase || !config.vapidKey) return false;
    try {
      for (const src of FIREBASE_SCRIPTS) await loadScript(src);
      if (!window.firebase) return false;
      if (!firebase.apps.length) firebase.initializeApp(config.firebase);
      const token = await firebase.messaging().getToken({ vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
      if (!token) return false;
      const params = {
        token: token,
        platform: role() + "-pwa",
        userAgent: (navigator.userAgent || "").slice(0, 180)
      };
      if (role() === "student" && window.StudentAttendance) {
        const session = StudentAttendance.Session.current();
        if (!session) return false;
        params.studentToken = session.token;
        const result = await jsonp("saveStudentPushTokenJsonp", params, 22000);
        if (result && result.ok) localStorage.setItem(PUSH_REGISTERED_KEY, "student");
        return Boolean(result && result.ok);
      }
      if (role() === "admin" && window.AttendanceApp) {
        AttendanceApp.Session.addAuthParams(new URLSearchParams());
        const query = new URLSearchParams({ action: "savePushTokenJsonp", token: token, platform: "admin-pwa", userAgent: params.userAgent });
        AttendanceApp.Session.addAuthParams(query);
        AttendanceApp.addClientParams(query);
        const result = await AttendanceApp.jsonp(AttendanceApp.apiUrl(API_URL, query), { timeoutMs: 22000 });
        if (result && result.ok) localStorage.setItem(PUSH_REGISTERED_KEY, "admin");
        return Boolean(result && result.ok);
      }
    } catch (error) {
      console.warn("Push token registration failed", error);
    }
    return false;
  }

  async function sha256Base64Url(value) {
    const bytes = new TextEncoder().encode(String(value || ""));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return AttendanceApp.bytesToBase64Url(digest);
  }

  async function secureAdminLogin(adminId, adminPassword) {
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
      throw new Error(error && error.message || "보안 로그인 서버에 연결하지 못했습니다. Apps Script V5 배포를 확인하세요.");
    }
  }

  async function getCoarsePosition() {
    if (!navigator.geolocation) return null;
    const state = await geolocationPermissionState();
    if (state !== "granted") return null;
    return new Promise(function (resolve) {
      navigator.geolocation.getCurrentPosition(function (position) {
        resolve({
          latitude: Number(position.coords.latitude).toFixed(2),
          longitude: Number(position.coords.longitude).toFixed(2),
          accuracy: Math.round(Number(position.coords.accuracy || 0))
        });
      }, function () { resolve(null); }, { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 });
    });
  }

  async function notifyAdminLogin(loginType) {
    if (!window.AttendanceApp || !AttendanceApp.Session.has()) return false;
    const coarse = await getCoarsePosition();
    const params = new URLSearchParams({
      action: "adminLoginEventJsonp",
      loginType: String(loginType || "admin"),
      latitude: coarse ? coarse.latitude : "",
      longitude: coarse ? coarse.longitude : "",
      accuracy: coarse ? String(coarse.accuracy) : "",
      deviceName: navigator.userAgentData && navigator.userAgentData.platform || navigator.platform || ""
    });
    AttendanceApp.Session.addAuthParams(params);
    AttendanceApp.addClientParams(params);
    try {
      const result = await AttendanceApp.jsonp(AttendanceApp.apiUrl(API_URL, params), { timeoutMs: 18000 });
      await showLocalNotification("관리자 로그인 완료", coarse ? "대략적 위치 " + coarse.latitude + ", " + coarse.longitude : "위치 정보 없이 로그인했습니다.", "/admin/dashboard/");
      return Boolean(result && result.ok);
    } catch (error) {
      return false;
    }
  }

  function dispatchResume(reason) {
    window.dispatchEvent(new CustomEvent("attendance-role-resume", { detail: { reason: reason || "resume", role: role() } }));
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    window.dispatchEvent(new CustomEvent("attendance-install-available"));
  });

  async function promptInstall() {
    if (!deferredInstallPrompt) return { available: false };
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return { available: true, outcome: choice && choice.outcome || "dismissed" };
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) dispatchResume("visible");
  });
  window.addEventListener("focus", function () { dispatchResume("focus"); });
  window.addEventListener("pageshow", function () { dispatchResume("pageshow"); });

  function showInstallAssistant(){if(new URLSearchParams(location.search).get("install")!=="1"||isStandalone())return;const box=document.createElement("div");box.id="roleInstallAssistant";box.innerHTML='<section class="combined-permission-card" style="position:fixed;z-index:1150;left:50%;bottom:18px;transform:translateX(-50%);width:min(430px,calc(100vw - 28px))"><div class="combined-permission-chip">'+(role()==="student"?"학생용 앱":"관리자용 앱")+'</div><h2 style="margin:10px 0 6px">이 화면을 별도 앱으로 설치</h2><p id="roleInstallText">브라우저 설치 메뉴를 이용하거나 아래 설치 버튼을 누르세요.</p><button id="roleInstallButton" class="btn btn-primary btn-block" type="button">앱 설치</button><button id="roleInstallClose" class="btn btn-soft btn-block" type="button">닫기</button></section>';document.body.appendChild(box);document.getElementById("roleInstallButton").onclick=async function(){const result=await promptInstall();if(!result.available)document.getElementById("roleInstallText").textContent=/iPhone|iPad|iPod/.test(navigator.userAgent)?"Safari 공유 버튼 → 홈 화면에 추가를 선택하세요.":"브라우저 메뉴 → 앱 설치 또는 홈 화면에 추가를 선택하세요."};document.getElementById("roleInstallClose").onclick=function(){box.remove()}}

  document.addEventListener("DOMContentLoaded", async function () {
    await registerServiceWorker();
    showInstallAssistant();
    await maybeShowPermissionOnboarding();
    if ("Notification" in window && Notification.permission === "granted") registerPushToken();
    setTimeout(function () { dispatchResume("startup"); }, 900);
  });

  window.AttendanceRoleApp = {
    version: "1.0.0",
    role: role,
    isStandalone: isStandalone,
    promptInstall: promptInstall,
    registerPushToken: registerPushToken,
    showLocalNotification: showLocalNotification,
    secureAdminLogin: secureAdminLogin,
    notifyAdminLogin: notifyAdminLogin,
    getCoarsePosition: getCoarsePosition,
    requestCombinedPermissions: requestCombinedPermissions
  };
})(window);
