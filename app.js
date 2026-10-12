const STORAGE = {
  theme: 'bunker-theme',
  notes: 'bunker-notes',
  collections: 'bunker-collections',
};

const starterCollections = ['Ideas', 'Reading list', 'Research', 'Personal'];
const starterNotes = [
  { id: 'welcome-note', title: 'A small note to begin', body: 'Your ideas deserve a home. Start collecting the details, links, and little sparks you want to keep close.', collection: 'Ideas', type: 'Note', color: 'rose', updated: 'Just now', pinned: true, created: Date.now() },
  { id: 'quiet-reading', title: 'The art of noticing', body: 'A few thoughts on paying attention to ordinary things, and making a little more room for curiosity.', collection: 'Reading list', type: 'Article', color: 'blue', updated: 'Yesterday', pinned: true, created: Date.now() - 86400000 },
  { id: 'garden-research', title: 'Garden notes for spring', body: 'Plants to look into, light conditions, and a few references to revisit when the days get longer.', collection: 'Research', type: 'Document', color: 'green', updated: 'Oct 9', pinned: false, created: Date.now() - 259200000 },
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const authScreen = $('#auth-screen');
const workspace = $('#workspace');
const logoutScreen = $('#logout-screen');
const dialog = $('#app-dialog');
const dialogBody = $('#dialog-body');
let notes = loadJSON(STORAGE.notes, starterNotes);
let collections = loadJSON(STORAGE.collections, starterCollections);
let activeView = 'overview';
let activeCollection = '';
let toastTimer;
let firebaseBackend = null;
let firebaseConfigured = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'messagingSenderId', 'appId'].every((key) => {
  const value = globalThis.BUNKER_FIREBASE_CONFIG?.[key];
  return typeof value === 'string' && value.length > 0 && !value.startsWith('ADD_');
});
let firebaseUser = null;
let currentUser = null;
let userPreferences = {};
let calendarEvents = [];
let notificationItems = [];
let stopEventsSubscription = null;
let stopNotificationsSubscription = null;
let stopForegroundMessages = null;
let loggingOut = false;

function loadJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    showToast('This browser could not save your changes.');
  }
}

function setTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#09090d' : '#fff8fa';
  $$('.theme-toggle').forEach((button) => {
    button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
    button.title = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
  });
  if (!persist) return;
  try {
    localStorage.setItem(STORAGE.theme, theme);
  } catch {
    showToast('Theme changed for this visit only.');
  }
  if (firebaseBackend && firebaseUser) firebaseBackend.savePreferences(firebaseUser.uid, { theme }).catch(() => showToast('Theme saved on this device only.'));
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function renderCollections() {
  $('#collection-list').innerHTML = collections.map((collection) => `
    <button class="collection-item${activeCollection === collection ? ' selected' : ''}" type="button" data-collection="${escapeHTML(collection)}">
      <span class="collection-dot" aria-hidden="true"></span><span>${escapeHTML(collection)}</span>
    </button>`).join('');
  $('#stat-collections').textContent = collections.length;
}

function cardMarkup(note, index = 0) {
  return `<article class="note-card" data-note-id="${escapeHTML(note.id)}" tabindex="0" role="button" aria-label="Open ${escapeHTML(note.title)}" style="animation-delay:${Math.min(index * 45, 180)}ms">
    <div class="note-card-top"><span class="category-label" data-color="${escapeHTML(note.color || 'rose')}"><i aria-hidden="true"></i>${escapeHTML(note.collection || 'Ideas')}</span><button class="note-pin${note.pinned ? ' is-pinned' : ''}" type="button" data-pin="${escapeHTML(note.id)}" aria-label="${note.pinned ? 'Unpin' : 'Pin'} ${escapeHTML(note.title)}">${note.pinned ? '★' : '☆'}</button></div>
    <h3>${escapeHTML(note.title)}</h3><p>${escapeHTML(note.body)}</p>
    <div class="note-card-bottom"><span>${escapeHTML(note.updated || 'Recently')}</span><span class="note-type">${escapeHTML(note.type || 'Note')}</span></div>
  </article>`;
}

function emptyMarkup(title, detail) {
  return `<div class="empty-state"><span class="empty-flower" aria-hidden="true">✿</span><strong>${escapeHTML(title)}</strong><span>${escapeHTML(detail)}</span></div>`;
}

function filteredNotes() {
  const query = $('#library-search').value.trim().toLowerCase();
  let result = notes;
  if (activeView === 'favorites') result = result.filter((note) => note.pinned);
  if (activeView === 'recent') result = [...result].sort((a, b) => b.created - a.created);
  if (activeCollection) result = result.filter((note) => note.collection === activeCollection);
  if (query) result = result.filter((note) => `${note.title} ${note.body} ${note.collection}`.toLowerCase().includes(query));
  return result;
}

