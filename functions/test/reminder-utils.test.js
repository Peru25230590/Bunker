const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildReminderPlan,
  buildReminderSchedule,
  localDateTimeToTimestamp,
  makeReminderId,
  reminderTimestamp,
  retryDelayMs,
} = require('../reminder-utils');

test('creates the two calendar-day reminders for a UTC event', () => {
  const startAt = Date.parse('2026-10-12T12:30:00.000Z');
  const reminders = buildReminderSchedule(startAt, 'UTC', Date.parse('2026-10-01T00:00:00Z'));

  assert.deepEqual(reminders, [
    { daysBefore: 2, scheduledAt: Date.parse('2026-10-10T12:30:00.000Z') },
    { daysBefore: 1, scheduledAt: Date.parse('2026-10-11T12:30:00.000Z') },
  ]);
});

test('keeps only the future one-day reminder for an event created 36 hours ahead', () => {
  const now = Date.parse('2026-10-10T05:00:00.000Z');
  const startAt = Date.parse('2026-10-11T17:00:00.000Z');

  assert.deepEqual(buildReminderSchedule(startAt, 'UTC', now), [
    { daysBefore: 1, scheduledAt: Date.parse('2026-10-10T17:00:00.000Z') },
  ]);
});

test('does not schedule reminders for a past event or past reminder timestamp', () => {
  assert.deepEqual(buildReminderSchedule(Date.parse('2026-10-09T12:00:00Z'), 'UTC', Date.parse('2026-10-10T00:00:00Z')), []);
  assert.deepEqual(buildReminderSchedule(Date.parse('2026-10-11T12:00:00Z'), 'UTC', Date.parse('2026-10-11T00:00:00Z'), [2]), []);
});

test('uses calendar days and the event local wall time across the spring DST change', () => {
  const eventStart = Date.parse('2024-03-10T13:00:00.000Z');

  assert.equal(reminderTimestamp(eventStart, 'America/New_York', 2), Date.parse('2024-03-08T14:00:00.000Z'));
  assert.equal(reminderTimestamp(eventStart, 'America/New_York', 1), Date.parse('2024-03-09T14:00:00.000Z'));
});

test('uses calendar days across the fall DST change', () => {
  const eventStart = Date.parse('2024-11-04T14:00:00.000Z');

  assert.equal(reminderTimestamp(eventStart, 'America/New_York', 2), Date.parse('2024-11-02T13:00:00.000Z'));
  assert.equal(reminderTimestamp(eventStart, 'America/New_York', 1), Date.parse('2024-11-03T14:00:00.000Z'));
});

test('uses deterministic revision keys and exponential capped retry delays', () => {
  const first = makeReminderId('user-1', 'event-1', 'rev-1', 2, 'UTC');
  assert.equal(first, makeReminderId('user-1', 'event-1', 'rev-1', 2, 'UTC'));
  assert.notEqual(first, makeReminderId('user-1', 'event-1', 'rev-2', 2, 'UTC'));
  assert.deepEqual([1, 2, 3, 20].map(retryDelayMs), [60_000, 120_000, 240_000, 21_600_000]);
});

test('rejects invalid timezones and reminder intervals', () => {
  assert.throws(() => reminderTimestamp(Date.now(), 'Not/A_Timezone', 1), RangeError);
  assert.throws(() => reminderTimestamp(Date.now(), 'UTC', 3), RangeError);
});

test('resolves a nonexistent DST wall time to the first valid time after the gap', () => {
  assert.equal(localDateTimeToTimestamp('2024-03-10T02:30', 'America/New_York'), Date.parse('2024-03-10T07:00:00.000Z'));
});

test('resolves an ambiguous fall DST wall time to its first occurrence', () => {
  assert.equal(localDateTimeToTimestamp('2024-11-03T01:30', 'America/New_York'), Date.parse('2024-11-03T05:30:00.000Z'));
});

test('plans both reminders on event creation and one for a near-term event', () => {
  const base = { status: 'scheduled', scheduleRevision: 'revision-a' };
  const now = Date.parse('2026-10-10T05:00:00.000Z');
  const regular = buildReminderPlan({
    userId: 'user-a',
    eventId: 'event-a',
    event: { ...base, startsAt: Date.parse('2026-10-12T12:00:00.000Z') },
    preferences: { timeZone: 'UTC' },
    now,
  });
  const nearTerm = buildReminderPlan({
    userId: 'user-a',
    eventId: 'event-b',
    event: { ...base, startsAt: Date.parse('2026-10-11T17:00:00.000Z') },
    preferences: { timeZone: 'UTC' },
    now,
  });

  assert.deepEqual(regular.reminders.map((reminder) => reminder.intervalDays), [2, 1]);
  assert.deepEqual(nearTerm.reminders.map((reminder) => reminder.intervalDays), [1]);
});

test('reschedules with new IDs and creates no plans for deleted, cancelled, completed, or disabled events', () => {
  const event = { id: 'event-a', status: 'scheduled', startsAt: Date.parse('2026-10-12T12:00:00Z'), scheduleRevision: 'revision-a' };
  const first = buildReminderPlan({ userId: 'user-a', eventId: 'event-a', event, preferences: { timeZone: 'UTC' }, now: Date.parse('2026-10-01T00:00:00Z') });
  const rescheduled = buildReminderPlan({ userId: 'user-a', eventId: 'event-a', event: { ...event, startsAt: event.startsAt + 86400000, scheduleRevision: 'revision-b' }, preferences: { timeZone: 'UTC' }, now: Date.parse('2026-10-01T00:00:00Z') });

  assert.notDeepEqual(first.reminders.map((reminder) => reminder.id), rescheduled.reminders.map((reminder) => reminder.id));
  assert.deepEqual(buildReminderPlan({ userId: 'user-a', eventId: 'event-a', event: null }).reminders, []);
  assert.deepEqual(buildReminderPlan({ userId: 'user-a', eventId: 'event-a', event: { ...event, status: 'cancelled' } }).reminders, []);
  assert.deepEqual(buildReminderPlan({ userId: 'user-a', eventId: 'event-a', event: { ...event, status: 'completed' } }).reminders, []);
  assert.deepEqual(buildReminderPlan({ userId: 'user-a', eventId: 'event-a', event, preferences: { remindersEnabled: false } }).reminders, []);
});

test('prevents duplicate plans but isolates users and independent reminder intervals', () => {
  const event = { status: 'scheduled', startsAt: Date.parse('2026-10-12T12:00:00Z'), scheduleRevision: 'revision-a' };
  const input = { eventId: 'event-a', event, preferences: { timeZone: 'UTC', reminder2Days: false }, now: Date.parse('2026-10-01T00:00:00Z') };
  const first = buildReminderPlan({ ...input, userId: 'user-a' });
  const duplicate = buildReminderPlan({ ...input, userId: 'user-a' });
  const otherUser = buildReminderPlan({ ...input, userId: 'user-b' });

  assert.deepEqual(first.reminders, duplicate.reminders);
  assert.deepEqual(first.reminders.map((reminder) => reminder.intervalDays), [1]);
  assert.notEqual(first.reminders[0].id, otherUser.reminders[0].id);
});