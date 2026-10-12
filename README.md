# BUNKER

BUNKER is a small vanilla HTML, CSS and JavaScript app organized around Firebase Authentication and Realtime Database. The local pages work without a framework; cloud sign-in and notes remain disabled until you configure your own Firebase project.

## Project layout

```text
BUNKER/
├── index.html
├── login.html
├── register.html
├── css/
│   └── style.css
├── js/
│   ├── firebase.js
│   ├── auth.js
│   ├── database.js
│   └── app.js
├── database/
│   ├── seed-data.json
│   └── init-database.js
├── database.rules.json
├── storage.rules
├── firebase.json
└── package.json
```

`scripts/serve.js` is the dependency-light local development server. `tests/` contains configuration and data-shape checks.

## Run locally

Requirements: Node.js 20 or later.

```powershell
npm install
npm run dev
```

Open <http://127.0.0.1:5173/>. Sign-in and registration display a Firebase configuration message until you add credentials.

## Firebase setup

1. Create a Firebase project and register a Web App.
2. Enable **Authentication → Sign-in method → Email/Password**.
3. Create a Realtime Database.
4. Copy the Web App `apiKey`, `authDomain`, `databaseURL`, `projectId`, `storageBucket`, and `appId` into `firebaseConfig` in `js/firebase.js`. These client config values identify your project. Never add an Admin service-account credential or provider secret to browser code.
5. Deploy database rules before using the app:

   ```powershell
   firebase deploy --only database
   ```

The database uses `users/{uid}/profile` and `users/{uid}/notes/{noteId}`. Rules deny access unless the signed-in Firebase UID matches the path UID. Storage is explicitly deny-all until a file feature and storage model are added.

## Optional Admin initialization and seed

The initializer uses Firebase Admin SDK Application Default Credentials and only accepts a UID that already exists in Firebase Authentication. It is dry-run by default, never creates accounts, and uses non-overwriting transactions.

```powershell
$env:FIREBASE_DATABASE_URL = "<your Realtime Database URL>"
gcloud auth application-default login
npm run database:init -- --uid <existing-auth-uid>
```

To apply the profile or add the sample note only when that note ID is unused:

```powershell
npm run database:init -- --apply --uid <existing-auth-uid>
npm run database:init -- --apply --seed --uid <existing-auth-uid>
```

## Data and privacy

- Passwords are handled by Firebase Authentication and never written to the database.
- Note content is written only to the authenticated user's UID-scoped Realtime Database path.
- Notes are rendered using text nodes, not HTML.
- The optional sample note is not inserted during normal app startup.
- Firebase transport is encrypted, but this starter does not provide end-to-end encryption.
- Configure email templates, allowed domains, API key restrictions, billing, and data retention in Firebase before production use.

Run local checks with `npm test`. Live Authentication and database access require your own Firebase configuration and are not exercised by the local tests.