function renderLibrary() {
  const filtered = filteredNotes();
  const heading = activeCollection || (activeView === 'favorites' ? 'Favorites' : activeView === 'recent' ? 'Recently opened' : activeView === 'notes' ? 'All notes' : 'Recently opened');
  $('#recent-heading').textContent = heading;
  $('#breadcrumb-current').textContent = heading;
  $('#nav-note-count').textContent = notes.length;
  $('#stat-notes').textContent = notes.length;
  $('#stat-resources').textContent = notes.filter((note) => note.type !== 'Note').length;
  $('#stat-week').textContent = notes.filter((note) => Date.now() - note.created < 7 * 86400000).length;
  const visibleNotes = activeView === 'overview' && !$('#library-search').value.trim() ? filtered.slice(0, 3) : filtered;
  $('#recent-grid').innerHTML = visibleNotes.length ? visibleNotes.map(cardMarkup).join('') : emptyMarkup('Nothing here just yet', 'Create a note to start your collection.');
  const pinned = notes.filter((note) => note.pinned).slice(0, 4);
  $('#pinned-list').innerHTML = pinned.length ? pinned.map((note) => `<article class="pinned-row" data-note-id="${escapeHTML(note.id)}" tabindex="0" role="button" aria-label="Open ${escapeHTML(note.title)}"><span class="pinned-type" aria-hidden="true">${note.type === 'Note' ? '▤' : '↗'}</span><span class="pinned-copy"><strong>${escapeHTML(note.title)}</strong><small>${escapeHTML(note.collection)} · ${escapeHTML(note.updated)}</small></span><span class="pinned-arrow" aria-hidden="true">→</span></article>`).join('') : emptyMarkup('No pinned items', 'Pin a note to keep it close.');
  renderCollections();
}

function showWorkspace(user) {
  authScreen.classList.remove('auth-exiting');
  authScreen.hidden = true;
  logoutScreen.hidden = true;
  workspace.hidden = false;
  const displayName = user.name || user.displayName || user.email.split('@')[0];
  const firstName = displayName.split(/[ ._-]+/)[0] || 'Friend';
  $('#welcome-title').innerHTML = `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${escapeHTML(firstName)}<span class="welcome-flower" aria-hidden="true">✿</span>`;
  $('#profile-name').textContent = displayName;
  $('#profile-email').textContent = user.email;
  $('#profile-avatar').textContent = firstName[0].toUpperCase();
  $('#today-label').textContent = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();
  renderLibrary();
  renderCalendar();
  renderNotifications();
}

function endBackendSession() {
  stopEventsSubscription?.();
  stopNotificationsSubscription?.();
  stopForegroundMessages?.();
  stopEventsSubscription = null;
  stopNotificationsSubscription = null;
  stopForegroundMessages = null;
  calendarEvents = [];
  notificationItems = [];
  currentUser = null;
  renderCalendar();
  renderNotifications();
}

async function beginBackendSession(user) {
  endBackendSession();
  currentUser = user;
  const storedPreferences = await firebaseBackend.loadPreferences(user.uid).catch(() => ({}));
  userPreferences = {
    remindersEnabled: true,
    reminder2Days: true,
    reminder1Day: true,
    pushEnabled: false,
    catSoundsEnabled: false,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    theme: document.documentElement.dataset.theme || 'light',
    ...storedPreferences,
  };
  const defaultsToSave = Object.fromEntries(Object.entries({
    remindersEnabled: true,
    reminder2Days: true,
    reminder1Day: true,
    pushEnabled: false,
    catSoundsEnabled: false,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    theme: document.documentElement.dataset.theme || 'light',
  }).filter(([key]) => storedPreferences[key] === undefined));
  if (Object.keys(defaultsToSave).length) await firebaseBackend.savePreferences(user.uid, defaultsToSave).catch(() => {});
  if (storedPreferences.theme === 'light' || storedPreferences.theme === 'dark') setTheme(storedPreferences.theme, false);
  stopEventsSubscription = firebaseBackend.subscribeEvents(user.uid, (events) => {
    calendarEvents = Object.entries(events).map(([id, event]) => ({ ...event, id }));
    renderCalendar();
    const targetId = new URLSearchParams(location.search).get('event');
    if (targetId) {
      setView('calendar');
      const target = calendarEvents.find((event) => event.id === targetId);
      if (target) openEventEditor(target);
      history.replaceState(null, '', location.pathname);
    }
  }, () => showToast('Could not load calendar events.'));
  stopNotificationsSubscription = firebaseBackend.subscribeNotifications(user.uid, (notifications) => {
    notificationItems = Object.values(notifications).sort((left, right) => right.createdAt - left.createdAt);
    renderNotifications();
  }, () => showToast('Could not load notifications.'));
  stopForegroundMessages = await firebaseBackend.onForegroundMessage((payload) => {
    showToast(payload.notification?.title || 'A BUNKER reminder is ready.');
  });
  renderCalendar();
}

