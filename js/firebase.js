const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  appId: "",
};

const SDK_VERSION = "12.9.0";
let initialization;

export function firebaseConfigured() {
  return Object.values(firebaseConfig).every((value) => typeof value === "string" && value.trim());
}

export async function getFirebase() {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured yet. Add your Firebase Web App values to js/firebase.js.");
  }
  if (!initialization) {
    initialization = (async () => {
      const base = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
      const [appSdk, authSdk, databaseSdk] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-database.js`),
      ]);
      const app = appSdk.getApps().find((candidate) => candidate.name === "bunker") ||
        appSdk.initializeApp(firebaseConfig, "bunker");
      const auth = authSdk.getAuth(app);
      await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
      return { app, auth, authSdk, database: databaseSdk.getDatabase(app), databaseSdk };
    })().catch((error) => {
      initialization = undefined;
      throw new Error(`Firebase could not be initialized: ${error.message}`);
    });
  }
  return initialization;
}
