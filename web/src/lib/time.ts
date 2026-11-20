import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { YVONNE_TIME_ZONE } from "@/lib/domain";

export function toLagosDateTimeValue(value: string | Date | null | undefined) {
  if (!value) return "";
  return formatInTimeZone(new Date(value), YVONNE_TIME_ZONE, "yyyy-MM-dd'T'HH:mm");
}

export function fromLagosDateTimeValue(value: string) {
  if (!value) return null;
  const parsed = fromZonedTime(value, YVONNE_TIME_ZONE);
  if (Number.isNaN(parsed.getTime())) throw new Error("Enter a valid Africa/Lagos date and time.");
  return parsed.toISOString();
}

export function toLagosDate(value: string | Date) {
  return formatInTimeZone(new Date(value), YVONNE_TIME_ZONE, "yyyy-MM-dd");
}

export function dateKeyToCalendarDate(dateKey: string) {
  return fromZonedTime(`${dateKey}T12:00:00`, YVONNE_TIME_ZONE);
}

export function formatLagosDateTime(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: YVONNE_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(new Date(value));
}

export function localDateTimeToIso(value: string) {
  return fromLagosDateTimeValue(value);
}
