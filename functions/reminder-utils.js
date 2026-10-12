const { createHash } = require('node:crypto');

function zonedParts(timestamp, timeZone) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const parts = Object.fromEntries(values.map(({ type, value }) => [type, Number(value)]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: ((timestamp % 1000) + 1000) % 1000,
  };
}

function wallTimestamp(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond || 0);
}

function compareWallTime(left, right) {
  return wallTimestamp(left) - wallTimestamp(right);
}

function localWallTimeToTimestamp(target, timeZone) {
  const targetWall = wallTimestamp(target);
  let candidate = targetWall;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const actual = zonedParts(candidate, timeZone);
    const difference = targetWall - wallTimestamp(actual);
    if (difference === 0) return candidate;
    candidate += difference;
  }

  // If the target falls in a DST gap, choose the first valid local minute after it.
  const searchStart = candidate - 4 * 60 * 60 * 1000;
  for (let offset = 0; offset <= 8 * 60 * 60 * 1000; offset += 60 * 1000) {
    const instant = searchStart + offset;
    const actual = zonedParts(instant, timeZone);
    if (
      actual.year === target.year &&
      actual.month === target.month &&
      actual.day === target.day &&
      compareWallTime(actual, target) >= 0
    ) {
      return instant;
    }
  }

  throw new RangeError(`Could not resolve local reminder time in ${timeZone}`);
}

function localDateTimeToTimestamp(localDateTime, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localDateTime || '');
  if (!match) throw new TypeError('localDateTime must use YYYY-MM-DDTHH:mm[:ss]');
  const [, year, month, day, hour, minute, second = '0'] = match;
  const target = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    millisecond: 0,
  };
  const normalized = new Date(Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second));
  if (
    normalized.getUTCFullYear() !== target.year ||
    normalized.getUTCMonth() + 1 !== target.month ||
    normalized.getUTCDate() !== target.day ||
    target.hour > 23 || target.minute > 59 || target.second > 59
  ) {
    throw new RangeError('localDateTime contains an invalid calendar date or time');
  }
  return localWallTimeToTimestamp(target, timeZone);
}

function reminderTimestamp(eventStartAt, timeZone, daysBefore) {
  if (!Number.isFinite(eventStartAt) || eventStartAt <= 0) {
    throw new TypeError('eventStartAt must be a positive epoch-millisecond timestamp');
  }
  if (![1, 2].includes(daysBefore)) {
    throw new RangeError('daysBefore must be 1 or 2');
  }

  const local = zonedParts(eventStartAt, timeZone);
  const targetDate = new Date(Date.UTC(local.year, local.month - 1, local.day - daysBefore));
  return localWallTimeToTimestamp({
    year: targetDate.getUTCFullYear(),
    month: targetDate.getUTCMonth() + 1,
    day: targetDate.getUTCDate(),
    hour: local.hour,
    minute: local.minute,
    second: local.second,
    millisecond: local.millisecond,
  }, timeZone);
}

function buildReminderSchedule(eventStartAt, timeZone, now = Date.now(), enabledIntervals = [2, 1]) {
  if (!Number.isFinite(now)) throw new TypeError('now must be an epoch-millisecond timestamp');
  if (eventStartAt <= now) return [];
  return enabledIntervals
    .filter((daysBefore) => [1, 2].includes(daysBefore))
    .map((daysBefore) => ({ daysBefore, scheduledAt: reminderTimestamp(eventStartAt, timeZone, daysBefore) }))
    .filter(({ scheduledAt }) => scheduledAt > now)
    .sort((left, right) => right.daysBefore - left.daysBefore);
}

function buildReminderPlan({ userId, eventId, event, preferences = {}, now = Date.now() }) {
  const timeZone = preferences.timeZone || 'UTC';
  const intervals = [
    ...(preferences.reminder2Days !== false ? [2] : []),
    ...(preferences.reminder1Day !== false ? [1] : []),
  ];
  const active = event &&
    event.status === 'scheduled' &&
    preferences.remindersEnabled !== false &&
    intervals.length > 0 &&
    Number.isFinite(event.startsAt) &&
    event.startsAt > now;
  if (!active) return { timeZone, scheduleRevision: '', reminders: [] };

  const scheduleRevision = [
    event.scheduleRevision || String(event.updatedAt || event.startsAt),
    event.startsAt,
    timeZone,
    intervals.join(','),
  ].join(':');
  const reminders = buildReminderSchedule(event.startsAt, timeZone, now, intervals).map(({ daysBefore, scheduledAt }) => ({
    id: makeReminderId(userId, eventId, scheduleRevision, daysBefore, timeZone),
    userId,
    eventId,
    intervalDays: daysBefore,
    scheduledAt,
    timeZone,
    scheduleRevision,
    status: 'pending',
  }));
  return { timeZone, scheduleRevision, reminders };
}

function makeReminderId(userId, eventId, scheduleRevision, daysBefore, timeZone) {
  return createHash('sha256')
    .update([userId, eventId, scheduleRevision, daysBefore, timeZone].join('\u0000'))
    .digest('hex');
}

function retryDelayMs(attempt) {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(60_000 * (2 ** (safeAttempt - 1)), 6 * 60 * 60 * 1000);
}

module.exports = {
  buildReminderSchedule,
  buildReminderPlan,
  localDateTimeToTimestamp,
  makeReminderId,
  reminderTimestamp,
  retryDelayMs,
};