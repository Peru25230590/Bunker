import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";

const args = new Set(process.argv.slice(2));
const uidIndex = process.argv.indexOf("--uid");
const uid = uidIndex === -1 ? "" : process.argv[uidIndex + 1] || "";
const apply = args.has("--apply");
const seed = args.has("--seed");
const databaseURL = process.env.FIREBASE_DATABASE_URL;

if (uid && !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error("The supplied UID has an invalid format.");
if (apply && !uid) throw new Error("Applying initialization requires --uid <existing-auth-uid>.");
if (seed && !apply) throw new Error("Seeding requires --apply and --uid <existing-auth-uid>.");
if (apply && !databaseURL) throw new Error("Set FIREBASE_DATABASE_URL to your Firebase Realtime Database URL before applying changes.");

if (!apply) {
  console.log("Dry run. No Firebase data was read or changed.");
  console.log(uid
    ? `Plan: initialize missing users/${uid}/profile and users/${uid}/notes records without overwriting existing data.`
    : "Provide --uid <existing-auth-uid> to inspect the initialization plan for an existing account.");
  if (seed) console.log("The optional seed is only applied with --apply --seed --uid.");
} else {
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), databaseURL });
  try {
    const user = await getAuth(app).getUser(uid);
    const database = getDatabase(app);
    const profileRef = database.ref(`users/${uid}/profile`);
    const profile = {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || user.email?.split("@")[0] || "BUNKER User",
      createdAt: user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await profileRef.transaction((current) => current === null ? profile : undefined, false);
    console.log(`${result.committed ? "Initialized" : "Kept existing"} users/${uid}/profile`);

    if (seed) {
      const seedPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "seed-data.json");
      const seedData = JSON.parse(await readFile(seedPath, "utf8"));
      if (seedData.version !== 1 || !Array.isArray(seedData.notes)) throw new Error("The database seed file is invalid.");
      for (const note of seedData.notes) {
        if (!note || !/^[A-Za-z0-9_-]{1,128}$/.test(note.id) || typeof note.title !== "string" || !note.title.trim() || note.title.length > 120 || typeof note.content !== "string" || note.content.length > 10_000) {
          throw new Error("The database seed contains an invalid note. Nothing else will be seeded.");
        }
      }
      for (const note of seedData.notes) {
        const now = new Date().toISOString();
        const noteRef = database.ref(`users/${uid}/notes/${note.id}`);
        const seedRecord = { ...note, createdAt: now, updatedAt: now };
        const seeded = await noteRef.transaction((current) => current === null ? seedRecord : undefined, false);
        console.log(`${seeded.committed ? "Seeded" : "Kept existing"} users/${uid}/notes/${note.id}`);
      }
    }
  } finally {
    await app.delete();
  }
}
