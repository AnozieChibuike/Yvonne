import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { CalendarEvent, Recurrence, Reminder } from "@/lib/domain";
import { YVONNE_TIME_ZONE } from "@/lib/domain";
import { toLagosDate } from "@/lib/time";

function parseDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function addDays(date: string, count: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + count)).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isOccurrence(
  date: string,
  anchorDate: string,
  recurrence: Recurrence,
  recurrenceUntil: string | null,
) {
  if (date < anchorDate || (recurrenceUntil && date > recurrenceUntil)) return false;
  if (recurrence === "once") return date === anchorDate;

  const current = parseDate(date);
  const anchor = parseDate(anchorDate);
  if (recurrence === "daily") return true;
  if (recurrence === "weekly") {
    const weekday = new Date(Date.UTC(current.year, current.month - 1, current.day)).getUTCDay();
    const anchorWeekday = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day)).getUTCDay();
    return weekday === anchorWeekday;
  }
  if (recurrence === "monthly") {
    return current.day === Math.min(anchor.day, daysInMonth(current.year, current.month));
  }
  return (
    current.month === anchor.month &&
    current.day === Math.min(anchor.day, daysInMonth(current.year, current.month))
  );
}

export function getEventOccurrenceDates(
  event: CalendarEvent,
  rangeStart: string,
  rangeEnd: string,
) {
  const anchorDate = toLagosDate(event.starts_at);
  const occurrences: string[] = [];
  let date = rangeStart;

  while (date <= rangeEnd) {
    if (isOccurrence(date, anchorDate, event.recurrence, event.recurrence_until)) {
      occurrences.push(date);
    }
    date = addDays(date, 1);
  }

  return occurrences;
}

export function getNextEventAlertTime(
  event: Pick<
    CalendarEvent,
    | "starts_at"
    | "timezone"
    | "recurrence"
    | "recurrence_until"
    | "alert_enabled"
    | "alert_lead_minutes"
  >,
  now: Date = new Date(),
) {
  if (!event.alert_enabled) return null;

  const timezone = event.timezone || YVONNE_TIME_ZONE;
  const anchorDate = formatInTimeZone(new Date(event.starts_at), timezone, "yyyy-MM-dd");
  const eventTime = formatInTimeZone(new Date(event.starts_at), timezone, "HH:mm");
  const leadMs = event.alert_lead_minutes * 60_000;

  if (event.recurrence === "once") {
    const alertAt = new Date(new Date(event.starts_at).getTime() - leadMs);
    return alertAt > now ? alertAt : null;
  }

  let date = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  if (date < anchorDate) date = anchorDate;
  for (let attempt = 0; attempt < 370; attempt += 1) {
    if (isOccurrence(date, anchorDate, event.recurrence, event.recurrence_until)) {
      const eventAt = fromZonedTime(`${date}T${eventTime}`, timezone);
      const alertAt = new Date(eventAt.getTime() - leadMs);
      if (alertAt > now) return alertAt;
    }
    date = addDays(date, 1);
  }

  return null;
}

export function eventOccursOnDate(event: CalendarEvent, date: string) {
  return isOccurrence(
    date,
    toLagosDate(event.starts_at),
    event.recurrence,
    event.recurrence_until,
  );
}

export function reminderOccursOnDate(
  reminder: Pick<Reminder, "remind_at" | "recurrence" | "recurrence_anchor_date">,
  date: string,
) {
  return isOccurrence(
    date,
    reminder.recurrence_anchor_date ?? toLagosDate(reminder.remind_at),
    reminder.recurrence,
    null,
  );
}
