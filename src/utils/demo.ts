import type { ScheduleParams } from '../engine/solver';
import { addDays, localDateISO } from './dates';

export function createDemoParams(today = localDateISO()): ScheduleParams & { startDateISO: string } {
  const daily = [0, 1, 2, 3, 4, 5, 6];
  return {
    startDateISO: today,
    fixedBlocks: [
      { id: 'sleep-night', title: 'Сон', daysOfWeek: daily, startMinute: 0, endMinute: 420, category: 'Отдых' },
      { id: 'school', title: 'Учёба', daysOfWeek: daily, startMinute: 540, endMinute: 840, category: 'Учёба' },
      { id: 'sleep-evening', title: 'Сон', daysOfWeek: daily, startMinute: 1380, endMinute: 1440, category: 'Отдых' },
    ],
    goals: [
      {
        id: 'exam', title: 'Подготовка к экзамену', totalMinutesRequired: 160, completedMinutes: 0,
        deadlineISO: today, priority: 5, minSessionMinutes: 35, maxSessionMinutes: 55,
        preferredEnergy: 'high', color: '#A5B4FC',
      },
      {
        id: 'project', title: 'Пет-проект', totalMinutesRequired: 180, completedMinutes: 0,
        deadlineISO: addDays(today, 3), priority: 3, minSessionMinutes: 35, maxSessionMinutes: 65,
        preferredEnergy: 'medium', color: '#5EEAD4',
      },
    ],
    energyWindows: [
      { startMinute: 420, endMinute: 540, level: 'high' },
      { startMinute: 540, endMinute: 960, level: 'medium' },
      { startMinute: 960, endMinute: 1140, level: 'high' },
      { startMinute: 1140, endMinute: 1290, level: 'medium' },
      { startMinute: 1290, endMinute: 1440, level: 'low' },
    ],
  };
}