function openDialog(title, eyebrow, content, onSubmit) {
  $('#dialog-title').textContent = title;
  $('#dialog-eyebrow').textContent = eyebrow;
  dialogBody.innerHTML = content;
  $('#dialog-form').onsubmit = (event) => {
    event.preventDefault();
    onSubmit?.(new FormData(event.currentTarget));
  };
  dialog.showModal();
  requestAnimationFrame(() => $('input:not([type="hidden"]), textarea, select, button:not(.dialog-close)', dialog)?.focus());
}

function openNote(note = null) {
  const isEditing = Boolean(note);
  const options = [...new Set([...collections, note?.collection].filter(Boolean))];
  openDialog(isEditing ? 'Edit note' : 'Create a note', 'YOUR LIBRARY', `
    <div class="dialog-field"><label for="note-title">Title</label><input class="dialog-input" id="note-title" name="title" maxlength="100" required placeholder="Give this thought a name" value="${escapeHTML(note?.title || '')}" /></div>
    <div class="dialog-field"><label for="note-body">A few details</label><textarea class="dialog-textarea" id="note-body" name="body" maxlength="2000" placeholder="Write down what you want to remember...">${escapeHTML(note?.body || '')}</textarea></div>
    <div class="dialog-field"><label for="note-collection">Collection</label><select class="dialog-select" id="note-collection" name="collection">${options.map((item) => `<option${item === (note?.collection || collections[0]) ? ' selected' : ''}>${escapeHTML(item)}</option>`).join('')}</select></div>
    <div class="dialog-actions"><button class="button button-secondary" type="button" data-cancel>Cancel</button><button class="button button-primary" type="submit">${isEditing ? 'Save changes' : 'Save note'}</button></div>`, (formData) => {
      const title = String(formData.get('title')).trim();
      const body = String(formData.get('body')).trim() || 'A new thought, ready to grow.';
      const updated = { ...(note || {}), id: note?.id || crypto.randomUUID(), title, body, collection: String(formData.get('collection')), type: note?.type || 'Note', color: note?.color || 'rose', updated: 'Just now', created: note?.created || Date.now(), pinned: note?.pinned || false };
      notes = [updated, ...notes.filter((item) => item.id !== updated.id)];
      saveJSON(STORAGE.notes, notes);
      dialog.close();
      renderLibrary();
      showToast(isEditing ? 'Note updated.' : 'Note added to your library.');
    });
  $('[data-cancel]', dialog).addEventListener('click', () => dialog.close());
}

function showSearchDialog(kind) {
  const images = kind === 'images';
  const title = images ? 'Find an image' : 'Look something up';
  const label = images ? 'Search image references' : 'Search the web';
  openDialog(title, images ? 'IMAGE SEARCH' : 'WEB LOOKUP', `<div class="dialog-field"><label for="external-query">${label}</label><div class="search-dialog-form"><input class="dialog-input" id="external-query" name="query" required placeholder="What are you curious about?" /><button class="button button-primary" type="submit">Search</button></div></div><p class="search-dialog-hint">Your search opens in a new tab. BUNKER does not store your external search history.</p>`, (formData) => {
    const query = String(formData.get('query')).trim();
    if (!query) return;
    const destination = images ? 'https://www.google.com/search?tbm=isch&q=' : 'https://www.google.com/search?q=';
    window.open(destination + encodeURIComponent(query), '_blank', 'noopener,noreferrer');
    dialog.close();
  });
}

