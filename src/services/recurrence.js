function getLocalParts(date, timezone) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date).map(part => [part.type, part.value])
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`
  };
}

function parseDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A recurrence date must use YYYY-MM-DD format.');
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.toISOString().slice(0, 10) !== date) throw new Error('A recurrence date is invalid.');
  return { year, month, day, value: parsed };
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const parsed = parseDate(date);
  return formatDate(new Date(parsed.value.getTime() + days * 86_400_000));
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, daysInMonth(year, month))).padStart(2, '0')}`;
}

function dateAtLocalTime(date, time, timezone) {
  const { year, month, day } = parseDate(date);
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new Error('A recurrence time must use HH:MM format.');
  const target = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]));
  let timestamp = target;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = getLocalParts(new Date(timestamp), timezone);
    const { year: localYear, month: localMonth, day: localDay } = parseDate(local.date);
    const [localHour, localMinute] = local.time.split(':').map(Number);
    const represented = Date.UTC(localYear, localMonth - 1, localDay, localHour, localMinute);
    const difference = target - represented;
    if (difference === 0) return new Date(timestamp);
    timestamp += difference;
  }

  throw new Error(`The local time ${date} ${time} does not exist in ${timezone}.`);
}

export function getNextRecurrenceDate(anchorDate, recurrence, afterDate, {
  includeAfter = false,
  recurrenceUntil = null
} = {}) {
  const anchor = parseDate(anchorDate);
  const after = parseDate(afterDate);
  const firstAllowedDate = includeAfter ? afterDate : addDays(afterDate, 1);
  const firstAllowed = parseDate(firstAllowedDate);
  let candidate;

  if (recurrence === 'daily') {
    candidate = firstAllowed.value < anchor.value ? anchorDate : firstAllowedDate;
  } else if (recurrence === 'weekly') {
    const start = firstAllowed.value < anchor.value ? anchorDate : firstAllowedDate;
    const startValue = parseDate(start).value;
    const weekdayOffset = (anchor.value.getUTCDay() - startValue.getUTCDay() + 7) % 7;
    candidate = addDays(start, weekdayOffset);
  } else if (recurrence === 'monthly') {
    let monthIndex = Math.max(
      anchor.year * 12 + anchor.month - 1,
      firstAllowed.year * 12 + firstAllowed.month - 1
    );
    for (let attempt = 0; attempt < 12_000; attempt += 1, monthIndex += 1) {
      const year = Math.floor(monthIndex / 12);
      const month = monthIndex % 12 + 1;
      const monthlyDate = clampDate(year, month, anchor.day);
      if (monthlyDate >= anchorDate && monthlyDate >= firstAllowedDate) {
        candidate = monthlyDate;
        break;
      }
    }
  } else if (recurrence === 'yearly') {
    for (let year = Math.max(anchor.year, firstAllowed.year); year < 12_000; year += 1) {
      const yearlyDate = clampDate(year, anchor.month, anchor.day);
      if (yearlyDate >= anchorDate && yearlyDate >= firstAllowedDate) {
        candidate = yearlyDate;
        break;
      }
    }
  } else {
    throw new Error(`Unsupported recurrence: ${recurrence}`);
  }

  if (!candidate || (recurrenceUntil && candidate > recurrenceUntil)) return null;
  return candidate;
}

export function getNextReminderTime(reminder, now) {
  const timezone = reminder.timezone || 'Africa/Lagos';
  const anchorDate = reminder.recurrence_anchor_date
    || (reminder.remind_at
      ? getLocalParts(new Date(reminder.remind_at), timezone).date
      : getLocalParts(now, timezone).date);
  const nextDate = getNextRecurrenceDate(
    anchorDate,
    reminder.recurrence,
    getLocalParts(now, timezone).date
  );
  if (!nextDate) throw new Error('No future recurrence date is available for this reminder.');
  return dateAtLocalTime(nextDate, reminder.local_time, timezone);
}

export function getNextCalendarEventAlert(event, now) {
  if (!event.alert_enabled || event.recurrence === 'once') return null;

  const timezone = event.timezone || 'Africa/Lagos';
  const eventLocal = getLocalParts(new Date(event.starts_at), timezone);
  const anchorDate = event.recurrence_anchor_date || eventLocal.date;
  const leadMinutes = Number(event.alert_lead_minutes || 0);
  let occurrenceDate = getNextRecurrenceDate(
    anchorDate,
    event.recurrence,
    getLocalParts(now, timezone).date,
    { includeAfter: true, recurrenceUntil: event.recurrence_until || null }
  );

  for (let attempt = 0; occurrenceDate && attempt < 3; attempt += 1) {
    const occurrenceStart = dateAtLocalTime(occurrenceDate, eventLocal.time, timezone);
    const alertAt = new Date(occurrenceStart.getTime() - leadMinutes * 60_000);
    if (alertAt > now) return alertAt;
    occurrenceDate = getNextRecurrenceDate(
      anchorDate,
      event.recurrence,
      occurrenceDate,
      { recurrenceUntil: event.recurrence_until || null }
    );
  }

  return null;
}

export { dateAtLocalTime };
