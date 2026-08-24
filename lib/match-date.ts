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