async function showSettingsDialog() {
  const currentTheme = document.documentElement.dataset.theme;
  const connected = Boolean(firebaseBackend && firebaseUser);
  if (connected) userPreferences = { ...userPreferences, ...(await firebaseBackend.loadPreferences(firebaseUser.uid).catch(() => ({}))) };
  const disabled = connected ? '' : ' disabled';
  const permission = !('Notification' in window) ? 'Not supported by this browser' : Notification.permission;
  openDialog('Preferences', 'PREFERENCES', `<div class="settings-stack">
    <div class="settings-group"><h3>Appearance</h3><div class="theme-options" role="group" aria-label="Color theme"><button class="theme-choice" type="button" data-theme-choice="light" aria-pressed="${currentTheme === 'light'}"><span aria-hidden="true">&#x2600;</span> Sakura Blossom</button><button class="theme-choice" type="button" data-theme-choice="dark" aria-pressed="${currentTheme === 'dark'}"><span aria-hidden="true">&#x263e;</span> Midnight Sakura</button></div></div>
    <div class="settings-group"><h3>Event reminders</h3><label class="setting-row"><span>Enable event reminders</span><input id="setting-reminders" name="remindersEnabled" type="checkbox"${userPreferences.remindersEnabled === false ? '' : ' checked'}${disabled} /></label><div class="setting-intervals"><label><input name="reminder2Days" type="checkbox"${userPreferences.reminder2Days === false ? '' : ' checked'}${disabled} /> 2 days before</label><label><input name="reminder1Day" type="checkbox"${userPreferences.reminder1Day === false ? '' : ' checked'}${disabled} /> 1 day before</label></div><label class="setting-row"><span>Timezone</span><input name="timeZone" type="text" maxlength="80" value="${escapeHTML(userPreferences.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}" placeholder="Region/City"${disabled} /></label><p class="setting-status">Reminder times follow local calendar days in this timezone.</p></div>
    <div class="settings-group"><h3>Browser notifications</h3><label class="setting-row"><span>Enable browser push<small>Permission: <span id="browser-permission">${escapeHTML(permission)}</span></small></span><input id="setting-push" name="pushEnabled" type="checkbox"${userPreferences.pushEnabled ? ' checked' : ''}${disabled} /></label></div>
    <div class="settings-group"><h3>Sound</h3><label class="setting-row"><span>Roaming cat sounds<small>Independent of event notifications</small></span><input name="catSoundsEnabled" type="checkbox"${userPreferences.catSoundsEnabled ? ' checked' : ''}${disabled} /></label></div>
    ${connected ? '' : '<p class="settings-disabled">Connect Firebase and sign in to sync reminder preferences and receive notifications.</p>'}
    <div class="dialog-actions"><button class="button button-secondary" type="button" data-cancel>Close</button><button class="button button-primary" type="submit"${connected ? '' : ' disabled'}>Save preferences</button></div>
  </div>`, async (formData) => {
    if (!connected) return;
    const timeZone = String(formData.get('timeZone') || '').trim();
    try {
      new Intl.DateTimeFormat('en', { timeZone });
    } catch {
      showToast('Enter a valid IANA timezone, such as Asia/Manila.');
      return;
    }
    const preferences = {
      remindersEnabled: formData.has('remindersEnabled'),
      reminder2Days: formData.has('reminder2Days'),
      reminder1Day: formData.has('reminder1Day'),
      pushEnabled: userPreferences.pushEnabled === true,
      catSoundsEnabled: formData.has('catSoundsEnabled'),
      timeZone,
    };
    try {
      await firebaseBackend.savePreferences(firebaseUser.uid, preferences);
      userPreferences = preferences;
      dialog.close();
      showToast('Notification preferences saved.');
    } catch {
      showToast('Could not save preferences to Firebase.');
    }
  });
  $$('[data-theme-choice]', dialog).forEach((button) => button.addEventListener('click', () => {
    setTheme(button.dataset.themeChoice);
    $$('[data-theme-choice]', dialog).forEach((choice) => choice.setAttribute('aria-pressed', String(choice === button)));
  }));
  $('[data-cancel]', dialog).addEventListener('click', () => dialog.close());
  $('#setting-push')?.addEventListener('change', async (event) => {
    if (!connected) return;
    const control = event.currentTarget;
    try {
      if (control.checked) {
        const permissionState = await firebaseBackend.enablePush(firebaseUser.uid);
        userPreferences.pushEnabled = true;
        $('#browser-permission').textContent = permissionState;
      } else {
        await firebaseBackend.disablePush(firebaseUser.uid);
        userPreferences.pushEnabled = false;
      }
    } catch (error) {
      control.checked = !control.checked;
      showToast(error.message || 'Could not update browser notifications.');
    }
  });
}

function formatDateTime(timestamp, timeZone = userPreferences.timeZone || 'UTC', options = {}) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone, ...options }).format(new Date(timestamp));
}

