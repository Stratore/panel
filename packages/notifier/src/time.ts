/** Wall-clock date and time in the instance time zone (`TZ`, SPEC § 13). */
export interface LocalTime {
  /** `YYYY-MM-DD` */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
}

export function localTime(now: Date, timeZone: string): LocalTime {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${String(values['year'])}-${String(values['month'])}-${String(values['day'])}`,
    minutes: Number(values['hour']) * 60 + Number(values['minute']),
  };
}

/** `HH:MM` → minutes since midnight. */
export function toMinutes(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** True inside [start, end), wrapping past midnight (23:00–07:00). Equal bounds disable it. */
export function inQuietHours(
  minutes: number,
  quiet: { start: string; end: string } | null,
): boolean {
  if (quiet === null) return false;
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** The process time zone, used when `TZ` is not set. */
export const systemTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
