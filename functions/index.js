const { randomUUID } = require('node:crypto');
const admin = require('firebase-admin');
const { onValueWritten } = require('firebase-functions/v2/database');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const {
  buildReminderPlan,
  localDateTimeToTimestamp,
  retryDelayMs,
} = require('./reminder-utils');

const REGION = 'asia-southeast1';
const MAX_ATTEMPTS = 8;
const LEASE_MS = 2 * 60 * 1000;
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://bunker-8fe10-default-rtdb.asia-southeast1.firebasedatabase.app';

if (!admin.apps.length) {
  const options = { databaseURL: DATABASE_URL };
  if (!process.env.FUNCTIONS_EMULATOR) options.credential = admin.credential.applicationDefault();
  admin.initializeApp(options);
}

const db = admin.database();

function schedulingOptions(preferences = {}) {
  return {
    enabled: preferences.remindersEnabled !== false,
    timeZone: preferences.timeZone || 'UTC',
    intervals: [
      ...(preferences.reminder2Days !== false ? [2] : []),
      ...(preferences.reminder1Day !== false ? [1] : []),
    ],
  };
}

function safeLog(error, fields) {
  logger.error('Reminder delivery operation failed', {
    ...fields,
    errorCode: error?.code || 'unknown',
  });
}

async function cancelPendingReminders(userId, eventId) {
  const remindersRef = db.ref(`reminders/${userId}/${eventId}`);
  const snapshot = await remindersRef.get();
  const updates = {};
  snapshot.forEach((child) => {
    const reminder = child.val();
    if (reminder?.status !== 'pending') return;
    updates[`reminders/${userId}/${eventId}/${child.key}/status`] = 'cancelled';
    updates[`reminders/${userId}/${eventId}/${child.key}/cancelledAt`] = Date.now();
    updates[`reminderQueue/${child.key}`] = null;
  });
  if (Object.keys(updates).length) await db.ref().update(updates);
}

async function synchronizeEvent(userId, eventId, event) {
  const preferencesSnapshot = await db.ref(`preferences/${userId}`).get();
  const options = schedulingOptions(preferencesSnapshot.val() || {});
  await cancelPendingReminders(userId, eventId);

  const plan = buildReminderPlan({ userId, eventId, event, preferences: preferencesSnapshot.val() || {} });
  if (!plan.reminders.length) return;
  const writes = {};

  for (const plannedReminder of plan.reminders) {
    const reminderId = plannedReminder.id;
    const reminderRef = db.ref(`reminders/${userId}/${eventId}/${reminderId}`);
    const result = await reminderRef.transaction((existing) => {
      if (existing?.status === 'sent') return;
      return {
        id: reminderId,
        userId,
        eventId,
        intervalDays: plannedReminder.intervalDays,
        scheduledAt: plannedReminder.scheduledAt,
        timeZone: plannedReminder.timeZone,
        scheduleRevision: plannedReminder.scheduleRevision,
        status: 'pending',
        createdAt: existing?.createdAt || Date.now(),
        attemptCount: 0,
      };
    }, undefined, false);

    const reminder = result.snapshot.val();
    if (reminder?.status !== 'pending') continue;
    writes[`reminderQueue/${reminderId}`] = {
      userId,
      eventId,
      reminderId,
      scheduledAt: reminder.scheduledAt,
    };
  }

  if (Object.keys(writes).length) await db.ref().update(writes);
}

function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

exports.saveCalendarEvent = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const title = typeof request.data?.title === 'string' ? request.data.title.trim() : '';
  const localStart = request.data?.localStart;
  if (!title || title.length > 160 || typeof localStart !== 'string') {
    throw new HttpsError('invalid-argument', 'A title and local start time are required.');
  }

  const requestedId = request.data.eventId;
  if (requestedId !== undefined && (typeof requestedId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requestedId))) {
    throw new HttpsError('invalid-argument', 'The event ID is invalid.');
  }
  const userId = request.auth.uid;
  const eventId = requestedId || db.ref(`events/${userId}`).push().key;
  const eventRef = db.ref(`events/${userId}/${eventId}`);
  const existingSnapshot = requestedId ? await eventRef.get() : null;
  if (requestedId && !existingSnapshot.exists()) throw new HttpsError('not-found', 'Event not found.');

  const preferencesSnapshot = await db.ref(`preferences/${userId}`).get();
  const timeZone = preferencesSnapshot.child('timeZone').val() || 'UTC';
  if (!isValidTimeZone(timeZone)) throw new HttpsError('failed-precondition', 'Set a valid IANA timezone in notification settings.');
  let startsAt;
  try {
    startsAt = localDateTimeToTimestamp(localStart, timeZone);
  } catch {
    throw new HttpsError('invalid-argument', 'The event start date or time is invalid.');
  }

  const status = request.data.status || existingSnapshot?.child('status').val() || 'scheduled';
  if (!['scheduled', 'completed', 'cancelled'].includes(status)) {
    throw new HttpsError('invalid-argument', 'The event status is invalid.');
  }
  const now = Date.now();
  const event = {
    id: eventId,
    userId,
    title,
    description: typeof request.data.description === 'string' ? request.data.description.slice(0, 2000) : '',
    startsAt,
    status,
    timeZone,
    createdAt: existingSnapshot?.child('createdAt').val() || now,
    updatedAt: now,
    scheduleRevision: randomUUID(),
  };
  await eventRef.set(event);
  return { event };
});

