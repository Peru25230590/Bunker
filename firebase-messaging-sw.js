importScripts('https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js');
importScripts('/firebase-config.js');

if (globalThis.BUNKER_FIREBASE_CONFIG?.apiKey && !globalThis.BUNKER_FIREBASE_CONFIG.apiKey.startsWith('ADD_')) {
  firebase.initializeApp(globalThis.BUNKER_FIREBASE_CONFIG);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {};
    const notificationId = data.notificationId || 'event-reminder';
    return self.registration.showNotification(data.title || 'BUNKER reminder', {
      body: data.body || 'An event is coming up.',
      tag: `bunker-${notificationId}`,
      data: { link: data.link || '/' },
    });
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const fcmMessage = event.notification.data?.FCM_MSG;
  const relativeLink = event.notification.data?.link || fcmMessage?.data?.link || fcmMessage?.notification?.click_action || '/';
  const targetUrl = new URL(relativeLink, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        if ('navigate' in client) await client.navigate(targetUrl);
        return client.focus();
      }
    }
    return clients.openWindow(targetUrl);
  })());
});