function toLocalDateTimeInput(timestamp, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function renderCalendar() {
  const note = $('#calendar-backend-note');
  const list = $('#calendar-list');
  if (!firebaseBackend) {
    note.hidden = false;
    note.textContent = 'Connect Firebase to create events and schedule reminders. This preview does not schedule events locally.';
    list.innerHTML = emptyMarkup('Calendar needs Firebase', 'Event creation and reminders run on the configured server.');
    return;
  }
  if (!firebaseUser) {
    note.hidden = false;
    note.textContent = 'Sign in with Firebase to view your private calendar and notifications.';
    list.innerHTML = emptyMarkup('Sign in to continue', 'Your events are private to your account.');
    return;
  }
  note.hidden = true;
  const events = [...calendarEvents].sort((left, right) => left.startsAt - right.startsAt);
  list.innerHTML = events.length ? events.map((event) => {
    const dateParts = new Intl.DateTimeFormat('en', { timeZone: event.timeZone || userPreferences.timeZone || 'UTC', month: 'short', day: 'numeric' }).formatToParts(new Date(event.startsAt));
    const month = dateParts.find((part) => part.type === 'month')?.value || '';
    const day = dateParts.find((part) => part.type === 'day')?.value || '';
    return `<article class="event-card" data-event-id="${escapeHTML(event.id)}">
      <div class="event-main"><div class="event-date-mark"><span>${escapeHTML(month)}</span><span>${escapeHTML(day)}</span></div><div class="event-copy"><h3>${escapeHTML(event.title)}</h3><p>${escapeHTML(formatDateTime(event.startsAt, event.timeZone || userPreferences.timeZone))}</p>${event.description ? `<p class="event-description">${escapeHTML(event.description)}</p>` : ''}<span class="event-status" data-status="${escapeHTML(event.status)}">${escapeHTML(event.status)}</span></div></div>
      <div class="event-actions"><button type="button" data-event-edit="${escapeHTML(event.id)}">Edit</button>${event.status === 'scheduled' ? `<button type="button" data-event-complete="${escapeHTML(event.id)}">Complete</button><button type="button" data-event-cancel="${escapeHTML(event.id)}">Cancel</button>` : ''}<button type="button" data-event-delete="${escapeHTML(event.id)}">Delete</button></div>
    </article>`;
  }).join('') : emptyMarkup('No events yet', 'Add something you would like a reminder for.');
}

function renderNotifications() {
  const count = notificationItems.filter((notification) => !notification.readAt).length;
  const badge = $('#notification-count');
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? '99+' : String(count);
  $('#notification-subtitle').textContent = firebaseBackend && firebaseUser ? `${count} unread` : 'Sign in to view your reminders';
  if (!firebaseBackend || !firebaseUser) {
    $('#notification-list').innerHTML = '<p class="notification-empty">Connect Firebase and sign in to load server notifications.</p>';
    return;
  }
  $('#notification-list').innerHTML = notificationItems.length ? notificationItems.map((notification) => `<button class="notification-item${notification.readAt ? '' : ' unread'}" type="button" data-notification-id="${escapeHTML(notification.id)}" data-event-id="${escapeHTML(notification.eventId)}"><span class="notification-mark" aria-hidden="true"></span><span class="notification-copy"><strong>${escapeHTML(notification.eventTitle || notification.title)}</strong><span>${escapeHTML(notification.body || '')}</span><small>${escapeHTML(formatDateTime(notification.createdAt, userPreferences.timeZone || 'UTC'))}</small></span></button>`).join('') : '<p class="notification-empty">No reminders yet. Upcoming events will appear here.</p>';
}

function openEventEditor(event = null) {
  if (!firebaseBackend || !firebaseUser) {
    showToast('Connect Firebase and sign in to create server-scheduled events.');
    return;
  }
  const timeZone = userPreferences.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const localStart = event ? toLocalDateTimeInput(event.startsAt, timeZone) : '';
  openDialog(event ? 'Edit event' : 'New event', 'YOUR CALENDAR', `<div class="dialog-field"><label for="event-title">Event title</label><input class="dialog-input" id="event-title" name="title" maxlength="160" required placeholder="What’s coming up?" value="${escapeHTML(event?.title || '')}" /></div><div class="dialog-field"><label for="event-start">Starts in ${escapeHTML(timeZone)}</label><input class="dialog-input" id="event-start" name="localStart" type="datetime-local" required value="${escapeHTML(localStart)}" /></div><div class="dialog-field"><label for="event-description">Details</label><textarea class="dialog-textarea" id="event-description" name="description" maxlength="2000" placeholder="Optional details">${escapeHTML(event?.description || '')}</textarea></div><div class="dialog-actions"><button class="button button-secondary" type="button" data-cancel>Cancel</button><button class="button button-primary" type="submit">${event ? 'Save changes' : 'Create event'}</button></div>`, async (formData) => {
    const title = String(formData.get('title') || '').trim();
    const localStart = String(formData.get('localStart') || '');
    const description = String(formData.get('description') || '').trim();
    try {
      await firebaseBackend.saveEvent({ eventId: event?.id, title, localStart, description, status: event?.status || 'scheduled' });
      dialog.close();
      showToast('Event saved. Firebase will schedule eligible reminders.');
    } catch (error) {
      showToast(error.message || 'The event could not be saved.');
    }
  });
  $('[data-cancel]', dialog).addEventListener('click', () => dialog.close());
}

async function changeEventStatus(eventId, status) {
  const event = calendarEvents.find((item) => item.id === eventId);
  if (!event) return;
  try {
    await firebaseBackend.saveEvent({
      eventId,
      title: event.title,
      localStart: toLocalDateTimeInput(event.startsAt, userPreferences.timeZone || 'UTC'),
      description: event.description || '',
      status,
    });
    showToast(status === 'completed' ? 'Event marked complete.' : 'Event cancelled. Pending reminders will be cancelled.');
  } catch {
    showToast('The event status could not be updated.');
  }
}

function setView(view, collection = '') {
  activeView = view;
  activeCollection = collection;
  $$('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view && !collection));
  $$('.collection-item').forEach((item) => item.classList.toggle('selected', item.dataset.collection === collection));
  $('#dashboard-view').hidden = view === 'calendar';
  $('#calendar-view').hidden = view !== 'calendar';
  if (view === 'calendar') renderCalendar();
  renderLibrary();
}

async function logOut() {
  $('#profile-menu').hidden = true;
  workspace.hidden = true;
  logoutScreen.hidden = false;
  if (firebaseBackend && firebaseUser) {
    loggingOut = true;
    try {
      await firebaseBackend.signOut();
      firebaseUser = null;
      endBackendSession();
    } catch {
      loggingOut = false;
      logoutScreen.hidden = true;
      showWorkspace({ email: firebaseUser.email, name: firebaseUser.displayName || firebaseUser.email.split('@')[0] });
      showToast('Could not sign out. Please try again.');
      return;
    }
  } else {
    try { sessionStorage.removeItem('bunker-session'); } catch { /* Private browsing can disable session storage. */ }
  }
  setTimeout(() => {
    loggingOut = false;
    logoutScreen.hidden = true;
    authScreen.hidden = false;
    $('#login-form').reset();
  }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1500);
}

$$('.theme-toggle').forEach((button) => button.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')));
window.addEventListener('bunker-firebase-ready', (event) => {
  firebaseBackend = event.detail.backend;
  firebaseConfigured = event.detail.configured;
  $('#signup-button').hidden = !firebaseBackend;
  if (firebaseConfigured) $('#password').minLength = 6;
  if (!firebaseBackend) {
    renderCalendar();
    if (firebaseConfigured) showToast('Firebase could not initialize. Check the browser console and web config.');
    return;
  }
  firebaseBackend.onAuthStateChanged((user) => {
    if (!user) {
      firebaseUser = null;
      endBackendSession();
      if (loggingOut) return;
      workspace.hidden = true;
      authScreen.hidden = false;
      return;
    }
    loggingOut = false;
    firebaseUser = user;
    authScreen.hidden = true;
    showWorkspace({ email: user.email || '', name: user.displayName || user.email?.split('@')[0] || 'Friend' });
    beginBackendSession(user).catch(() => showToast('Could not load your Firebase preferences.'));
  });
});

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const email = String(formData.get('email')).trim();
  const password = String(formData.get('password'));
  const error = $('#auth-error');
  const minimumPasswordLength = firebaseBackend || firebaseConfigured ? 6 : 4;
  if (!email.includes('@') || password.length < minimumPasswordLength) {
    error.textContent = `Enter a valid email and a password of at least ${minimumPasswordLength} characters.`;
    error.hidden = false;
    return;
  }
  if (firebaseBackend) {
    error.hidden = true;
    try {
      await firebaseBackend.signIn(email, password);
    } catch {
      error.textContent = 'Sign-in failed. Check your credentials and try again.';
      error.hidden = false;
    }
    return;
  }
  if (firebaseConfigured) {
    error.textContent = 'Firebase is configured but unavailable. Try again when the connection is restored.';
    error.hidden = false;
    return;
  }
  error.hidden = true;
  const namePart = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  const name = namePart.split(' ').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ') || 'Friend';
  const user = { email, name };
  try { sessionStorage.setItem('bunker-session', JSON.stringify(user)); } catch { /* A session is still available for this page load. */ }
  authScreen.classList.add('auth-exiting');
  setTimeout(() => showWorkspace(user), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
});

$('#signup-button').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  const password = $('#password').value;
  const error = $('#auth-error');
  if (!firebaseBackend) return;
  if (!email.includes('@') || password.length < 6) {
    error.textContent = 'Enter a valid email and a password of at least 6 characters.';
    error.hidden = false;
    return;
  }
  error.hidden = true;
  try {
    await firebaseBackend.signUp(email, password);
  } catch {
    error.textContent = 'Could not create that account. Check the email, password, and Firebase Auth settings.';
    error.hidden = false;
  }
});

