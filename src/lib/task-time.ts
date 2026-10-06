/** Stable SSR/client task timestamps; never depend on the viewer's locale or process TZ. */
export function formatTaskTime(value: string, offsetMinutes = 480, includeDate = false): string {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return "—";
  const offset = Number.isInteger(offsetMinutes) && offsetMinutes >= -720 && offsetMinutes <= 840 ? offsetMinutes : 480;
  const iso = new Date(instant + offset * 60_000).toISOString();
  return includeDate ? iso.slice(0, 19).replace("T", " ") : iso.slice(11, 19);
}