exports.deleteCalendarEvent = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const eventId = request.data?.eventId;
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) {
    throw new HttpsError('invalid-argument', 'A valid event ID is required.');
  }
  const eventRef = db.ref(`events/${request.auth.uid}/${eventId}`);
  if (!(await eventRef.get()).exists()) throw new HttpsError('not-found', 'Event not found.');
  await eventRef.remove();
  return { ok: true };
});

function schedulingPreferencesChanged(before = {}, after = {}) {
  return ['remindersEnabled', 'timeZone', 'reminder1Day', 'reminder2Days']
    .some((key) => (before[key] ?? null) !== (after[key] ?? null));
}

exports.syncEventReminders = onValueWritten({
  ref: '/events/{userId}/{eventId}',
  region: REGION,
  retry: true,
}, async (change) => {
  const { userId, eventId } = change.params;
  const before = change.data.before.val();
  const after = change.data.after.val();
  if (before?.startsAt === after?.startsAt && before?.status === after?.status && before?.scheduleRevision === after?.scheduleRevision) return;
  await synchronizeEvent(userId, eventId, after);
});

exports.syncPreferenceReminders = onValueWritten({
  ref: '/preferences/{userId}',
  region: REGION,
  retry: true,
}, async (change) => {
  const before = change.data.before.val() || {};
  const after = change.data.after.val() || {};
  if (!schedulingPreferencesChanged(before, after)) return;
  const eventsSnapshot = await db.ref(`events/${change.params.userId}`).get();
  const tasks = [];
  eventsSnapshot.forEach((eventSnapshot) => {
    tasks.push(synchronizeEvent(change.params.userId, eventSnapshot.key, eventSnapshot.val()));
  });
  const results = await Promise.allSettled(tasks);
  const failures = results.filter((result) => result.status === 'rejected');
  failures.forEach((result) => safeLog(result.reason, { userId: change.params.userId }));
  if (failures.length) throw new Error('Some event reminders could not be synchronized.');
});

function isPermanentPushError(error) {
  return [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ].includes(error?.code);
}

async function deliverToToken(userId, eventId, reminder, notification, tokenSnapshot) {
  const tokenId = tokenSnapshot.key;
  const token = tokenSnapshot.child('token').val();
  if (!token) return { status: 'failed' };

  const deliveryRef = db.ref(`pushDeliveries/${userId}/${reminder.id}/${tokenId}`);
  const now = Date.now();
  const claim = await deliveryRef.transaction((current) => {
    if (current?.status === 'sent' || current?.status === 'failed') return;
    if (current?.leaseUntil > now || current?.nextAttemptAt > now) return;
    return {
      status: 'pending',
      attempts: (current?.attempts || 0) + 1,
      leaseUntil: now + LEASE_MS,
      nextAttemptAt: 0,
    };
  }, undefined, false);

  if (!claim.committed) return { status: 'skipped' };
  const attempt = claim.snapshot.val().attempts;
  try {
    await admin.messaging().send({
      token,
      data: {
        title: notification.title,
        body: notification.body,
        eventId,
        notificationId: reminder.id,
        link: `/index.html?event=${encodeURIComponent(eventId)}`,
      },
      webpush: {
        fcmOptions: { link: `${process.env.APP_ORIGIN || 'https://bunker-8fe10.web.app'}/index.html?event=${encodeURIComponent(eventId)}` },
      },
    });
    await deliveryRef.set({ status: 'sent', sentAt: Date.now(), attempts: attempt });
    return { status: 'sent' };
  } catch (error) {
    if (isPermanentPushError(error)) {
      await Promise.all([
        db.ref(`pushTokens/${userId}/${tokenId}`).remove(),
        deliveryRef.set({ status: 'failed', failedAt: Date.now(), attempts: attempt, errorCode: error.code }),
      ]);
      safeLog(error, { userId, eventId, reminderId: reminder.id, permanent: true });
      return { status: 'failed' };
    }

    if (attempt >= MAX_ATTEMPTS) {
      await deliveryRef.set({ status: 'failed', failedAt: Date.now(), attempts: attempt, errorCode: error?.code || 'unknown' });
      return { status: 'failed' };
    }

    const retryAt = Date.now() + retryDelayMs(attempt);
    await deliveryRef.set({ status: 'pending', nextAttemptAt: retryAt, attempts: attempt, errorCode: error?.code || 'unknown' });
    safeLog(error, { userId, eventId, reminderId: reminder.id });
    return { status: 'retry', retryAt };
  }
}