$('.password-toggle').addEventListener('click', (event) => {
  const input = $('#password');
  const showing = input.type === 'password';
  input.type = showing ? 'text' : 'password';
  event.currentTarget.textContent = showing ? 'Hide' : 'Show';
  event.currentTarget.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
});

$('#profile-button').addEventListener('click', () => { $('#profile-menu').hidden = !$('#profile-menu').hidden; });
$('#logout-button').addEventListener('click', logOut);
document.addEventListener('click', (event) => {
  if (!event.target.closest('.profile-button, .profile-menu')) $('#profile-menu').hidden = true;
  if (!event.target.closest('#fab, .fab-menu')) $('#fab-menu').hidden = true;
  if (!event.target.closest('.notification-wrap')) {
    $('#notification-panel').hidden = true;
    $('#notifications-button').setAttribute('aria-expanded', 'false');
  }
});

$$('[data-view]').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.view === 'settings') {
    showSettingsDialog().catch(() => showToast('Could not load your preferences.'));
    return;
  }
  setView(button.dataset.view);
  if (button.matches('.quiet-link')) $('#recent-heading').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('#sidebar').classList.remove('mobile-open');
  $('#mobile-scrim').hidden = true;
}));
$('#collection-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-collection]');
  if (button) setView('notes', button.dataset.collection);
});
$('#recent-grid').addEventListener('click', (event) => {
  const pinButton = event.target.closest('[data-pin]');
  if (pinButton) {
    event.stopPropagation();
    const note = notes.find((item) => item.id === pinButton.dataset.pin);
    if (note) note.pinned = !note.pinned;
    saveJSON(STORAGE.notes, notes);
    renderLibrary();
    return;
  }
  const card = event.target.closest('[data-note-id]');
  if (card) openNote(notes.find((item) => item.id === card.dataset.noteId));
});
$('#recent-grid').addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.note-card')) {
    event.preventDefault();
    openNote(notes.find((item) => item.id === event.target.dataset.noteId));
  }
});
$('#pinned-list').addEventListener('click', (event) => {
  const row = event.target.closest('[data-note-id]');
  if (row) openNote(notes.find((item) => item.id === row.dataset.noteId));
});
$('#pinned-list').addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.pinned-row')) {
    event.preventDefault();
    openNote(notes.find((item) => item.id === event.target.dataset.noteId));
  }
});

