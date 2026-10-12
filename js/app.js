import * as auth from "./auth.js";
import * as database from "./database.js";
import { firebaseConfigured } from "./firebase.js";

const notice = document.querySelector("[data-notice]");
const noteList = document.querySelector("[data-notes]");
let currentUser = null;

function showNotice(message, isError = false) {
  if (!notice) return;
  notice.textContent = message;
  notice.setAttribute("role", isError ? "alert" : "status");
  notice.classList.toggle("notice-error", isError);
}

function showSignedInState(user) {
  for (const element of document.querySelectorAll("[data-user-only]")) element.hidden = !user;
  for (const element of document.querySelectorAll("[data-guest-only]")) element.hidden = Boolean(user);
  const status = document.querySelector(".account-status");
  if (status && user) status.textContent = `Welcome, ${user.displayName || user.email}. Your notes are private to this account.`;
}

function renderNotes(notes) {
  if (!noteList) return;
  noteList.replaceChildren();
  if (!notes.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No notes yet. Add the first note to your vault.";
    noteList.append(empty);
    return;
  }
  for (const note of notes) {
    const article = document.createElement("article");
    article.className = "note-card";
    const title = document.createElement("h3");
    title.textContent = note.title;
    const content = document.createElement("p");
    content.textContent = note.content;
    const footer = document.createElement("footer");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "text-button";
    deleteButton.textContent = "Delete note";
    deleteButton.dataset.deleteNote = note.id;
    footer.append(deleteButton);
    article.append(title, content, footer);
    noteList.append(article);
  }
}

async function refreshNotes() {
  if (!currentUser || !noteList) return;
  renderNotes(await database.listNotes(currentUser.uid));
}

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const submit = form.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
  try {
    if (form.dataset.form === "register") {
      await auth.register(data.get("email"), data.get("password"), data.get("displayName"));
      showNotice("Account created. Check your email to verify your address, then sign in.");
      form.reset();
    } else if (form.dataset.form === "login") {
      await auth.signIn(data.get("email"), data.get("password"));
      location.assign("./index.html");
    } else if (form.dataset.form === "new-note") {
      if (!currentUser) throw new Error("Sign in before saving a note.");
      await database.saveNote(currentUser.uid, { title: data.get("title"), content: data.get("content") });
      form.reset();
      await refreshNotes();
      showNotice("Your note was saved to your Firebase account.");
    }
  } catch (error) {
    showNotice(error.message || "That request could not be completed.", true);
  } finally {
    if (submit) submit.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action], [data-delete-note]");
  if (!button) return;
  try {
    if (button.dataset.action === "sign-out") {
      await auth.signOut();
      location.assign("./index.html");
    } else if (button.dataset.action === "reset-password") {
      const email = document.querySelector('input[name="email"]')?.value;
      await auth.resetPassword(email);
      showNotice("If an account exists for that address, password-reset instructions have been sent.");
    } else if (button.dataset.deleteNote) {
      if (!currentUser || !confirm("Delete this note from your Firebase account?")) return;
      await database.deleteNote(currentUser.uid, button.dataset.deleteNote);
      await refreshNotes();
      showNotice("Note deleted.");
    }
  } catch (error) {
    showNotice(error.message || "That request could not be completed.", true);
  }
});

async function start() {
  if (!firebaseConfigured()) {
    showSignedInState(null);
    showNotice("Firebase setup required: add your Web App settings in js/firebase.js and enable Email/Password Authentication.", true);
    return;
  }
  try {
    await auth.watchAuth(async (user) => {
      currentUser = user;
      showSignedInState(user);
      if (noteList && user) {
        try {
          await refreshNotes();
        } catch (error) {
          showNotice(error.message, true);
        }
      }
    }, (error) => showNotice(`Authentication state could not be checked: ${error.message}`, true));
  } catch (error) {
    showNotice(error.message, true);
  }
}

void start();
