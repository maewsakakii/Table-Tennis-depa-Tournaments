const DEFAULT_FIRST_MATCH_DATE = "2026-08-25";

export function addBusinessDays(startDate: string, offset: number) {
  const [year, month, day] = startDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  let remaining = Math.max(0, Math.trunc(offset));
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

export function defaultMatchDate(index: number) {
  return addBusinessDays(DEFAULT_FIRST_MATCH_DATE, index);
}

export function formatMatchDate(value: string | null | undefined) {
  if (!value) return "ยังไม่กำหนดวัน";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return "ยังไม่กำหนดวัน";
  return `${day}/${month}/${year}`;
}

/** Calendar date in the viewer's own timezone. Match dates are plain YYYY-MM-DD strings,
 *  so comparing them against a UTC "today" would flip the schedule late in the evening. */
export function localDateKey(date: Date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
