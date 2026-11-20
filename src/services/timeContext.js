export function getTimeContext(now = new Date(), timezone = 'Africa/Lagos') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now).map(part => [part.type, part.value])
  );
  const offset = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    timeZoneName: 'shortOffset'
  }).formatToParts(now).find(part => part.type === 'timeZoneName')?.value;

  return {
    instant: now.toISOString(),
    timezone,
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localTime: `${parts.hour}:${parts.minute}:${parts.second}`,
    offset
  };
}