$('#library-search').addEventListener('input', renderLibrary);
$('.search-box').addEventListener('click', (event) => {
  const searchBox = event.currentTarget;
  if (matchMedia('(max-width: 660px)').matches && !searchBox.classList.contains('search-open')) {
    event.preventDefault();
    searchBox.classList.add('search-open');
    $('#library-search').focus();
  }
});
$('#library-search').addEventListener('focus', (event) => event.currentTarget.parentElement.classList.add('search-open'));
$('#library-search').addEventListener('blur', (event) => { if (!event.currentTarget.value) event.currentTarget.parentElement.classList.remove('search-open'); });
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    const input = $('#library-search');
    input.parentElement.classList.add('search-open');
    input.focus();
  }
  if (event.key === 'Escape') {
    $('#fab-menu').hidden = true;
    $('#profile-menu').hidden = true;
    $('#sidebar').classList.remove('mobile-open');
    $('#mobile-scrim').hidden = true;
  }
});

$('#new-note').addEventListener('click', () => openNote());
$('#fab').addEventListener('click', () => { $('#fab-menu').hidden = !$('#fab-menu').hidden; });
$('#fab-menu').addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'note') openNote();
  if (action === 'upload') $('#file-input').click();
  $('#fab-menu').hidden = true;
});
$('#file-input').addEventListener('change', (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  const imported = files.map((file) => ({ id: crypto.randomUUID(), title: file.name, body: `Added from this device (${Math.round(file.size / 1024)} KB).`, collection: collections[0] || 'Ideas', type: 'Document', color: 'peach', updated: 'Just now', pinned: false, created: Date.now() }));
  notes = [...imported, ...notes];
  saveJSON(STORAGE.notes, notes);
  renderLibrary();
  event.target.value = '';
  showToast(`${files.length} ${files.length === 1 ? 'file' : 'files'} added to your library.`);
});
$('#add-collection').addEventListener('click', () => {
  openDialog('New collection', 'YOUR LIBRARY', `<div class="dialog-field"><label for="collection-name">Collection name</label><input class="dialog-input" id="collection-name" name="name" maxlength="32" required placeholder="e.g. Things to explore" /></div><div class="dialog-actions"><button class="button button-secondary" type="button" data-cancel>Cancel</button><button class="button button-primary" type="submit">Create collection</button></div>`, (formData) => {
    const name = String(formData.get('name')).trim();
    if (!name || collections.some((item) => item.toLowerCase() === name.toLowerCase())) return;
    collections.push(name);
    saveJSON(STORAGE.collections, collections);
    dialog.close();
    renderCollections();
    showToast('Collection created.');
  });
  $('[data-cancel]', dialog).addEventListener('click', () => dialog.close());
});
$('#web-search').addEventListener('click', () => showSearchDialog('web'));
$('#image-search').addEventListener('click', () => showSearchDialog('images'));
$('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
$('#sidebar-collapse').addEventListener('click', () => workspace.classList.toggle('sidebar-collapsed'));
$('#mobile-menu').addEventListener('click', () => { $('#sidebar').classList.add('mobile-open'); $('#mobile-scrim').hidden = false; });
$('#mobile-scrim').addEventListener('click', () => { $('#sidebar').classList.remove('mobile-open'); $('#mobile-scrim').hidden = true; });
$('#new-event').addEventListener('click', () => openEventEditor());
$('#calendar-list').addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-event-edit]');
  if (editButton) {
    const item = calendarEvents.find((calendarEvent) => calendarEvent.id === editButton.dataset.eventEdit);
    if (item) openEventEditor(item);
    return;
  }
  const completeButton = event.target.closest('[data-event-complete]');
  if (completeButton) return changeEventStatus(completeButton.dataset.eventComplete, 'completed');
  const cancelButton = event.target.closest('[data-event-cancel]');
  if (cancelButton) return changeEventStatus(cancelButton.dataset.eventCancel, 'cancelled');
  const deleteButton = event.target.closest('[data-event-delete]');
  if (deleteButton && window.confirm('Delete this event? Pending reminders will be cancelled.')) {
    try {
      await firebaseBackend.deleteEvent(deleteButton.dataset.eventDelete);
      showToast('Event deleted. Pending reminders will be cancelled.');
    } catch {
      showToast('The event could not be deleted.');
    }
  }
});

