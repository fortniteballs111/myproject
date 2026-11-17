import type { EnergyLevel } from '../types/scheduler';
import { dateIndex } from './dates';

export const ENERGY_LABEL: Record<EnergyLevel, string> = { high: 'Высокая', medium: 'Средняя', low: 'Низкая' };
export const ENERGY_LEVELS: EnergyLevel[] = ['high', 'medium', 'low'];
export const WEEKDAYS = [
  { day: 1, label: 'Пн' }, { day: 2, label: 'Вт' }, { day: 3, label: 'Ср' }, { day: 4, label: 'Чт' },
  { day: 5, label: 'Пт' }, { day: 6, label: 'Сб' }, { day: 0, label: 'Вс' },
];

const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' });

export function formatDate(dateISO: string, long = false): string {
  return (long ? longDate : shortDate).format(dateIndex(dateISO) * 86_400_000);
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? hours + ' ч' : '', rest || !hours ? rest + ' мин' : ''].filter(Boolean).join(' ');
}

export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes >= 60 || hours > 24 || (hours === 24 && minutes !== 0)) return null;
  return hours * 60 + minutes;
}
