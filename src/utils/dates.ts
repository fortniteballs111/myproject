const DAY_MS = 86_400_000;

export function dateIndex(dateISO: string): number {
  const index = Date.parse(dateISO + 'T00:00:00Z') / DAY_MS;
  if (!Number.isInteger(index) || isoDate(index) !== dateISO) {
    throw new RangeError('Expected a calendar date in YYYY-MM-DD format: ' + dateISO);
  }
  return index;
}

export function isoDate(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(dateISO: string, days: number): string {
  return isoDate(dateIndex(dateISO) + days);
}

export function weekday(dateISO: string): number {
  return new Date(dateIndex(dateISO) * DAY_MS).getUTCDay();
}

export function localDateISO(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return date.getFullYear() + '-' + month + '-' + day;
}

export function formatMinute(minute: number): string {
  const hours = String(Math.floor(minute / 60)).padStart(2, '0');
  return hours + ':' + String(minute % 60).padStart(2, '0');
}
