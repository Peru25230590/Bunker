const SDK = 'https://www.gstatic.com/firebasejs/11.0.2';
const config = globalThis.BUNKER_FIREBASE_CONFIG || {};
const requiredConfig = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'messagingSenderId', 'appId'];
const configured = requiredConfig.every((key) => typeof config[key] === 'string' && config[key].length > 0 && !config[key].startsWith('ADD_'));

function publish(backend, ready = true) {
  globalThis.bunkerBackend = backend;
  window.dispatchEvent(new CustomEvent('bunker-firebase-ready', { detail: { backend, configured, ready } }));
}

if (!configured) {
  publish(null);
} else {
  try {
    const [appSdk, authSdk, databaseSdk, functionsSdk] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-database.js`),
      import(`${SDK}/firebase-functions.js`),
    ]);
    const app = appSdk.initializeApp(config);
    const auth = authSdk.getAuth(app);
    const database = databaseSdk.getDatabase(app);
    const functions = functionsSdk.getFunctions(app, 'asia-southeast1');
    if (config.useEmulators === true) {
      if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('Firebase emulators are allowed only on localhost.');
      authSdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      databaseSdk.connectDatabaseEmulator(database, '127.0.0.1', 9000);
      functionsSdk.connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    }
    const call = (name, data) => functionsSdk.httpsCallable(functions, name)(data).then((result) => result.data);

    const backend = {
      auth,
      signIn: (email, password) => authSdk.signInWithEmailAndPassword(auth, email, password),
      signUp: (email, password) => authSdk.createUserWithEmailAndPassword(auth, email, password),
      signOut: () => authSdk.signOut(auth),
      onAuthStateChanged: (callback) => authSdk.onAuthStateChanged(auth, callback),
      subscribeEvents: (uid, callback, onError) => databaseSdk.onValue(databaseSdk.ref(database, `events/${uid}`), (snapshot) => callback(snapshot.val() || {}), onError),
      subscribeNotifications: (uid, callback, onError) => databaseSdk.onValue(databaseSdk.ref(database, `notifications/${uid}`), (snapshot) => callback(snapshot.val() || {}), onError),
      async loadPreferences(uid) {
        const snapshot = await databaseSdk.get(databaseSdk.ref(database, `preferences/${uid}`));
        return snapshot.val() || {};
      },
      savePreferences: (uid, preferences) => databaseSdk.update(databaseSdk.ref(database, `preferences/${uid}`), preferences),
      saveEvent: (event) => call('saveCalendarEvent', event),
      deleteEvent: (eventId) => call('deleteCalendarEvent', { eventId }),
      markNotificationRead: (notificationId) => call('markNotificationRead', { notificationId }),
      markAllNotificationsRead: () => call('markAllNotificationsRead', {}),
      async enablePush(uid) {
        if (config.useEmulators === true) throw new Error('Browser push delivery requires the deployed Firebase project, not the emulators.');
        if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('Browser notifications are not supported here.');
        if (!config.vapidKey || config.vapidKey.startsWith('ADD_')) throw new Error('Add the Firebase Web Push certificate key to firebase-config.js first.');
        const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
        if (permission !== 'granted') throw new Error(`Browser notification permission is ${permission}.`);
        const messagingSdk = await import(`${SDK}/firebase-messaging.js`);
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        const messaging = messagingSdk.getMessaging(app);
        const token = await messagingSdk.getToken(messaging, { vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
        if (!token) throw new Error('Firebase did not return a browser push token.');
        const tokenId = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map((value) => value.toString(16).padStart(2, '0')).join('');
        await databaseSdk.set(databaseSdk.ref(database, `pushTokens/${uid}/${tokenId}`), { token, createdAt: Date.now() });
        await databaseSdk.update(databaseSdk.ref(database, `preferences/${uid}`), { pushEnabled: true });
        try { localStorage.setItem(`bunker-push-token:${uid}`, tokenId); } catch { /* The database remains authoritative for the registration. */ }
        return permission;
      },
      async disablePush(uid) {
        await databaseSdk.update(databaseSdk.ref(database, `preferences/${uid}`), { pushEnabled: false });
        let tokenId = null;
        try { tokenId = localStorage.getItem(`bunker-push-token:${uid}`); } catch { /* The push preference still disables server delivery. */ }
        if (tokenId) await databaseSdk.remove(databaseSdk.ref(database, `pushTokens/${uid}/${tokenId}`));
        try { localStorage.removeItem(`bunker-push-token:${uid}`); } catch { /* A stale token is ignored while push is disabled. */ }
        try {
          const messagingSdk = await import(`${SDK}/firebase-messaging.js`);
          await messagingSdk.deleteToken(messagingSdk.getMessaging(app));
        } catch {
          // A stale token is harmless while server-side push is disabled.
        }
      },
      async onForegroundMessage(callback) {
        try {
          const messagingSdk = await import(`${SDK}/firebase-messaging.js`);
          return messagingSdk.onMessage(messagingSdk.getMessaging(app), callback);
        } catch {
          return () => {};
        }
      },
    };

    publish(backend);
  } catch (error) {
    console.error('Firebase client initialization failed.', error);
    publish(null, false);
  }
}