async function processReminder(queueEntry) {
  const { userId, eventId, reminderId } = queueEntry;
  const reminderRef = db.ref(`reminders/${userId}/${eventId}/${reminderId}`);
  const now = Date.now();
  const leaseId = randomUUID();
  const claim = await reminderRef.transaction((current) => {
    if (!current || current.status !== 'pending' || current.scheduledAt > now) return;
    if (current.leaseUntil > now || current.nextAttemptAt > now) return;
    return { ...current, leaseId, leaseUntil: now + LEASE_MS, attemptCount: (current.attemptCount || 0) + 1 };
  }, undefined, false);
  if (!claim.committed) return;

  const reminder = claim.snapshot.val();
  const updateClaimedReminder = async (updates) => {
    const result = await reminderRef.transaction((current) => {
      if (!current || current.status !== 'pending' || current.leaseId !== leaseId) return;
      const next = { ...current, ...updates };
      if (updates.leaseId === null) delete next.leaseId;
      return next;
    }, undefined, false);
    return result.committed;
  };
  try {
    const [eventSnapshot, preferencesSnapshot] = await Promise.all([
      db.ref(`events/${userId}/${eventId}`).get(),
      db.ref(`preferences/${userId}`).get(),
    ]);
    const event = eventSnapshot.val();
    const preferences = preferencesSnapshot.val() || {};
    const currentOptions = schedulingOptions(preferences);
    const expectedPlan = buildReminderPlan({ userId, eventId, event, preferences, now: Date.now() });

    if (
      !event ||
      event.status !== 'scheduled' ||
      !currentOptions.enabled ||
      !currentOptions.intervals.includes(reminder.intervalDays) ||
      event.startsAt <= Date.now() ||
      !expectedPlan.reminders.some((expected) => expected.id === reminderId && expected.scheduledAt === reminder.scheduledAt)
    ) {
      const cancelled = await updateClaimedReminder({ status: 'cancelled', cancelledAt: Date.now(), leaseUntil: 0, leaseId: null });
      if (cancelled) await db.ref(`reminderQueue/${reminderId}`).remove();
      return;
    }

    const timeZone = currentOptions.timeZone;
    const dateFormatter = new Intl.DateTimeFormat('en', {
      timeZone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    const eventDate = dateFormatter.format(new Date(event.startsAt));
    const title = `Coming up: ${event.title}`;
    const body = `${eventDate} (${reminder.intervalDays} ${reminder.intervalDays === 1 ? 'day' : 'days'} from now)`;
    const notification = {
      id: reminderId,
      eventId,
      title,
      body,
      eventTitle: event.title,
      startsAt: event.startsAt,
      timeZone,
      link: `/index.html?event=${encodeURIComponent(eventId)}`,
      createdAt: Date.now(),
      readAt: null,
    };
    const [latestEventSnapshot, latestReminderSnapshot, latestPreferencesSnapshot] = await Promise.all([
      db.ref(`events/${userId}/${eventId}`).get(),
      reminderRef.get(),
      db.ref(`preferences/${userId}`).get(),
    ]);
    const latestEvent = latestEventSnapshot.val();
    const latestPreferences = latestPreferencesSnapshot.val() || {};
    const latestOptions = schedulingOptions(latestPreferences);
    const latestPlan = buildReminderPlan({ userId, eventId, event: latestEvent, preferences: latestPreferences, now: Date.now() });
    const latestReminder = latestReminderSnapshot.val();
    if (
      !latestEvent ||
      latestEvent.status !== 'scheduled' ||
      !latestOptions.enabled ||
      !latestOptions.intervals.includes(reminder.intervalDays) ||
      !latestPlan.reminders.some((expected) => expected.id === reminderId) ||
      !latestPlan.reminders.some((expected) => expected.scheduledAt === reminder.scheduledAt) ||
      latestReminder?.status !== 'pending' ||
      latestReminder.leaseId !== leaseId
    ) {
      const cancelled = await updateClaimedReminder({ status: 'cancelled', cancelledAt: Date.now(), leaseUntil: 0, leaseId: null });
      if (cancelled) await db.ref(`reminderQueue/${reminderId}`).remove();
      return;
    }
    const notificationRef = db.ref(`notifications/${userId}/${reminderId}`);
    await notificationRef.transaction((existing) => existing || notification, undefined, false);

    let retryAt = 0;
    if (latestPreferences.pushEnabled === true) {
      const tokenSnapshot = await db.ref(`pushTokens/${userId}`).get();
      const tokenEntries = tokenSnapshot.exists() ? Object.entries(tokenSnapshot.val()) : [];
      const deliveryResults = await Promise.all(tokenEntries.map(([tokenId]) =>
        deliverToToken(userId, eventId, reminder, notification, tokenSnapshot.child(tokenId))));
      const retryable = deliveryResults.filter((result) => result.status === 'retry');
      if (retryable.length && reminder.attemptCount < MAX_ATTEMPTS) {
        retryAt = Math.max(...retryable.map((result) => result.retryAt));
      } else if (deliveryResults.some((result) => result.status === 'retry')) {
        throw new Error('Push delivery retry limit reached');
      }
    }

    if (retryAt) {
      const rescheduled = await updateClaimedReminder({ leaseUntil: 0, nextAttemptAt: retryAt, leaseId: null });
      if (rescheduled) await db.ref(`reminderQueue/${reminderId}`).update({ scheduledAt: retryAt });
      return;
    }

    const delivered = await updateClaimedReminder({ status: 'sent', deliveredAt: Date.now(), leaseUntil: 0, nextAttemptAt: 0, leaseId: null });
    if (delivered) await db.ref(`reminderQueue/${reminderId}`).remove();
  } catch (error) {
    const attempt = reminder.attemptCount || 1;
    if (attempt >= MAX_ATTEMPTS) {
      const failed = await updateClaimedReminder({ status: 'failed', failedAt: Date.now(), leaseUntil: 0, errorCode: error?.code || 'unknown', leaseId: null });
      if (failed) await db.ref(`reminderQueue/${reminderId}`).remove();
      safeLog(error, { userId, eventId, reminderId, terminal: true });
      return;
    }

    const retryAt = Date.now() + retryDelayMs(attempt);
    const rescheduled = await updateClaimedReminder({ leaseUntil: 0, nextAttemptAt: retryAt, lastErrorCode: error?.code || 'unknown', leaseId: null });
    if (rescheduled) await db.ref(`reminderQueue/${reminderId}`).update({ scheduledAt: retryAt });
    safeLog(error, { userId, eventId, reminderId, attempt });
  }
}

exports.processDueReminders = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'UTC',
  region: REGION,
  timeoutSeconds: 120,
  memory: '512MiB',
  maxInstances: 1,
  retryCount: 3,
}, async () => {
  const dueSnapshot = await db.ref('reminderQueue')
    .orderByChild('scheduledAt')
    .endAt(Date.now())
    .limitToFirst(100)
    .get();
  const results = await Promise.allSettled(dueSnapshot.exists()
    ? Object.values(dueSnapshot.val()).map(processReminder)
    : []);
  results.filter((result) => result.status === 'rejected').forEach((result) => safeLog(result.reason, { job: 'processDueReminders' }));
});

