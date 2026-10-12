# Firebase events and reminders

The repository started as a static HTML/CSS/JavaScript preview with mock sign-in and browser-local notes. The event feature uses the Firebase project identified by the supplied Realtime Database URL: `bunker-8fe10`, in `asia-southeast1`. It does not use Firestore or a browser timer to schedule or deliver reminders.

## Architecture

- Firebase Authentication owns user identity. Event writes go through authenticated Cloud Functions callables; clients can read only their own events and preferences.
- Realtime Database stores `/events/{uid}/{eventId}`, `/preferences/{uid}`, `/reminders/{uid}/{eventId}/{reminderId}`, `/reminderQueue/{reminderId}`, `/notifications/{uid}/{notificationId}`, `/pushTokens/{uid}/{tokenId}`, and private `/pushDeliveries` records.
- `syncEventReminders` and `syncPreferenceReminders` are database triggers. They cancel obsolete pending queue items and create eligible 2-calendar-day and 1-calendar-day reminders. Event-local wall time and IANA timezone are converted to epoch milliseconds on the server. DST gaps move to the first valid local minute; ambiguous times choose the first occurrence.
- `processDueReminders` runs every minute as a Cloud Scheduler-backed function in `asia-southeast1`. It uses a transaction lease, rechecks event ownership/status and current preferences, writes one in-app notification per reminder ID, and sends Firebase Cloud Messaging web push to enabled registrations. Terminal work is removed from the due queue. Transient FCM errors use exponential retry (one minute up to six hours, at most eight attempts); invalid registrations are removed.
- Notification read receipts are callable-function writes. Notification content is read-only to clients. Database rules deny all client access to reminders, the due queue, delivery records, and event writes.
- Browser push permission is requested only by the explicit “Enable browser push” control. The FCM service worker receives pushes while the app is closed and opens the linked event when clicked.

## Configure and deploy

1. In Firebase Console for `bunker-8fe10`, enable Email/Password Authentication, Realtime Database in `asia-southeast1`, Cloud Messaging, Cloud Functions, and Firebase Hosting. Cloud Scheduler/Functions scheduled jobs require the Blaze billing plan.
2. In Project settings, copy the **web app** config into [firebase-config.js](firebase-config.js): `apiKey`, `authDomain`, `messagingSenderId`, and `appId`. Keep the supplied `databaseURL` and `projectId`. In Cloud Messaging, create/import a Web Push certificate and set its **public** key as `vapidKey`. Web config and the VAPID public key are public identifiers, not server secrets; restrict the API key to the deployed site referrers.
3. Install Node.js 22, Firebase CLI, and the Functions dependencies:

   ```powershell
   npm install --prefix functions
   npm install --global firebase-tools
   firebase login
   ```

4. Set `APP_ORIGIN` in `functions/.env.bunker-8fe10` to the exact HTTPS Hosting origin, with no trailing slash. `functions/.env.example` is a starting point. The database URL defaults to the supplied project URL; override it with `FIREBASE_DATABASE_URL` only when targeting a different database.
5. Deploy database rules, scheduled/functions code, and the static site:

   ```powershell
   firebase deploy --only database,functions,hosting
   ```

6. Create users through Firebase Authentication (or add a signup flow), then sign in at the HTTPS Hosting URL. Open Calendar, create an event, and configure the notification timezone and intervals in Settings. Push permission is requested only when its checkbox is enabled.

Firebase Admin uses Application Default Credentials in deployed Cloud Functions. For local scripts, use `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service-account JSON stored outside this repository. Never put an Admin SDK service-account JSON, VAPID private key, service-role key, or credentials in `firebase-config.js` or the web root. The Admin code supplied with the request contains a placeholder path; it is intentionally not used in deployed functions.

## Local checks and end-to-end verification

Run the automated planner tests and syntax checks:

```powershell
npm test
npm run lint
```

The automated tests cover both offsets, late event creation, past events, reschedule revisions, completion/cancellation/reminder opt-out, deterministic duplicate keys, user key isolation, retry backoff, and DST transitions. They run without Firebase credentials.

For integration testing, set `useEmulators: true` in `firebase-config.js` while serving on `localhost`, then run the Firebase Auth, Realtime Database, Functions, and Hosting emulators. Verify these scenarios in two separate authenticated accounts:

1. Create an event more than two days away; confirm two pending records with the expected local calendar times converted to UTC.
2. Create an event 36 hours away; confirm only its future 1-day reminder is pending. Create one less than 24 hours away and confirm no past reminder is queued.
3. Reschedule an event; confirm old pending queue entries are cancelled and the new revision has only eligible reminder records. Delete, complete, and cancel events and confirm no pending queue item can deliver.
4. Save the same event repeatedly; confirm there are no duplicate reminder IDs or in-app notifications. Confirm account B cannot read account A’s events, preferences, tokens, or notifications, and cannot write events or notifications directly.
5. Change timezone and interval preferences; confirm pending reminders are recalculated. Test dates spanning both DST transitions.
6. On HTTPS (or localhost), open Settings, explicitly enable push, grant permission, and verify a token is saved under the authenticated UID. Disable push and confirm the token is removed and in-app reminders remain available.
7. With an active token and an event whose due time is within a minute, close the tab/browser and verify the OS/browser delivers the FCM notification and its click opens the event. Confirm the reminder status and delivery timestamp in Realtime Database.

## Hosting limitation

This workspace had no backend, Firebase CLI, credentials, or pre-existing deployment configuration. The implementation uses Firebase Cloud Functions plus Cloud Scheduler because the supplied Firebase project/Realtime Database is the only existing backend signal. A live deployment, Auth account creation, emulator integration run, and real closed-browser push test cannot be performed until the Firebase web config, billing-enabled project, Firebase CLI login, and Web Push public key are supplied/configured. Until then, the original mock login remains available for the visual preview, but its Calendar explicitly reports that Firebase is required and it never pretends to schedule or deliver reminders.