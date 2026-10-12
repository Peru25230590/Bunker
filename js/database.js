import { getFirebase } from "./firebase.js";

function userNotesRef(databaseSdk, database, uid) {
  if (!uid) throw new Error("Sign in before accessing your vault.");
  return databaseSdk.ref(database, `users/${uid}/notes`);
}

export async function listNotes(uid) {
  const { database, databaseSdk } = await getFirebase();
  const snapshot = await databaseSdk.get(userNotesRef(databaseSdk, database, uid));
  if (!snapshot.exists()) return [];
  const records = snapshot.val();
  if (!records || typeof records !== "object" || Array.isArray(records)) {
    throw new Error("The saved notes have an invalid format.");
  }
  const entries = Object.entries(records);
  if (!entries.every(([id, note]) =>
    note && note.id === id && typeof note.title === "string" && note.title.length > 0 && note.title.length <= 120 &&
    typeof note.content === "string" && note.content.length <= 10_000 &&
    typeof note.createdAt === "string" && typeof note.updatedAt === "string" &&
    (note.tags === undefined || (Array.isArray(note.tags) && note.tags.length <= 20 && note.tags.every((tag) => typeof tag === "string" && tag.length <= 40))),
  )) {
    throw new Error("The saved notes contain an invalid record. No notes were displayed.");
  }
  return entries.map(([, note]) => note)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveNote(uid, { id, title, content }) {
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (!cleanTitle || cleanTitle.length > 120) throw new Error("Note titles must be between 1 and 120 characters.");
  if (typeof content !== "string" || content.length > 10_000) throw new Error("Note text must be 10,000 characters or fewer.");
  const { database, databaseSdk } = await getFirebase();
  const now = new Date().toISOString();
  const recordId = id || databaseSdk.push(userNotesRef(databaseSdk, database, uid)).key;
  if (!recordId || !/^[A-Za-z0-9_-]{1,128}$/.test(recordId)) throw new Error("A valid note ID could not be generated.");
  const noteRef = databaseSdk.ref(database, `users/${uid}/notes/${recordId}`);
  const existing = await databaseSdk.get(noteRef);
  const note = { id: recordId, title: cleanTitle, content, createdAt: existing.val()?.createdAt || now, updatedAt: now };
  await databaseSdk.set(noteRef, note);
  return note;
}

export async function deleteNote(uid, noteId) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(noteId || "")) throw new Error("This note ID is invalid.");
  const { database, databaseSdk } = await getFirebase();
  await databaseSdk.remove(databaseSdk.ref(database, `users/${uid}/notes/${noteId}`));
}