exports.markNotificationRead = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const notificationId = request.data?.notificationId;
  if (typeof notificationId !== 'string' || !/^[a-f0-9]{64}$/.test(notificationId)) {
    throw new HttpsError('invalid-argument', 'A valid notification ID is required.');
  }
  const notificationRef = db.ref(`notifications/${request.auth.uid}/${notificationId}`);
  const snapshot = await notificationRef.get();
  if (!snapshot.exists()) throw new HttpsError('not-found', 'Notification not found.');
  await notificationRef.child('readAt').transaction((readAt) => readAt || Date.now());
  return { ok: true };
});

exports.markAllNotificationsRead = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const notificationsRef = db.ref(`notifications/${request.auth.uid}`);
  const snapshot = await notificationsRef.get();
  const updates = {};
  snapshot.forEach((child) => {
    if (!child.child('readAt').exists()) updates[`${child.key}/readAt`] = Date.now();
  });
  if (Object.keys(updates).length) await notificationsRef.update(updates);
  return { updated: Object.keys(updates).length };
});

exports.purgeStalePushDeliveries = onSchedule({
  schedule: 'every 24 hours',
  timeZone: 'UTC',
  region: REGION,
}, async () => {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const remindersSnapshot = await db.ref('reminders').get();
  const removals = {};
  remindersSnapshot.forEach((userSnapshot) => {
    userSnapshot.forEach((eventSnapshot) => {
      eventSnapshot.forEach((reminderSnapshot) => {
        const reminder = reminderSnapshot.val();
        if (reminder?.status === 'sent' && reminder.deliveredAt < cutoff) {
          removals[`pushDeliveries/${userSnapshot.key}/${reminderSnapshot.key}`] = null;
        }
      });
    });
  });
  if (Object.keys(removals).length) await db.ref().update(removals);
});
