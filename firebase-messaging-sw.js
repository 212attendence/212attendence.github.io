importScripts("https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBN10jMJZ1kB-A6RMt9-HmKWTGjtdfa8iE",
  authDomain: "attendence-f157b.firebaseapp.com",
  projectId: "attendence-f157b",
  storageBucket: "attendence-f157b.firebasestorage.app",
  messagingSenderId: "382183347016",
  appId: "1:382183347016:web:ae6aca56ac3a3058f6597d",
  measurementId: "G-JPCLPN4HQW"
});

const messaging = firebase.messaging();

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

function notificationRole(data, target) {
  const explicit = String(data.role || data.recipientRole || "").toLowerCase();
  if (explicit === "student" || explicit === "admin") return explicit;
  try {
    return new URL(target).pathname.indexOf("/student/") === 0 ? "student" : "admin";
  } catch (error) {
    return "admin";
  }
}

messaging.onBackgroundMessage(function (payload) {
  const data = payload.data || {};
  const title = data.title || "2-12 출석 알림";
  const body = data.body || "출석 상태가 업데이트되었습니다.";
  const target = new URL(data.url || "./admin/dashboard/?resume=1", self.registration.scope).href;
  const role = notificationRole(data, target);
  const iconPath = role === "student"
    ? "./assets/icons/student-icon-192.png?v=32"
    : "./assets/icons/admin-icon-192.png?v=32";
  const icon = new URL(iconPath, self.registration.scope).href;

  return self.registration.showNotification(title, {
    body: body,
    icon: icon,
    badge: icon,
    tag: data.tag || "attendance-update",
    renotify: Boolean(data.renotify === "true"),
    data: { url: target, role: role }
  });
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const targetUrl = event.notification && event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : new URL("./admin/dashboard/?resume=1", self.registration.scope).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        try {
          const clientUrl = new URL(client.url);
          const target = new URL(targetUrl);
          if (clientUrl.origin === target.origin && "focus" in client) {
            if ("navigate" in client && clientUrl.href !== target.href) {
              return client.navigate(target.href).then(function () { return client.focus(); });
            }
            return client.focus();
          }
        } catch (error) {}
      }
      return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
    })
  );
});