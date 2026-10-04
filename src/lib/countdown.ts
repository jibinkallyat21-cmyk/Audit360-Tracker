export interface Remaining {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Remaining time to a stored deadline. Never negative: past deadlines read as expired. */
export function remaining(deadlineIso: string, nowMs: number): Remaining {
  const diff = new Date(deadlineIso).getTime() - nowMs;
  if (!Number.isFinite(diff) || diff <= 0)
    return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  const total = Math.floor(diff / 1000);
  return {
    expired: false,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** Converts a datetime-local value plus an IANA timezone into a UTC ISO instant. */
export function zonedToUtcIso(local: string, timeZone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error("Invalid date and time.");
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Find the zone offset at that wall-clock time (two passes handle DST edges).
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    guess += asUtc - shown;
  }
  return new Date(guess).toISOString();
}
