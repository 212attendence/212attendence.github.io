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

messaging.onBackgroundMessage(function (payload) {
  const title =
    payload.data && payload.data.title
      ? payload.data.title
      : "2-12 출석 알림";

  const body =
    payload.data && payload.data.body
      ? payload.data.body
      : "출석 상태가 업데이트되었습니다.";

  const url =
    payload.data && payload.data.url
      ? payload.data.url
      : "./dashboard/";

  self.registration.showNotification(title, {
    body: body,
    icon: "./favicon.png",
    badge: "./favicon.png",
    data: {
      url: url
    }
  });
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const urlToOpen =
    event.notification &&
    event.notification.data &&
    event.notification.data.url
      ? event.notification.data.url
      : "./dashboard/";

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then(function (clientList) {
      for (const client of clientList) {
        if ("focus" in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