$('#notifications-button').addEventListener('click', () => {
  if (!firebaseBackend || !firebaseUser) showToast('Connect Firebase and sign in to load notifications.');
  const panel = $('#notification-panel');
  panel.hidden = !panel.hidden;
  $('#notifications-button').setAttribute('aria-expanded', String(!panel.hidden));
});
$('#notification-list').addEventListener('click', async (event) => {
  const item = event.target.closest('[data-notification-id]');
  if (!item || !firebaseBackend || !firebaseUser) return;
  try {
    await firebaseBackend.markNotificationRead(item.dataset.notificationId);
    $('#notification-panel').hidden = true;
    $('#notifications-button').setAttribute('aria-expanded', 'false');
    setView('calendar');
    const calendarEvent = calendarEvents.find((candidate) => candidate.id === item.dataset.eventId);
    if (calendarEvent) openEventEditor(calendarEvent);
    else showToast('This event is no longer available.');
  } catch {
    showToast('Could not update this notification.');
  }
});
$('#mark-all-read').addEventListener('click', async () => {
  if (!firebaseBackend || !firebaseUser) return;
  try {
    await firebaseBackend.markAllNotificationsRead();
  } catch {
    showToast('Could not mark notifications as read.');
  }
});

setTheme(document.documentElement.dataset.theme || 'light', false);

try {
  const user = JSON.parse(sessionStorage.getItem('bunker-session'));
  if (user?.email) showWorkspace(user);
} catch { /* Start at sign in when there is no usable saved session. */ }

try {
  if (!localStorage.getItem(STORAGE.notes)) saveJSON(STORAGE.notes, starterNotes);
  if (!localStorage.getItem(STORAGE.collections)) saveJSON(STORAGE.collections, starterCollections);
} catch { /* Storage may be unavailable in private browsing. */ }
