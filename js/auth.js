import { getFirebase } from "./firebase.js";

export async function register(email, password, displayName) {
  const cleanEmail = validateEmail(email);
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new Error("Choose a password between 8 and 128 characters.");
  }
  if (typeof displayName !== "string" || !displayName.trim() || displayName.trim().length > 50) {
    throw new Error("Display name must be between 1 and 50 characters.");
  }
  const { auth, authSdk } = await getFirebase();
  const credential = await authSdk.createUserWithEmailAndPassword(auth, cleanEmail, password);
  try {
    await authSdk.updateProfile(credential.user, { displayName: displayName.trim() });
    const { database, databaseSdk } = await getFirebase();
    const now = new Date().toISOString();
    await databaseSdk.set(databaseSdk.ref(database, `users/${credential.user.uid}/profile`), {
      uid: credential.user.uid,
      email: cleanEmail,
      displayName: displayName.trim(),
      createdAt: now,
      updatedAt: now,
    });
    await authSdk.sendEmailVerification(credential.user);
  } catch (error) {
    await authSdk.signOut(auth);
    throw error;
  }
  return credential.user;
}

export async function signIn(email, password) {
  if (typeof password !== "string" || !password) throw new Error("Enter your password.");
  const { auth, authSdk } = await getFirebase();
  const credential = await authSdk.signInWithEmailAndPassword(auth, validateEmail(email), password);
  return credential.user;
}

export async function signOut() {
  const { auth, authSdk } = await getFirebase();
  await authSdk.signOut(auth);
}

export async function resetPassword(email) {
  const { auth, authSdk } = await getFirebase();
  await authSdk.sendPasswordResetEmail(auth, validateEmail(email));
}

export async function watchAuth(callback, onError) {
  const { auth, authSdk } = await getFirebase();
  return authSdk.onAuthStateChanged(auth, callback, onError);
}

function validateEmail(email) {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new Error("Enter a valid email address.");
  }
  return email.trim();
}
